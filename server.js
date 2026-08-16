const { ROLES, executeRoleAction, generateRolePool } = require('./rolesConfig');
const { startGame, setPhase, startIndividualSpeechPhase, finishSpeechEarly, nominateCandidate, castVote, skipNightPhase } = require('./gameLogic');
const { getDefaultSettings } = require('./gameSettings');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const rooms = {};

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

        db.run(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.json({ success: true, userId: this.lastID });
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

        res.json({ success: true, username: user.username });
    });
});

app.post('/api/rooms/create', (req, res) => {
    const roomId = 'room_' + Date.now();
    rooms[roomId] = {
        id: roomId,
        hostUsername: null,
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

io.on('connection', (socket) => {

    socket.on('joinRoom', ({ roomId, username }) => {
        if (!rooms[roomId]) return;

        const room = rooms[roomId];
        const clientName = username || 'Игрок_' + socket.id.substring(0, 4);

        if (!room.hostUsername) {
            room.hostUsername = clientName;
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
                username: clientName, 
                name: clientName, 
                isAlive: true 
            };
            room.players.push(player);
        } else {
            player.id = socket.id;
        }

        // Закрепляем ведущего на первом месте в списке
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

        // Сигналы инициализации аудиосвязи
        socket.emit('room-joined');
        socket.to(roomId).emit('user-joined', { userId: socket.id });
    });
	
	socket.on('signal', ({ target, signal }) => {
      io.to(target).emit('signal', {
        from: socket.id,
        signal
      });
    });

    // Добровольный выход из комнаты
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
                // Если ушел хост, передаем хоста следующему игроку
                if (socket.username === room.hostUsername) {
                    room.hostUsername = room.players[0].username || room.players[0].name;
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

    // Исключение игрока хостом комнаты
    socket.on('kickPlayer', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        if (room && socket.username === room.hostUsername) {
            const kickedPlayer = room.players.find(p => p.id === targetId);
            if (kickedPlayer) {
                socket.to(roomId).emit('user-left', { userId: targetId });
                room.players = room.players.filter(p => p.id !== targetId);
                
                // Отправляем кикнутому игроку сигнал и исключаем из сокета
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

    socket.on('nominateCandidate', ({ roomId, candidateName }) => {
        const room = rooms[roomId];
        if (room) {
            nominateCandidate(room, io, socket.username, candidateName);
        }
    });

    socket.on('castVote', ({ roomId, candidateName }) => {
        const room = rooms[roomId];
        if (room) {
            castVote(room, io, socket.username, candidateName);
        }
    });

    // Ночной ход игрока (Мафия, Шериф, Доктор)
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
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
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
                delete rooms[roomId];
            } else {
                room.players.sort((a, b) => (a.username === room.hostUsername ? -1 : b.username === room.hostUsername ? 1 : 0));
                io.to(roomId).emit('updatePlayers', room.players);
                if (room.gameState) {
                    room.gameState.players = room.players;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
                }
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});