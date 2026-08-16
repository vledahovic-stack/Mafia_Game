// Реестр всех ролей игры
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

            // Запрет на изменение выбора, если он уже сделан
            if (room.gameState.sheriffChecks[speakerUsername]) {
                return null;
            }

            const targetPlayer = room.players.find(p => (p.username === targetName || p.name === targetName));
            if (!targetPlayer) return null;

            // Проверка по роли игрока
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

// Универсальная функция выполнения ночного действия
function executeRoleAction(roleName, room, speakerUsername, targetName) {
    const roleObject = Object.values(ROLES).find(r => r.name === roleName);
    
    if (roleObject && typeof roleObject.performAction === 'function') {
        return roleObject.performAction(room, speakerUsername, targetName);
    }
    return null;
}

// Динамическое формирование пула ролей
function generateRolePool(totalPlayers, roomSettings = {}) {
    let pool = [];

    // Добавляем обязательную 1 Мафию
    pool.push(ROLES.MAFIA.name);

    // Вторая Мафия при 6+ игроках
    if (totalPlayers >= 6) {
        pool.push(ROLES.MAFIA.name);
    }

    // Шериф при 4+ игроках
    if (totalPlayers >= 4) {
        pool.push(ROLES.SHERIFF.name);
    }

    // Доктор при 4+ игроках
    if (totalPlayers >= 4) {
        pool.push(ROLES.DOCTOR.name);
    }

    // Заполняем оставшиеся места Мирными жителями
    while (pool.length < totalPlayers) {
        pool.push(ROLES.CIVILIAN.name);
    }

    return pool;
}

module.exports = {
    ROLES,
    executeRoleAction,
    generateRolePool
};