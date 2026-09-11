const { XP_CONFIG } = require('./xpConfig');
const db = require('./database'); // <-- Подключите файл базы данных

const ROLES = {
    CIVILIAN: {
        id: 'civilian',
        name: 'Мирный житель',
        team: 'Мирные',
        hasNightPhase: false,
        hasNightAction: false,
        canChangeDayVote: true,
        canChangeNightVote: false,
        performAction: null,
        winCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const activeEnemies = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия' || p.team === 'Маньяк' || p.role === 'Маньяк');
            return activeEnemies.length === 0;
        }
    },

    MAFIA: {
        id: 'mafia',
        name: 'Мафия',
        nightHint: 'Кого угостить несвежим пончиком?',
        team: 'Мафия',
        hasNightPhase: true,
        hasNightAction: true,
        canChangeDayVote: true,
        canChangeNightVote: true,
        canSeeTeammates: true,
        performAction: (room, speakerUsername, targetName) => {
            if (!room.gameState.nightVotes) {
                room.gameState.nightVotes = {};
            }
            room.gameState.nightVotes[speakerUsername] = targetName;

            const aliveMafia = room.players.filter(p => p.isAlive !== false && (p.team === 'Мафия' || p.role === 'Мафия'));
            const votes = aliveMafia.map(p => room.gameState.nightVotes[p.username || p.name]);

            const firstVote = votes[0];
            const isUnanimous = votes.length > 0 && votes.every(v => v && v === firstVote);

            if (isUnanimous) {
                room.gameState.nightTarget = firstVote;
            } else {
                room.gameState.nightTarget = null;
            }
        },
        winCondition: (room) => {
            const aliveMafia = room.players.filter(p => p.isAlive !== false && (p.team === 'Мафия' || p.role === 'Мафия')).length;
            const aliveManiac = room.players.filter(p => p.isAlive !== false && (p.team === 'Маньяк' || p.role === 'Маньяк')).length;
            const alivePeaceful = room.players.filter(p => p.isAlive !== false && p.team !== 'Мафия' && p.role !== 'Мафия' && p.team !== 'Маньяк' && p.role !== 'Маньяк').length;
            
            // Если Маньяк еще жив — Мафия победить по перевесу сил не может, игра продолжается
            if (aliveManiac > 0) return false;

            return aliveMafia >= alivePeaceful && aliveMafia > 0;
        }
    },

    MANIAC: {
        id: 'maniac',
        name: 'Маньяк',
        nightHint: 'Кто сегодня пополнит вашу коллекцию?',
        team: 'Маньяк',
        hasNightPhase: true,
        hasNightAction: true,
        canChangeDayVote: true,
        canChangeNightVote: true,
        performAction: (room, speakerUsername, targetName) => {
            // Сохраняем имя выбранного игрока
            room.gameState.maniacTarget = targetName;
            return null;
        },
        winCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const aliveManiac = alivePlayers.filter(p => p.team === 'Маньяк' || p.role === 'Маньяк').length;
            const alivePeaceful = alivePlayers.filter(p => p.team === 'Мирные' || (p.team !== 'Мафия' && p.role !== 'Мафия' && p.team !== 'Маньяк' && p.role !== 'Маньяк')).length;
            const aliveMafia = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия').length;

            // Условие победы Маньяка: остался 1 на 1 с мирным игроком (или остался вообще один)
            if (aliveManiac === 1 && aliveMafia === 0 && alivePeaceful <= 1) {
                return true;
            }
            return false;
        },
        // Отдельное условие для проверки Ничьей (1х1 с Мафией)
        isDrawCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const aliveManiac = alivePlayers.filter(p => p.team === 'Маньяк' || p.role === 'Маньяк').length;
            const aliveMafia = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия').length;
            const alivePeaceful = alivePlayers.filter(p => p.team === 'Мирные' || (p.team !== 'Мафия' && p.role !== 'Мафия' && p.team !== 'Маньяк' && p.role !== 'Маньяк')).length;

            // Остались только 1 Маньяк и 1 Мафия (без мирных)
            return aliveManiac === 1 && aliveMafia === 1 && alivePeaceful === 0;
        }
    },

    SHERIFF: {
        id: 'sheriff',
        name: 'Шериф',
        nightHint: 'Чей багажник проверить?',
        team: 'Мирные',
        hasNightPhase: true,
        hasNightAction: true,
        canChangeDayVote: true,
        canChangeNightVote: false,
        performAction: (room, speakerUsername, targetName) => {
            if (!room.gameState.sheriffChecks) {
                room.gameState.sheriffChecks = {};
            }

            if (room.gameState.sheriffChecks[speakerUsername]) {
                return null;
            }

            const targetPlayer = room.players.find(p => (p.username === targetName || p.name === targetName));
            if (!targetPlayer) return null;

            const isMafia = targetPlayer.role === ROLES.MAFIA.name || targetPlayer.role === 'Мафия';

            // Начисление опыта Шерифу за обнаружение Мафии
            if (isMafia) {
                const sheriffPlayer = room.players.find(p => (p.username === speakerUsername || p.name === speakerUsername));
                if (sheriffPlayer) {
                    sheriffPlayer.earnedXp = (sheriffPlayer.earnedXp || 0) + XP_CONFIG.POINTS.ROLE_ACTION;
                }
            }

            const result = isMafia 
                ? `В багажнике игрока ${targetName} была обнаружена партия несвежих пончиков.` 
                : `Багажник игрока ${targetName} чист, как слеза: никаких улик, сплошная законопослушность!`;

            room.gameState.sheriffChecks[speakerUsername] = {
                target: targetName,
                result: result
            };

            return result;
        },
        winCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const activeEnemies = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия' || p.team === 'Маньяк' || p.role === 'Маньяк');
            return activeEnemies.length === 0;
        }
    },
	
    ZHIVCHIK: {
        id: 'zhivchik',
        name: 'Живчик',
        team: 'Мирные',
        hasNightPhase: false,
        hasNightAction: false,
        canChangeDayVote: true,
        canChangeNightVote: false,
        lives: 2, // Пассивное свойство: 2 жизни
        performAction: null,
        winCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const activeEnemies = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия' || p.team === 'Маньяк' || p.role === 'Маньяк');
            return activeEnemies.length === 0;
        }
    },

    DOCTOR: {
        id: 'doctor',
        name: 'Доктор',
        nightHint: 'Кого отправить на клизму?',
        team: 'Мирные',
        hasNightPhase: true,
        hasNightAction: true,
        canChangeDayVote: true,
        canChangeNightVote: true,
        performAction: (room, speakerUsername, targetName) => {
            if (room.lastHealedTarget === targetName) {
                return 'Нельзя лечить одного и того же игрока две ночи подряд.';
            }

            if (!room.gameState.doctorHeals) {
                room.gameState.doctorHeals = {};
            }

            room.gameState.doctorHeals[speakerUsername] = targetName;
            room.gameState.doctorTarget = targetName;
            
            return null;
        },
        winCondition: (room) => {
            const alivePlayers = room.players.filter(p => p.isAlive !== false);
            const activeEnemies = alivePlayers.filter(p => p.team === 'Мафия' || p.role === 'Мафия' || p.team === 'Маньяк' || p.role === 'Маньяк');
            return activeEnemies.length === 0;
        }
    }
};

function executeRoleAction(roleName, room, speakerUsername, targetName) {
    const roleObject = Object.values(ROLES).find(r => r.name === roleName);
    
    if (roleObject && typeof roleObject.performAction === 'function') {
        return roleObject.performAction(room, speakerUsername, targetName);
    }
    return null;
}

function generateRolePool(totalPlayers, roomSettings = {}) {
    let pool = [];
    const settings = roomSettings || {};
    const rolesConfig = settings.roles || settings;

    const isEnabled = (val, defaultValue) => {
        if (val === undefined || val === null) return defaultValue;
        return val === true || val === 'true' || val === 1 || val === '1';
    };

    pool.push(ROLES.MAFIA.name);

    if (isEnabled(rolesConfig.don, false) && ROLES.DON) {
        if (pool.length < totalPlayers) {
            pool.push(ROLES.DON.name);
        }
    }

    const extraMafiaCount = parseInt(rolesConfig.extraMafia);
    if (!isNaN(extraMafiaCount)) {
        for (let i = 0; i < extraMafiaCount; i++) {
            if (pool.length < totalPlayers) {
                pool.push(ROLES.MAFIA.name);
            }
        }
    } else if (totalPlayers >= 6 && pool.length < totalPlayers) {
        pool.push(ROLES.MAFIA.name);
    }

    // Добавление Маньяка в пул
    if (isEnabled(rolesConfig.maniac, false) && ROLES.MANIAC && pool.length < totalPlayers) {
        pool.push(ROLES.MANIAC.name);
    }

    const defaultSheriff = totalPlayers >= 4;
    if (isEnabled(rolesConfig.sheriff, defaultSheriff) && pool.length < totalPlayers) {
        pool.push(ROLES.SHERIFF.name);
    }

    const defaultDoctor = totalPlayers >= 4;
    if (isEnabled(rolesConfig.doctor, defaultDoctor) && pool.length < totalPlayers) {
        pool.push(ROLES.DOCTOR.name);
    }

    if (isEnabled(rolesConfig.zhivchik, false) && ROLES.ZHIVCHIK && pool.length < totalPlayers) {
        pool.push(ROLES.ZHIVCHIK.name);
    }

    while (pool.length < totalPlayers) {
        pool.push(ROLES.CIVILIAN.name);
    }

    return pool;
}

function assignRoles(room) {
    const players = room.players;
    const totalPlayers = players.length;

    let rolePool = generateRolePool(totalPlayers, room.settings);

    players.forEach(p => {
        p.isAlive = true;
        p.role = null;
    });

    const desiredPlayers = players.filter(p => p.desiredRole);
    desiredPlayers.sort(() => Math.random() - 0.5);

    desiredPlayers.forEach(player => {
        const targetRoleKey = player.desiredRole.toLowerCase();

        const foundRoleIndex = rolePool.findIndex(roleName => {
            const roleObj = Object.values(ROLES).find(r => r.name === roleName);
            if (!roleObj) return false;
            return roleObj.id.toLowerCase() === targetRoleKey || roleObj.name.toLowerCase().includes(targetRoleKey);
        });

        if (foundRoleIndex !== -1) {
            player.role = rolePool[foundRoleIndex];
            rolePool.splice(foundRoleIndex, 1);
        }

        delete player.desiredRole;
    });

    rolePool.sort(() => Math.random() - 0.5);

    players.forEach(player => {
        if (!player.role) {
            player.role = rolePool.pop();
        }

        const roleObj = Object.values(ROLES).find(r => r.name === player.role);
        player.team = roleObj ? roleObj.team : 'Мирные';

        player.lives = (roleObj && roleObj.lives) ? roleObj.lives : 1;
    });
}

function checkWinCondition(room, io) {
    if (!room || !room.players) return null;

    // 1. Проверка на ничью (1x1 Маньяк против Мафии)
    if (ROLES.MANIAC && ROLES.MANIAC.isDrawCondition && ROLES.MANIAC.isDrawCondition(room)) {
        const winner = 'Ничья';

        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }

        if (room.gameState) {
            room.gameState.phase = 6;
            room.gameState.phaseText = 'Игра окончена! Ничья между Мафией и Маньяком.';
            room.gameState.winner = winner;
        }

        room.isStarted = false;
        room.status = 'waiting';

        if (io && room.id) {
            io.to(room.id).emit('gameStateUpdate', room.gameState);
            io.to(room.id).emit('gameOver', { winner: winner });
        }

        setTimeout(() => {
            if (room.status === 'waiting' && room.gameState) {
                room.gameState.winner = null;
            }
        }, 1000);

        return winner;
    }

    // 2. Стандартная проверка условий победы ролей
    const rolesList = Object.values(ROLES);

    for (const roleObj of rolesList) {
        if (typeof roleObj.winCondition === 'function') {
            if (roleObj.winCondition(room)) {
                const winner = roleObj.team;

                // Начисление опыта за победу живым игрокам победившей команды
                room.players.forEach(player => {
                    if (player.isAlive !== false) {
                        const playerRoleObj = Object.values(ROLES).find(r => r.name === player.role);
                        if (playerRoleObj && playerRoleObj.team === winner) {
                            player.earnedXp = (player.earnedXp || 0) + XP_CONFIG.POINTS.WIN;
                        }
                    }
                });

                // Сохранение XP в базу данных
                room.players.forEach(player => {
                    const playerName = player.username || player.name;
                    const amount = player.earnedXp || 0;

                    if (amount > 0 && playerName) {
                        db.run(
                            `UPDATE users SET xp = xp + ? WHERE username = ?`,
                            [amount, playerName],
                            (err) => {
                                if (err) console.error(`Ошибка сохранения XP для ${playerName}:`, err.message);
                            }
                        );
                    }
                });

                if (room.timer) {
                    clearInterval(room.timer);
                    room.timer = null;
                }

                if (room.gameState) {
                    room.gameState.phase = 6;
                    room.gameState.phaseText = `Игра окончена! Победили ${winner}`;
                    room.gameState.winner = winner;
                }

                room.isStarted = false;
                room.status = 'waiting';

                if (io && room.id) {
                    io.to(room.id).emit('gameStateUpdate', room.gameState);
                    io.to(room.id).emit('gameOver', { winner: winner });
                }

                setTimeout(() => {
                    if (room.status === 'waiting' && room.gameState) {
                        room.gameState.winner = null;
                    }
                }, 1000);

                return winner;
            }
        }
    }
    return null;
}

module.exports = {
    ROLES,
    executeRoleAction,
    generateRolePool,
    assignRoles,
    checkWinCondition
};