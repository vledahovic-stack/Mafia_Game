const path = require('path');
const { ROLES, executeRoleAction } = require('./rolesConfig');
const {
    startGame,
    startMafiaHuddle,
    setPhase,
    startIndividualSpeechPhase,
    finishSpeechEarly,
    nominateCandidate,
    castVote,
    skipNightPhase,
    handleRoleAction,
    handleDonShot
} = require('./gameLogic');
const {
    canPlayerHear,
    getAudioPermissionsForPlayer,
    broadcastAudioPermissions
} = require('./audioChannels');
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

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));
app.use(express.json());

app.post('/api/claim-welcome-chest', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'Не передан ID пользователя' });
    }

    try {
        db.get('SELECT welcome_chest_claimed FROM users WHERE id = ?', [userId], (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }

            if (row.welcome_chest_claimed === 1) {
                return res.status(400).json({ error: 'Сундук новичка уже был получен' });
            }

            db.run(
                'UPDATE users SET welcome_chest_claimed = 1, balance = balance + 500 WHERE id = ?',
                [userId],
                (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: 'Не удалось выдать награду' });
                    }
                    res.json({ success: true, reward: { coins: 500 } });
                }
            );
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

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

// Вспомогательная функция: удаляет таймеры Node.js из объекта комнаты перед JSON-сериализацией
function sanitizeRoom(room) {
    const { timer, ...rest } = room;
    const sanitized = { ...rest };
    // Если gameState содержит таймер — тоже чистим
    if (sanitized.gameState) {
        sanitized.gameState = sanitizeGameState(sanitized.gameState);
    }
    return sanitized;
}

// Оповещение всех клиентов в лобби об актуальном списке комнат
function broadcastRooms() {
    if (io) {
        io.emit('update_rooms', Object.values(rooms).map(sanitizeRoom));
    }
}

// Вспомогательная функция: очищает gameState от таймеров перед socket.emit
function sanitizeGameState(gs) {
    if (!gs) return gs;
    const { timer, ...rest } = gs;
    return rest;
}

const ADMIN_USERS = ['111', 'Incognito'];

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
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Введите корректный адрес электронной почты' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const customId = Math.floor(100000 + Math.random() * 900000);
        const defaultUsername = `Игрок_${customId}`;

        db.run(
            'INSERT INTO users (id, email, username, password, free_nickname_changes, welcome_chest_claimed) VALUES (?, ?, ?, ?, 1, 0)',
            [customId, email.trim().toLowerCase(), defaultUsername, hashedPassword],
            function (err) {
                if (err) {
                    if (err.message.includes('users.email') || (err.message.includes('UNIQUE constraint failed') && err.message.includes('email'))) {
                        return res.status(400).json({ error: 'Пользователь с таким e-mail уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.json({ success: true, userId: customId, username: defaultUsername });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при обработке запроса' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        if (!user) {
            return res.status(400).json({ error: 'Неверный e-mail или пароль' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Неверный e-mail или пароль' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({
            success: true,
            username: user.username,
            userId: user.id,
            welcome_chest_claimed: user.welcome_chest_claimed
        });
    });
});

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const userId = req.session.userId;
    const username = req.session.username;

    if (req.session.isAdmin || (username && ADMIN_USERS.includes(username)) || (userId && ADMIN_USERS.includes(String(userId)))) {
        return next();
    }

    db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }
        if (user.is_admin === 1 || ADMIN_USERS.includes(String(user.id)) || (user.username && ADMIN_USERS.includes(user.username))) {
            req.session.isAdmin = true;
            return next();
        }
        return res.status(403).json({ error: 'Доступ запрещён' });
    });
}

app.get('/api/auth/me', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ authenticated: false, error: 'Не авторизован' });
    }

    const userId = req.session.userId;
    db.get(
        'SELECT id, email, username, COALESCE(balance, 0) AS balance, COALESCE(xp, 0) AS xp, COALESCE(free_nickname_changes, 1) AS free_nickname_changes, COALESCE(welcome_chest_claimed, 0) AS welcome_chest_claimed, COALESCE(is_admin, 0) AS is_admin FROM users WHERE id = ?',
        [userId],
        (err, user) => {
            if (err) {
                return res.status(500).json({ authenticated: false, error: 'Ошибка сервера' });
            }
            if (!user) {
                if (req.session) req.session.destroy();
                return res.status(401).json({ authenticated: false, error: 'Пользователь не найден' });
            }

            db.get('SELECT COUNT(*) as count FROM pending_chests WHERE user_id = ? AND claimed = 0', [userId], (chestErr, chestRow) => {
                const pending_chests_count = chestRow ? chestRow.count : 0;
                const isAdmin = ADMIN_USERS.includes(String(user.id)) || ADMIN_USERS.includes(user.username) || user.is_admin === 1;

                req.session.isAdmin = isAdmin;
                req.session.username = user.username;

                res.json({
                    authenticated: true,
                    user: {
                        ...user,
                        isAdmin,
                        pending_chests_count
                    }
                });
            });
        }
    );
});

app.post('/api/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            res.clearCookie('connect.sid');
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка при выходе' });
            }
            res.json({ success: true });
        });
    } else {
        res.json({ success: true });
    }
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
    broadcastRooms();
    res.json({ success: true, roomId });
});

app.get('/api/rooms', (req, res) => {
    res.json(Object.values(rooms).map(sanitizeRoom));
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

// Ежедневный бонус (с выдачей бронзового сундука на 7-й день)
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
        
        let newStreak = user.last_login_date === yesterday ? (user.login_streak || 0) + 1 : 1;

        if (newStreak > 7) {
            newStreak = 1;
        }

        const reward = 10 + (newStreak * 5);

        db.run(
            'UPDATE users SET balance = balance + ?, last_login_date = ?, login_streak = ? WHERE id = ?',
            [reward, today, newStreak, user.id],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка при зачислении бонуса' });
                }

                // На 7-й день серии дополнительно выдаем бронзовый сундук!
                const gotChest = newStreak === 7;
                if (gotChest) {
                    db.addInventoryItem(user.id, 'chest_bronze', 1, (invErr) => {
                        if (invErr) console.error('Ошибка начисления сундука за 7-й день:', invErr);
                    });
                }

                res.json({
                    success: true,
                    reward,
                    newBalance: user.balance + reward,
                    newStreak,
                    gotChest
                });
            }
        );
    });
});

const SHOP_ITEMS = {
    role_card: { name: 'Карточка выбора роли', price: 500 },
    chest_bronze: { name: 'Бронзовый сундук', price: 100 },
    chest_silver: { name: 'Серебряный сундук', price: 250 },
    chest_gold: { name: 'Золотой сундук', price: 500 }
};

// Покупка предметов в магазине (десктоп API)
app.post('/api/shop/buy', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Авторизуйтесь для совершения покупок' });
    }

    const userId = req.session.userId;
    const { itemId } = req.body;
    const count = Math.max(1, parseInt(req.body.quantity || req.body.count, 10) || 1);

    const item = SHOP_ITEMS[itemId];
    if (!item) {
        return res.status(400).json({ success: false, error: 'Товар не найден' });
    }

    const totalPrice = item.price * count;

    db.get('SELECT id, balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ success: false, error: 'Ошибка получения профиля' });
        }

        if ((user.balance || 0) < totalPrice) {
            return res.status(400).json({ 
                success: false, 
                error: `Недостаточно монет! Требуется: ${totalPrice} 💰, на балансе: ${user.balance || 0} 💰` 
            });
        }

        const newBalance = (user.balance || 0) - totalPrice;

        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, error: 'Ошибка списания средств' });
            }

            db.addInventoryItem(userId, itemId, count, (invErr) => {
                if (invErr) {
                    console.error('Ошибка добавления предмета в инвентарь:', invErr);
                }

                db.getUserInventory(userId, (invGetErr, rows) => {
                    const inventory = {};
                    if (rows && Array.isArray(rows)) {
                        rows.forEach(r => {
                            inventory[r.item_id] = r.quantity;
                        });
                    }

                    res.json({
                        success: true,
                        message: `Предмет «${item.name}» успешно куплен!`,
                        itemName: item.name,
                        newBalance: newBalance,
                        coins: newBalance,
                        inventory: inventory
                    });
                });
            });
        });
    });
});

// Получить полный инвентарь игрока
app.get('/api/user/inventory', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    db.getUserInventory(req.session.userId, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        const inventory = {};
        if (rows && Array.isArray(rows)) {
            rows.forEach(r => {
                inventory[r.item_id] = r.quantity;
            });
        }
        res.json({ success: true, inventory });
    });
});

app.get('/api/user/profile', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const userId = req.session.userId;

    db.get(
        'SELECT id, email, username, COALESCE(balance, 0) AS balance, COALESCE(xp, 0) AS xp, COALESCE(free_nickname_changes, 1) AS free_nickname_changes, COALESCE(welcome_chest_claimed, 0) AS welcome_chest_claimed FROM users WHERE id = ?', 
        [userId], 
        (err, user) => {
            if (err) {
                console.error('Ошибка получения пользователя из БД:', err);
                return res.status(500).json({ error: 'Ошибка получения профиля' });
            }
            if (!user) {
                if (req.session) req.session.destroy();
                return res.status(401).json({ error: 'Пользователь не найден' });
            }

            db.all('SELECT item_id, quantity FROM inventory WHERE user_id = ?', [userId], (invErr, rows) => {
                const inventory = {};
                if (rows && Array.isArray(rows)) {
                    rows.forEach(row => {
                        inventory[row.item_id] = row.quantity;
                    });
                }

                db.get('SELECT COUNT(*) as count FROM pending_chests WHERE user_id = ? AND claimed = 0', [userId], (chestErr, chestRow) => {
                    const pending_chests_count = chestRow ? chestRow.count : 0;
                    const isAdmin = ADMIN_USERS.includes(String(user.id)) || ADMIN_USERS.includes(user.username);

                    res.json({
                        ...user,
                        isAdmin,
                        inventory,
                        pending_chests_count
                    });
                });
            });
        }
    );
});

app.post('/api/user/change-nickname', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { newUsername } = req.body;
    const userId = req.session.userId;
    const RENAME_COST = 100;

    if (!newUsername || newUsername.trim().length < 3 || newUsername.trim().length > 20) {
        return res.status(400).json({ error: 'Никнейм должен быть от 3 до 20 символов' });
    }

    const trimmedUsername = newUsername.trim();

    db.get('SELECT balance, free_nickname_changes FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }

        const hasFreeChange = user.free_nickname_changes > 0;

        if (!hasFreeChange && user.balance < RENAME_COST) {
            return res.status(400).json({ 
                error: `Недостаточно монет. Стоимость смены никнейма: ${RENAME_COST} монет.` 
            });
        }

        if (hasFreeChange) {
            db.run(
                'UPDATE users SET username = ?, free_nickname_changes = free_nickname_changes - 1 WHERE id = ?',
                [trimmedUsername, userId],
                function (updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: 'Ошибка при обновлении никнейма' });
                    }
                    req.session.username = trimmedUsername;
                    res.json({ success: true, newUsername: trimmedUsername, freeChangesLeft: user.free_nickname_changes - 1 });
                }
            );
        } else {
            db.run(
                'UPDATE users SET username = ?, balance = balance - ? WHERE id = ?',
                [trimmedUsername, RENAME_COST, userId],
                function (updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: 'Ошибка при обновлении никнейма' });
                    }
                    req.session.username = trimmedUsername;
                    res.json({ success: true, newUsername: trimmedUsername, newBalance: user.balance - RENAME_COST });
                }
            );
        }
    });
});

app.post('/api/user/open-chest', (req, res) => {
    const userId = req.session && req.session.userId;
    if (!userId) {
        return res.status(401).json({ success: false, error: 'Необходима авторизация' });
    }

    const count = Math.max(1, parseInt(req.body.count) || 1);
    const chestType = req.body.chestType || req.body.itemId || 'chest_bronze';

    const validChests = ['chest_bronze', 'chest_silver', 'chest_gold'];
    if (!validChests.includes(chestType)) {
        return res.status(400).json({ success: false, error: 'Некорректный тип сундука' });
    }

    // Проверяем наличие сундуков выбранного типа
    db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [userId, chestType], (err, row) => {
        if (err || !row || row.quantity < count) {
            return res.status(400).json({ success: false, error: 'Недостаточно сундуков для открытия' });
        }

        // Списываем сундуки
        db.run('UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND item_id = ? AND quantity >= ?', [count, userId, chestType, count], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, error: 'Ошибка списания сундуков' });
            }

            let totalCoins = 0;
            let totalCards = 0;

            for (let i = 0; i < count; i++) {
                const rand = Math.random() * 100;

                if (chestType === 'chest_bronze') {
                    if (rand < 60) {
                        totalCoins += Math.floor(Math.random() * (100 - 15 + 1)) + 15;
                    } else if (rand < 90) {
                        totalCoins += 30;
                        totalCards += 1;
                    } else {
                        totalCoins += 200;
                        totalCards += 1;
                    }
                } else if (chestType === 'chest_silver') {
                    if (rand < 50) {
                        totalCoins += Math.floor(Math.random() * (250 - 80 + 1)) + 80;
                    } else if (rand < 85) {
                        totalCoins += 80;
                        totalCards += 1;
                    } else {
                        totalCoins += 400;
                        totalCards += 2;
                    }
                } else if (chestType === 'chest_gold') {
                    if (rand < 40) {
                        totalCoins += Math.floor(Math.random() * (500 - 200 + 1)) + 200;
                    } else if (rand < 80) {
                        totalCoins += 150;
                        totalCards += 2;
                    } else {
                        totalCoins += 750;
                        totalCards += 3;
                    }
                }
            }

            // Начисляем монеты
            db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [totalCoins, userId], (coinErr) => {
                if (coinErr) {
                    return res.status(500).json({ success: false, error: 'Ошибка начисления монет' });
                }

                if (totalCards === 0) {
                    return res.json({
                        success: true,
                        openedCount: count,
                        rewards: { coins: totalCoins, roleCards: 0 }
                    });
                }

                // Начисляем карточки ролей
                db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [userId, 'role_card'], (cardErr, cardRow) => {
                    if (cardRow) {
                        db.run('UPDATE inventory SET quantity = quantity + ? WHERE user_id = ? AND item_id = ?', [totalCards, userId, 'role_card']);
                    } else {
                        db.run('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)', [userId, 'role_card', totalCards]);
                    }

                    return res.json({
                        success: true,
                        openedCount: count,
                        rewards: { coins: totalCoins, roleCards: totalCards }
                    });
                });
            });
        });
    });
});

app.post('/api/admin/add-balance', requireAdmin, (req, res) => {
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
    if (socket.request.session && socket.request.session.userId) {
        socket.userId = socket.request.session.userId;
    }

    setupShopEvents(io, socket);

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

        db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [userId, 'role_card'], (err, row) => {
            if (err || !row || row.quantity <= 0) {
                return socket.emit('buyResult', { success: false, message: 'У вас нет карточки выбора роли' });
            }

            const newQuantity = row.quantity - 1;

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

        if (!room.hostUsername) {
            room.hostUsername = clientName;
            room.hostUserId = currentUserId;
        }

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
                socket.emit('gameStateUpdate', sanitizeGameState(room.gameState));
            }
        }

        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRooms();

        socket.emit('room-joined');
        socket.to(roomId).emit('user-joined', { userId: socket.id });

        socket.emit('audioPermissions', getAudioPermissionsForPlayer(room, socket.id));
        broadcastAudioPermissions(room, io);

        if (currentUserId) {
            db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [currentUserId, 'role_card'], (err, row) => {
                const count = (row && row.quantity) ? row.quantity : 0;
                socket.emit('updateCardCount', count);
            });
        }
    });

    socket.on('resetConnection', async ({ roomId }) => {
        const targetRoomId = roomId || socket.roomId;
        if (!targetRoomId || !rooms[targetRoomId]) return;

        const room = rooms[targetRoomId];
        const clientName = socket.username || 'Игрок_' + socket.id.substring(0, 4);

        // Уведомляем других участников о переподключении медиа этого игрока
        socket.to(targetRoomId).emit('user-left', { userId: socket.id });

        // Отправляем игроку актуальные настройки и состояние комнаты
        socket.emit('settingsUpdated', room.settings);

        let player = room.players.find(p => p.id === socket.id || p.username === clientName || p.name === clientName);
        if (player) {
            player.id = socket.id;
        }

        if (room.status === 'playing') {
            if (player && player.role) {
                socket.emit('yourRole', { role: player.role });
            }
            if (room.gameState) {
                room.gameState.players = room.players;
                socket.emit('gameStateUpdate', sanitizeGameState(room.gameState));
            }
        }

        io.to(targetRoomId).emit('updatePlayers', room.players);

        // Запуск микрофона у игрока
        socket.emit('room-joined');

        // Уведомляем других участников для инициирования нового WebRTC соединения
        socket.to(targetRoomId).emit('user-joined', { userId: socket.id });

        // Обновляем права на аудио
        socket.emit('audioPermissions', getAudioPermissionsForPlayer(room, socket.id));
        broadcastAudioPermissions(room, io);
    });

    socket.on('addToBlacklist', async ({ targetUserId, roomId }) => {
        let currentUserId = socket.userId || socket.request.session?.userId;
        
        if (!currentUserId && roomId && rooms[roomId]) {
            const me = rooms[roomId].players.find(p => p.id === socket.id);
            if (me) currentUserId = me.userId || me.id;
        }

        if (!currentUserId || !targetUserId) {
            console.error('Не удалось определить ID для ЧС:', { currentUserId, targetUserId });
            return;
        }

        try {
            await Blacklist.add(currentUserId, targetUserId);
            const updatedList = await Blacklist.getAll(currentUserId);
            socket.emit('blacklistUpdated', updatedList);

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
        let roomId = socket.roomId;
        if (!roomId) {
            const found = Object.values(rooms).find(r => r.players && r.players.some(p => p.id === socket.id));
            if (found) roomId = found.id;
        }
        const room = roomId ? rooms[roomId] : null;

        // Валидация на стороне сервера: разрешено ли передавать аудио между данными игроками
        if (room && room.gameState) {
            const isAllowed = canPlayerHear(room, socket.id, target);
            if (!isAllowed) {
                // Блокируем несанкционированную маршрутизацию WebRTC сигнала
                return;
            }
        }

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
                    io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
                }
            }
            broadcastRooms();
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
                    io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
                }
                broadcastRooms();
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
            broadcastRooms();
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
            broadcastAudioPermissions(room, io);
            broadcastRooms();
        }
    });

    socket.on('finishSpeech', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            finishSpeechEarly(room, io, socket.username);
        }
    });

    socket.on('nominateCandidate', ({ roomId, candidateName }) => {
        const room = rooms[roomId];
        if (room) {
            nominateCandidate(room, io, socket.username, candidateName);
            if (room.gameState) {
                room.gameState.players = room.players;
                io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
            }
        }
    });

    socket.on('castVote', ({ roomId, candidateName }) => {
        const room = rooms[roomId];
        if (room) {
            castVote(room, io, socket.username, candidateName);
        }
    });

    socket.on('submitVote', ({ roomId, candidateName, candidateId }) => {
        const room = rooms[roomId];
        if (room) {
            let targetCandidate = candidateName;
            if (!targetCandidate && candidateId) {
                const targetPlayer = room.players.find(p => p.id === candidateId);
                if (targetPlayer) targetCandidate = targetPlayer.username || targetPlayer.name;
            }
            if (targetCandidate) {
                castVote(room, io, socket.username, targetCandidate);
            }
        }
    });
	
    socket.on('roleAction', ({ roomId, roleName, targetName }) => {
        const room = rooms[roomId];
        if (!room || !room.gameState) return;

        const player = room.players.find(p => p.username === socket.username || p.name === socket.username);
        if (!player || player.isAlive === false || !player.role) return;

        // Для Дона roleAction — это ТОЛЬКО этап 1 (проверка на Шерифа).
        // Этап 2 (выстрел) обрабатывается через nightAction -> handleDonShot.
        const result = handleRoleAction(room, socket.username, player.role, targetName);

        if (result && typeof result === 'string') {
            // Успешная проверка — отправляем результат только инициатору
            socket.emit('actionResult', { target: targetName, result });
        } else if (result && typeof result === 'object' && result.error) {
            // Ошибка (например, повторная проверка) — уведомляем инициатора
            socket.emit('errorMessage', result.error);
        }

        // Обновляем состояние у всех: donChecks теперь заполнен — UI перейдёт к этапу 2
        room.gameState.players = room.players;
        io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    });

    socket.on('nightAction', ({ roomId, targetName }) => {
        const room = rooms[roomId];
        if (!room || !room.gameState) return;

        const player = room.players.find(p => p.username === socket.username || p.name === socket.username);
        if (!player || player.isAlive === false || !player.role) return;

        const donRoleName = ROLES.DON ? ROLES.DON.name : 'Дон мафии';
        let result = null;

        if (player.role === donRoleName) {
            // Этап 2 Дона: выстрел (ночная акция мафии)
            result = handleDonShot(room, socket.username, targetName);
            if (result && typeof result === 'object' && result.error) {
                socket.emit('errorMessage', result.error);
                return;
            }
        } else {
            // Для всех остальных ролей (Мафия, Доктор, Маньяк)
            result = handleRoleAction(room, socket.username, player.role, targetName);
            if (result && typeof result === 'object' && result.error) {
                socket.emit('errorMessage', result.error);
                return;
            }
        }

        // Обновляем состояние всей комнате
        room.gameState.players = room.players;
        io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
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
                    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
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
                
                if (room.gameState && room.gameState.phase === 5) {
                    if (typeof checkNightPhaseEnd === 'function') {
                        checkNightPhaseEnd(room, io);
                    }
                }

                io.to(roomId).emit('updatePlayers', room.players);
                if (room.gameState) {
                    room.gameState.players = room.players;
                    io.to(roomId).emit('gameStateUpdate', sanitizeGameState(room.gameState));
                }
            }
            broadcastRooms();
        }
    });
});

let welcomeChestConfig = {
    coins: 500,
    items: {
        role_card: 0,
        bronze_chest: 0,
        silver_chest: 0,
        gold_chest: 0
    }
};

app.get('/api/admin/welcome-chest', requireAdmin, (req, res) => {
    res.json(welcomeChestConfig);
});

app.post('/api/admin/welcome-chest', requireAdmin, (req, res) => {
    const { coins, items } = req.body;
    welcomeChestConfig = { 
        coins: Number(coins) || 0, 
        items: items || {} 
    };

    res.json({ success: true, config: welcomeChestConfig });
});

app.post('/api/user/claim-welcome-chest', async (req, res) => {
    try {
        const userId = req.session?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Не авторизован' });
        }

        db.get('SELECT welcome_chest_claimed FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err || !user) {
                return res.status(500).json({ error: 'Ошибка получения данных пользователя' });
            }

            if (user.welcome_chest_claimed) {
                return res.status(400).json({ error: 'Сундук уже получен' });
            }

            const coinsToAdd = welcomeChestConfig.coins || 0;
            if (coinsToAdd > 0) {
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [coinsToAdd, userId]);
            }

            const receivedItems = [];

            if (welcomeChestConfig.items) {
                for (const [itemId, qty] of Object.entries(welcomeChestConfig.items)) {
                    if (qty > 0) {
                        console.log(`DEBUG: Запись в inventory -> user_id: ${userId}, item_id: ${itemId}, qty: ${qty}`);
                        
                        db.run(`
                            INSERT INTO inventory (user_id, item_id, quantity)
                            VALUES (?, ?, ?)
                            ON CONFLICT(user_id, item_id) 
                            DO UPDATE SET quantity = quantity + EXCLUDED.quantity
                        `, [userId, itemId, Number(qty)], function(err) {
                            if (err) {
                                console.error(`DEBUG ERROR для ${itemId}:`, err);
                            } else {
                                console.log(`DEBUG SUCCESS: Записано ${itemId}`);
                            }
                        });
                        
                        receivedItems.push({ itemId, qty: Number(qty) });
                    }
                }
            }

            db.run('UPDATE users SET welcome_chest_claimed = 1 WHERE id = ?', [userId], (updateErr) => {
                if (updateErr) {
                    console.error('Ошибка обновления статуса сундука:', updateErr);
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.json({ success: true, coins: coinsToAdd, items: receivedItems });
            });
        });
    } catch (e) {
        console.error('Ошибка выдачи наград:', e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/send-custom-chest', requireAdmin, async (req, res) => {
    const { userId, coins, items } = req.body;
    const coinsVal = Number(coins) || 0;
    const itemsJson = JSON.stringify(items || {});

    const saveChestForUser = (targetId, callback) => {
        db.run(
            'INSERT INTO pending_chests (user_id, coins, items, claimed) VALUES (?, ?, ?, 0)',
            [targetId, coinsVal, itemsJson],
            (err) => {
                if (err) console.error(`Ошибка сохранения сундука для пользователя ${targetId}:`, err);
                if (callback) callback();
            }
        );
    };

    if (userId) {
        db.get('SELECT id FROM users WHERE id = ?', [userId], (err, targetUser) => {
            if (err || !targetUser) {
                return res.status(404).json({ error: 'Пользователь с таким ID не найден' });
            }

            saveChestForUser(userId, () => {
                res.json({ success: true, message: `Кастомный сундук успешно отправлен игроку с ID ${userId}` });
            });
        });
    } else {
        db.all('SELECT id FROM users', [], (err, users) => {
            if (err || !users) {
                return res.status(500).json({ error: 'Ошибка получения списка пользователей' });
            }

            let processed = 0;
            if (users.length === 0) {
                return res.json({ success: true, message: 'Рассылка завершена: нет пользователей' });
            }

            users.forEach(u => {
                saveChestForUser(u.id, () => {
                    processed++;
                    if (processed === users.length) {
                        res.json({ success: true, message: `Рассылка кастомного сундука успешно выполнена для ${users.length} пользователей!` });
                    }
                });
            });
        });
    }
});

app.post('/api/user/claim-custom-chest', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    const userId = req.session.userId;

    db.get('SELECT * FROM pending_chests WHERE user_id = ? AND claimed = 0 ORDER BY id ASC LIMIT 1', [userId], (err, chest) => {
        if (err || !chest) {
            return res.status(404).json({ error: 'Нет доступных сундуков для получения' });
        }

        db.run('UPDATE pending_chests SET claimed = 1 WHERE id = ?', [chest.id], (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка базы данных' });

            const coinsToAdd = Number(chest.coins) || 0;
            if (coinsToAdd > 0) {
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [coinsToAdd, userId]);
            }

            let parsedItems = {};
            try {
                parsedItems = JSON.parse(chest.items || '{}');
                for (const [itemId, qty] of Object.entries(parsedItems)) {
                    const quantity = Number(qty) || 0;
                    if (quantity > 0) {
                        db.run(`
                            INSERT INTO inventory (user_id, item_id, quantity)
                            VALUES (?, ?, ?)
                            ON CONFLICT(user_id, item_id) 
                            DO UPDATE SET quantity = quantity + EXCLUDED.quantity
                        `, [userId, itemId, quantity]);
                    }
                }
            } catch (e) {
                console.error('Ошибка парсинга предметов сундука:', e);
            }

            res.json({ 
                success: true, 
                message: 'Сундук успешно получен!',
                rewards: {
                    coins: coinsToAdd,
                    items: parsedItems
                }
            });
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});