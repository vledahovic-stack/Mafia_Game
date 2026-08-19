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
            const activeEnemies = room.players.filter(p => p.isAlive !== false && (p.team === 'Мафия' || p.role === 'Мафия'));
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
            const alivePeaceful = room.players.filter(p => p.isAlive !== false && p.team !== 'Мафия' && p.role !== 'Мафия').length;
            return aliveMafia >= alivePeaceful && aliveMafia > 0;
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
            const activeEnemies = room.players.filter(p => p.isAlive !== false && (p.team === 'Мафия' || p.role === 'Мафия'));
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
            const activeEnemies = room.players.filter(p => p.isAlive !== false && (p.team === 'Мафия' || p.role === 'Мафия'));
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

    const defaultSheriff = totalPlayers >= 4;
    if (isEnabled(rolesConfig.sheriff, defaultSheriff) && pool.length < totalPlayers) {
        pool.push(ROLES.SHERIFF.name);
    }

    const defaultDoctor = totalPlayers >= 4;
    if (isEnabled(rolesConfig.doctor, defaultDoctor) && pool.length < totalPlayers) {
        pool.push(ROLES.DOCTOR.name);
    }

    while (pool.length < totalPlayers) {
        pool.push(ROLES.CIVILIAN.name);
    }

    return pool;
}

function assignRoles(room) {
    const players = room.players;
    const totalPlayers = players.length;

    const rolePool = generateRolePool(totalPlayers, room.settings);
    rolePool.sort(() => Math.random() - 0.5);

    room.players.forEach((player, index) => {
        const roleName = rolePool[index];
        player.role = roleName;
        player.isAlive = true;

        const roleObj = Object.values(ROLES).find(r => r.name === roleName);
        player.team = roleObj ? roleObj.team : 'Мирные';
    });
}

function checkWinCondition(room, io) {
    if (!room || !room.players) return null;

    const rolesList = Object.values(ROLES);

    for (const roleObj of rolesList) {
        if (typeof roleObj.winCondition === 'function') {
            if (roleObj.winCondition(room)) {
                const winner = roleObj.team;

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