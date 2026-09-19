/**
 * audioChannels.js
 * Серверная логика управления правами на аудиочат и маршрутизацией WebRTC
 */

const { ROLES } = require('./rolesConfig');

/**
 * Проверяет, принадлежит ли игрок к черной команде (Мафия или Дон)
 */
function isMafiaMember(player) {
    if (!player) return false;
    const r = String(player.role || '').toLowerCase();
    const t = String(player.team || '').toLowerCase();
    return r.includes('мафия') || r.includes('дон') || t === 'мафия';
}

/**
 * Получает режим игры ('city' или 'sport')
 */
function getGameMode(room) {
    return room?.settings?.rules?.gameMode || room?.settings?.gameMode || 'city';
}

/**
 * Проверяет, имеет ли игрок право передавать аудио (включить микрофон) в текущий момент
 * @param {Object} room - Объект комнаты
 * @param {string} socketId - ID сокета игрока
 * @returns {boolean}
 */
function canPlayerSpeak(room, socketId) {
    if (!room || !room.players) return false;
    const player = room.players.find(p => p.id === socketId);
    if (!player) return false;

    // В лобби до начала игры все могут свободно говорить
    if (room.status === 'waiting' || !room.gameState) {
        return true;
    }

    const state = room.gameState;
    const isAlive = player.isAlive !== false;
    const pName = player.username || player.name;
    const gameMode = getGameMode(room);
    const isMafia = isMafiaMember(player);

    // Выбывшие игроки не могут говорить, кроме фазы 4 (их последнее слово)
    if (!isAlive) {
        if (state.phase === 4 && state.currentSpeaker === pName) {
            return true;
        }
        return false;
    }

    switch (state.phase) {
        case 0:
            // Фаза 0: Знакомство с ролью — полная тишина
            return false;

        case 0.5:
            // Фаза 0.5: Договорка — говорят ТОЛЬКО живые члены команды Мафии
            return isMafia;

        case 1:
            // Фаза 1: Общее собрание — говорят все живые игроки
            return isAlive;

        case 2:
        case 2.5:
            // Фаза 2 / 2.5: Индивидуальная / Оправдательная речь
            // Право говорить имеет ИСКЛЮЧИТЕЛЬНО текущий активный спикер
            return isAlive && (state.currentSpeaker === pName);

        case 3:
        case 3.5:
            // Фаза 3 / 3.5: Голосование — микрофоны заблокированы
            return false;

        case 4:
            // Фаза 4: Последнее слово — говорит только исключенный спикер
            return state.currentSpeaker === pName;

        case 5:
            // Фаза 5: Ночная фаза
            if (gameMode === 'city') {
                // Городская мафия: изолированный голосовой канал строго для живой Мафии
                return isAlive && isMafia;
            } else {
                // Спортивная мафия: ночью аудиочат Мафии полностью заблокирован (только фаза 0.5 Договорка)
                return false;
            }

        case 6:
            // Фаза 6: Игра завершена — все могут говорить
            return true;

        default:
            return false;
    }
}

/**
 * Проверяет, разрешено ли слушателю (listenerSocketId) слышать говорящего (speakerSocketId)
 * @param {Object} room - Объект комнаты
 * @param {string} speakerSocketId - ID сокета говорящего
 * @param {string} listenerSocketId - ID сокета слушающего
 * @returns {boolean}
 */
function canPlayerHear(room, speakerSocketId, listenerSocketId) {
    if (!room || !room.players) return false;
    if (speakerSocketId === listenerSocketId) return false;

    const speaker = room.players.find(p => p.id === speakerSocketId);
    const listener = room.players.find(p => p.id === listenerSocketId);
    if (!speaker || !listener) return false;

    // Если говорящему запрещено говорить, никто не должен его слышать
    if (!canPlayerSpeak(room, speakerSocketId)) {
        return false;
    }

    // В лобби и после окончания игры все слышат всех
    if (room.status === 'waiting' || !room.gameState || room.gameState.phase === 6) {
        return true;
    }

    const state = room.gameState;
    const isSpeakerMafia = isMafiaMember(speaker);
    const isListenerMafia = isMafiaMember(listener);
    const isListenerAlive = listener.isAlive !== false;
    const gameMode = getGameMode(room);

    // Ночные фазы: 0.5 (Договорка) и 5 (Ночь)
    if (state.phase === 0.5 || state.phase === 5) {
        if (state.phase === 0.5) {
            // Договорка: строго изолированный канал между живыми членами Мафии
            return isSpeakerMafia && isListenerMafia && isListenerAlive;
        }

        if (state.phase === 5) {
            if (gameMode === 'city') {
                // Городская мафия: изолированный голосовой канал строго между живыми членами Мафии
                // Мирные жители, Шериф, Маньяк и выбывшие игроки НЕ слышат ночные переговоры
                return isSpeakerMafia && isListenerMafia && isListenerAlive;
            } else {
                // Спортивная мафия: ночной канал Мафии отключен
                return false;
            }
        }
    }

    // Дневные фазы (1, 2, 2.5, 4): если спикер имеет право говорить, его слышат все участники комнаты
    return true;
}

/**
 * Возвращает объект с правами аудио для конкретного игрока
 */
function getAudioPermissionsForPlayer(room, socketId) {
    if (!room || !room.players) {
        return { canSpeak: false, allowedSpeakers: [] };
    }

    const canSpeak = canPlayerSpeak(room, socketId);
    const allowedSpeakers = room.players
        .filter(other => other.id !== socketId && canPlayerHear(room, other.id, socketId))
        .map(other => other.id);

    return {
        canSpeak,
        allowedSpeakers,
        phase: room.gameState ? room.gameState.phase : null
    };
}

/**
 * Рассылает актуальные права на аудиочат всем сокетам в комнате
 */
function broadcastAudioPermissions(room, io) {
    if (!room || !room.players || !io) return;

    room.players.forEach(p => {
        if (!p.id) return;
        const pSocket = io.sockets.sockets.get(p.id);
        if (pSocket) {
            const permissions = getAudioPermissionsForPlayer(room, p.id);
            pSocket.emit('audioPermissions', permissions);
        }
    });
}

module.exports = {
    isMafiaMember,
    getGameMode,
    canPlayerSpeak,
    canPlayerHear,
    getAudioPermissionsForPlayer,
    broadcastAudioPermissions
};
