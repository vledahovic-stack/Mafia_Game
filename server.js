const { ROLES, executeRoleAction } = require('./rolesConfig');
const { startGame, setPhase, startIndividualSpeechPhase, finishSpeechEarly, nominateCandidate, castVote, skipNightPhase, checkNightPhaseEnd } = require('./gameLogic');
const { getDefaultSettings } = require('./gameSettings');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const db = require('./database');
const session = require('express-session');
const { setupShopEvents } = require('./shopServer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const sessionMiddleware = session({
    secret: 'mafia-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);

// Связываем сессии Express с Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

const rooms = {};

// Вспомогательные функции работы с таблицей blacklists в БД
const Blacklist = {
    add: (userId, blockedUserId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT OR IGNORE INTO blacklists (user_id, blocked_user_id) VALUES (?, ?)',
                [userId, blockedUserId],
                (err) => err ? reject(err) : resolve()
            );
        });
    },

    remove: (userId, blockedUserId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM blacklists WHERE user_id = ? AND blocked_user_id = ?',
                [userId, blockedUserId],
                (err) => err ? reject(err) : resolve()
            );
        });
    },

    isBlocked: (userId, blockedUserId) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT 1 FROM blacklists WHERE user_id = ? AND blocked_user_id = ?',
                [userId, blockedUserId],
                (err, row) => err ? reject(err) : resolve(!!row)
            );
        });
    },

    getAll: (userId) => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT blocked_user_id FROM blacklists WHERE user_id = ?',
                [userId],
                (err, rows) => err ? reject(err) : resolve(rows.map(r => r.blocked_user_id))
            );
        });
    }
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Генерация случайного шестизначного ID (от 100000 до 999999)
        const customId = Math.floor(100000 + Math.random() * 900000);

        db.run(
            'INSERT INTO users (id, username, password) VALUES (?, ?, ?)',
            [customId, username, hashedPassword],
            function (err) {
                if (err) {
                    if (err.message.includes('users.username') || (err.message.includes('UNIQUE constraint failed') && err.message.includes('username'))) {
                        return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.json({ success: true, userId: customId });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при обработке запроса' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        if (!user) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({ success: true, username: user.username, userId: user.id });
    });
});

app.post('/api/rooms/create', (req, res) => {
    const roomId = 'room_' + Date.now();
    rooms[roomId] = {
        id: roomId,
        hostUsername: null,
        hostUserId: null,
        players: [],
        status: 'waiting',
        gameState: null,
        settings: getDefaultSettings(),
        gameLog: []
    };
    res.json({ success: true, roomId });
});

app.get('/api/rooms', (req, res) => {
    res.json(Object.values(rooms));
});

app.get('/api/user/balance', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    db.get('SELECT balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json({ balance: user.balance });
    });
});

app.post('/api/daily-bonus', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const today = new Date().toISOString().split('T')[0];

    db.get('SELECT id, last_login_date, login_streak, balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }

        if (user.last_login_date === today) {
            return res.json({ success: false, message: 'Вы уже получили бонус сегодня!' });
        }

        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const newStreak = user.last_login_date === yesterday ? (user.login_streak || 0) + 1 : 1;
        const reward = newStreak * 100;

        db.run(
            'UPDATE users SET balance = balance + ?, last_login_date = ?, login_streak = ? WHERE id = ?',
            [reward, today, newStreak, user.id],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка при зачислении бонуса' });
                }
                res.json({
                    success: true,
                    reward,
                    newBalance: user.balance + reward,
                    newStreak
                });
            }
        );
    });
});

app.get('/api/user/profile', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const userId = req.session.userId;

    db.get('SELECT id, username, balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения профиля' });
        }

        db.all('SELECT item_id, quantity FROM inventory WHERE user_id = ?', [userId], (invErr, rows) => {
            const inventory = {};
            if (rows) {
                rows.forEach(row => {
                    inventory[row.item_id] = row.quantity;
                });
            }

            res.json({
                ...user,
                inventory
            });
        });
    });
});

// Маршрут для админ-панели (начисление валюты)
app.post('/api/admin/add-balance', (req, res) => {
    const { userId, amount } = req.body;
    
    db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [amount, userId],
        function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка БД' });
            if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
            res.json({ success: true, message: `Начислено ${amount} пользователю ${userId}` });
        }
    );
});

io.on('connection', (socket) => {
    // Сначала определяем ID пользователя из сессии
    if (socket.request.session && socket.request.session.userId) {
        socket.userId = socket.request.session.userId;
    }

    // И только затем инициализируем события магазина
    setupShopEvents(io, socket);

    // Обработчик выбора роли по карточке
    socket.on('selectRoleCard', ({ role }) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const userId = socket.userId || socket.request.session?.userId;
        if (!userId) {
            return socket.emit('buyResult', { success: false, message: 'Выберите роль после авторизации' });
        }

        // Проверяем наличие карточки в БД
        db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [userId, 'role_card'], (err, row) => {
            if (err || !row || row.quantity <= 0) {
                return socket.emit('buyResult', { success: false, message: 'У вас нет карточки выбора роли' });
            }

            const newQuantity = row.quantity - 1;

            // Списываем 1 карточку из БД
           db.run('UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?', [newQuantity, userId, 'role_card'], (updateErr) => {
                if (updateErr) {
                    return socket.emit('buyResult', { success: false, message: 'Ошибка использования карточки' });
                }

                player.desiredRole = role;

                socket.emit('updateCardCount', newQuantity);
                socket.emit('buyResult', { success: true, message: `Роль "${role}" успешно забронирована на следующий раунд!` });
            });
        });
    });

    socket.on('joinRoom', async ({ roomId, username, userId }) => {
        if (!rooms[roomId]) return;

        const room = rooms[roomId];
        const clientName = username || 'Игрок_' + socket.id.substring(0, 4);
        const currentUserId = userId || socket.userId || socket.request.session?.userId;

        socket.userId = currentUserId;

        // Определяем ведущего
        if (!room.hostUsername) {
            room.hostUsername = clientName;
            room.hostUserId = currentUserId;
        }

        // Проверка: находится ли игрок в черном списке ведущего комнаты
        if (room.hostUserId && currentUserId && room.hostUserId !== currentUserId) {
            try {
                const isBlocked = await Blacklist.isBlocked(room.hostUserId, currentUserId);
                if (isBlocked) {
                    socket.emit('errorMessage', 'Вы находитесь в чёрном списке ведущего этой комнаты.');
                    return;
                }
            } catch (err) {
                console.error('Ошибка проверки черного списка:', err);
            }
        }

        let player = room.players.find(p => p.username === clientName || p.name === clientName);

        const maxPlayers = (room.settings && room.settings.rules && room.settings.rules.maxPlayers) || 16;
        if (!player && room.players.length >= maxPlayers) {
            socket.emit('errorMessage', 'Комната заполнена');
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = clientName;

        if (!player) {
            player = { 
                id: socket.id, 
                userId: currentUserId,
                username: clientName, 
                name: clientName, 
                isAlive: true 
            };
            room.players.push(player);
        } else {
            player.id = socket.id;
            player.userId = currentUserId;
        }

        room.players.sort((a, b) => (a.username === room.hostUsername ? -1 : b.username === room.hostUsername ? 1 : 0));

        socket.emit('settingsUpdated', room.settings);

        if (room.status === 'playing') {
            if (player.role) {
                socket.emit('yourRole', { role: player.role });
            }
            if (room.gameState) {
                room.gameState.players = room.players;
                socket.emit('gameStateUpdate', room.gameState);
            }
        }

        io.to(roomId).emit('updatePlayers', room.players);

        socket.emit('room-joined');
        socket.to(roomId).emit('user-joined', { userId: socket.id });
		
		// Отправляем актуальное количество карточек игроку при входе в комнату
        if (currentUserId) {
            db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [currentUserId, 'role_card'], (err, row) => {
                const count = (row && row.quantity) ? row.quantity : 0;
                socket.emit('updateCardCount', count);
            });
        }
    });

    // Обработчики для Черного Списка
   socket.on('addToBlacklist', async ({ targetUserId, roomId }) => {
    // Определяем ID того, кто блокирует
    let currentUserId = socket.userId || socket.request.session?.userId;
    
    // Если в сессии нет ID, ищем игрока в комнате
    if (!currentUserId && roomId && rooms[roomId]) {
        const me = rooms[roomId].players.find(p => p.id === socket.id);
        if (me) currentUserId = me.userId || me.id;
    }

    if (!currentUserId || !targetUserId) {
        console.error('Не удалось определить ID для ЧС:', { currentUserId, targetUserId });
        return;
    }

    try {
        // 1. Сохраняем в базу данных через встроенный модуль Blacklist
        await Blacklist.add(currentUserId, targetUserId);

        // 2. Достаем обновленный список ЧС и отправляем обратно игроку
        const updatedList = await Blacklist.getAll(currentUserId);
        
        socket.emit('blacklistUpdated', updatedList);

        // 3. Авто-исключение, если блокирующий является ведущим комнаты
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const isHost = socket.username === room.hostUsername || room.hostUserId === currentUserId;

            if (isHost) {
                const targetPlayer = room.players.find(p => String(p.userId) === String(targetUserId) || String(p.id) === String(targetUserId));
                if (targetPlayer && targetPlayer.id) {
                    const targetSocket = io.sockets.sockets.get(targetPlayer.id);
                    if (targetSocket) {
                        targetSocket.emit('kicked');
                        targetSocket.leave(roomId);
                    }
                    room.players = room.players.filter(p => p.id !== targetPlayer.id);
                    io.to(roomId).emit('updatePlayers', room.players);
                }
            }
        }
    } catch (err) {
        console.error('Ошибка добавления в ЧС:', err);
    }
});

    socket.on('removeFromBlacklist', async ({ targetUserId }) => {
        const currentUserId = socket.userId || socket.request.session?.userId;
        if (!currentUserId || !targetUserId) return;

        try {
            await Blacklist.remove(currentUserId, targetUserId);
            const updatedList = await Blacklist.getAll(currentUserId);
            socket.emit('blacklistUpdated', updatedList);
        } catch (err) {
            console.error('Ошибка удаления из ЧС:', err);
        }
    });

    socket.on('getBlacklist', async () => {
        const currentUserId = socket.userId || socket.request.session?.userId;
        if (!currentUserId) return;

        try {
            const list = await Blacklist.getAll(currentUserId);
            socket.emit('blacklistUpdated', list);
        } catch (err) {
            console.error('Ошибка получения ЧС:', err);
        }
    });

    socket.on('signal', ({ target, signal }) => {
        io.to(target).emit('signal', {
            from: socket.id,
            signal
        });
    });

    socket.on('leaveRoom', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            socket.to(roomId).emit('user-left', { userId: socket.id });
            room.players = room.players.filter(p => p.id !== socket.id && p.username !== socket.username);
            socket.leave(roomId);

            if (room.players.length === 0) {
                if (room.timer) clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                if (socket.username === room.hostUsername) {
                    const newHost = room.players[0];
                    room.hostUsername = newHost.username || newHost.name;
                    room.hostUserId = newHost.userId;
                }
                room.players.sort((a, b) => (a.username === room.hostUsername ? -1 : b.username === room.hostUsername ? 1 : 0));
                io.to(roomId).emit('updatePlayers', room.players);
                
                if (room.gameState) {
                    room.gameState.players = room.players;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
                }
            }
        }
    });

    socket.on('kickPlayer', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        if (room && socket.username === room.hostUsername) {
            const kickedPlayer = room.players.find(p => p.id === targetId);
            if (kickedPlayer) {
                socket.to(roomId).emit('user-left', { userId: targetId });
                room.players = room.players.filter(p => p.id !== targetId);
                
                io.to(targetId).emit('kicked');
                const targetSocket = io.sockets.sockets.get(targetId);
                if (targetSocket) {
                    targetSocket.leave(roomId);
                }

                io.to(roomId).emit('updatePlayers', room.players);
                if (room.gameState) {
                    room.gameState.players = room.players;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
                }
            }
        }
    });

    socket.on('updateSettings', ({ roomId, newSettings }) => {
        const room = rooms[roomId];
        if (!room) return;

        const isHost = socket.username === room.hostUsername;
        if (isHost) {
            room.settings = newSettings;
            io.to(roomId).emit('settingsUpdated', room.settings);
        }
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.status === 'waiting') {
            room.status = 'playing';
            room.gameLog = [];
            io.to(roomId).emit('gameStarted');
            startGame(room, io);
        }
    });

    socket.on('endGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            if (room.timer) clearInterval(room.timer);
            room.status = 'waiting';
            room.gameState = null;
            io.to(roomId).emit('gameEnded');
            io.to(roomId).emit('updatePlayers', room.players);
        }
    });

    socket.on('finishSpeech', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            finishSpeechEarly(room, io, socket.username);
        }
    });

    // Новый исправленный вариант:
    socket.on('nominateCandidate', ({ roomId, candidateName }) => {
    const room = rooms[roomId];
    if (room) {
        nominateCandidate(room, io, socket.username, candidateName);
        
        // Отправляем всем игрокам в комнате обновленное состояние игры (с кандидатами)
        if (room.gameState) {
            room.gameState.players = room.players;
            io.to(roomId).emit('gameStateUpdate', room.gameState);
        }
    }
});

    socket.on('castVote', ({ roomId, candidateName }) => {
        const room = rooms[roomId];
        if (room) {
            castVote(room, io, socket.username, candidateName);
        }
    });

    socket.on('nightAction', ({ roomId, targetName }) => {
        const room = rooms[roomId];
        if (room && room.gameState) {
            const player = room.players.find(p => p.username === socket.username || p.name === socket.username);
            if (player && player.isAlive !== false && player.role) {
                const result = executeRoleAction(player.role, room, socket.username, targetName);

                if (result !== null && result !== undefined) {
                    socket.emit('actionResult', { target: targetName, result: result });
                }

                io.to(roomId).emit('gameStateUpdate', room.gameState);
            }
        }
    });

    socket.on('skipNightPhase', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            skipNightPhase(room, io, socket.username);
        }
    });

    socket.on('voteSkipPhase', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.gameState && room.gameState.phase === 1) {
            if (!room.gameState.votedPlayers) {
                room.gameState.votedPlayers = [];
            }

            if (!room.gameState.votedPlayers.includes(socket.username)) {
                room.gameState.votedPlayers.push(socket.username);
                room.gameState.skipVotes = room.gameState.votedPlayers.length;

                if (room.gameState.skipVotes >= room.gameState.requiredVotes) {
                    if (room.timer) clearInterval(room.timer);
                    startIndividualSpeechPhase(room, io);
                } else {
                    io.to(room.id).emit('gameStateUpdate', room.gameState);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        const { roomId, username } = socket;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            socket.to(roomId).emit('user-left', { userId: socket.id });

            if (room.status !== 'playing') {
                room.players = room.players.filter(p => p.id !== socket.id && p.username !== username);
            }

            if (room.players.length === 0) {
                if (room.timer) clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                if (username === room.hostUsername && room.players.length > 0) {
                    const newHost = room.players[0];
                    room.hostUsername = newHost.username || newHost.name;
                    room.hostUserId = newHost.userId;
                }
                room.players.sort((a, b) => (a.username === room.hostUsername ? -1 : b.username === room.hostUsername ? 1 : 0));
                
                // Проверка завершения ночи, если кто-то вышел во время фазы 5
                if (room.gameState && room.gameState.phase === 5) {
                    if (typeof checkNightPhaseEnd === 'function') {
                        checkNightPhaseEnd(room, io);
                    }
                }

                io.to(roomId).emit('updatePlayers', room.players);
                if (room.gameState) {
                    room.gameState.players = room.players;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});