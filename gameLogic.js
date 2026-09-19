const { ROLES, assignRoles, checkWinCondition } = require('./rolesConfig');
const { XP_CONFIG } = require('./xpConfig');
const { broadcastAudioPermissions } = require('./audioChannels');

// Очищает gameState от таймеров Node.js перед socket.emit (предотвращает "circular structure" ошибку)
function sanitizeGameState(gs) {
    if (!gs) return gs;
    const { timer, ...rest } = gs;
    return rest;
}

// Логика фаз игры и общего игрового процесса

function setPhase(room, phase, io) {
    let phaseText = '';
    let duration = 0;

    const generalMeetingTime = room.settings?.timers?.generalMeeting ?? 60;

    if (phase === 0) {
        phaseText = 'Фаза 0: Знакомство с ролью';
        duration = 5;
    } else if (phase === 1) {
        phaseText = `Фаза 1: Общее собрание (День ${room.gameState ? room.gameState.day : 1})`;
        duration = generalMeetingTime;
    }

    room.gameState = {
        phase: phase,
        phaseText: phaseText,
        day: room.gameState ? room.gameState.day : 1,
        timeLeft: duration,
        skipVotes: 0,
        requiredVotes: Math.ceil(room.players.filter(p => p.isAlive !== false).length * 0.7),
        players: room.players,
        gameLog: room.gameLog || []
    };

    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    if (phase === 1 && generalMeetingTime === 0) {
        startIndividualSpeechPhase(room, io);
        return;
    }

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (room.gameState.timeLeft > 0) {
            room.gameState.timeLeft--;
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        } else {
            clearInterval(room.timer);
            if (phase === 0) {
                setPhase(room, 1, io);
            } else if (phase === 1) {
                startIndividualSpeechPhase(room, io);
            }
        }
    }, 1000);
}

function startIndividualSpeechPhase(room, io) {
    const activePlayers = room.players.filter(p => p.isAlive !== false);
    
    if (activePlayers.length === 0) return;

    const dayOffset = (room.gameState.day - 1) % activePlayers.length;
    const queue = [
        ...activePlayers.slice(dayOffset),
        ...activePlayers.slice(0, dayOffset)
    ];

    const speechDuration = room.settings?.timers?.individualSpeech ?? 60;

    room.gameState.phase = 2; // Фаза 2: Индивидуальная речь
    room.gameState.phaseText = 'Фаза 2: Индивидуальная речь';
    room.gameState.speakersQueue = queue.map(p => p.username || p.name);
    room.gameState.currentSpeakerIndex = 0;
    room.gameState.currentSpeaker = queue[0].username || queue[0].name;
    room.gameState.timeLeft = speechDuration;
    room.gameState.speechDuration = speechDuration;
    room.gameState.nominatedCandidates = [];
    room.gameState.speakerNominations = {};

    notifySpeakerStart(room, io, room.gameState.currentSpeaker);
    broadcastAudioPermissions(room, io);
    runSpeechTimer(room, io);
}

function runSpeechTimer(room, io) {
    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            nextSpeaker(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

function nextSpeaker(room, io) {
    room.gameState.currentSpeakerIndex++;

    if (room.gameState.currentSpeakerIndex < room.gameState.speakersQueue.length) {
        const nextSpeakerName = room.gameState.speakersQueue[room.gameState.currentSpeakerIndex];
        room.gameState.currentSpeaker = nextSpeakerName;
        room.gameState.timeLeft = room.gameState.speechDuration;

        notifySpeakerStart(room, io, nextSpeakerName);
        broadcastAudioPermissions(room, io);
        runSpeechTimer(room, io);
    } else {
        clearInterval(room.timer);
        
        const isFirstDay = room.gameState.day === 1;
        const allowFirstDayVoting = room.settings?.rules?.firstDayVoting ?? true;

        if (isFirstDay && !allowFirstDayVoting) {
            startNightPhase(room, io);
        } else {
            startVotingPhase(room, io);
        }
    }
}

function nominateCandidate(room, io, speakerUsername, candidateName) {
    if (room.gameState && room.gameState.phase === 2) {
        if (room.gameState.currentSpeaker !== speakerUsername) return;

        const candidate = room.players.find(p => (p.username === candidateName || p.name === candidateName) && p.isAlive !== false);
        if (!candidate) return;

        if (!room.gameState.speakerNominations) {
            room.gameState.speakerNominations = {};
        }

        const currentNomination = room.gameState.speakerNominations[speakerUsername];

        if (currentNomination === candidateName) {
            delete room.gameState.speakerNominations[speakerUsername];
        } else {
            room.gameState.speakerNominations[speakerUsername] = candidateName;

            const currentDay = room.gameState?.day || 1;
            if (!room.gameLog) room.gameLog = [];
            room.gameLog.push({
                day: currentDay,
                type: 'nomination',
                text: `Игрок ${speakerUsername} выдвинул кандидатуру ${candidateName}`
            });
        }

        room.gameState.nominatedCandidates = Array.from(new Set(Object.values(room.gameState.speakerNominations)));

        if (room.gameState) {
            room.gameState.gameLog = room.gameLog || [];
        }

        io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    }
}

function finishSpeechEarly(room, io, username) {
    if (!room.gameState) return;

    if (room.gameState.phase === 2 && room.gameState.currentSpeaker === username) {
        nextSpeaker(room, io);
    } else if (room.gameState.phase === 2.5 && room.gameState.currentSpeaker === username) {
        nextDefenseSpeaker(room, io);
    } else if (room.gameState.phase === 4 && room.gameState.currentSpeaker === username) {
        if (room.timer) clearInterval(room.timer);
        if (room.gameState.isFromNight) {
            setPhase(room, 1, io);
        } else {
            startNightPhase(room, io);
        }
    }
}

function notifySpeakerStart(room, io, speakerName) {
    const speaker = room.players.find(p => (p.username === speakerName || p.name === speakerName));
    if (speaker && speaker.id) {
        io.to(speaker.id).emit('playSpeakerSignal');
    }
}

function startVotingPhase(room, io, isTieBreaker = false) {
    const candidates = isTieBreaker ? room.gameState.tieCandidates : room.gameState.nominatedCandidates;

    if (!candidates || candidates.length === 0) {
        startNightPhase(room, io);
        return;
    }

    if (candidates.length === 1 && !isTieBreaker) {
        eliminatePlayer(room, io, candidates[0], false);
        return;
    }

    room.gameState.phase = 3;
    room.gameState.phaseText = isTieBreaker ? 'Повторное голосование' : 'Фаза 3: Голосование';
    room.gameState.votingCandidates = candidates;
    room.gameState.votes = {};
    room.gameState.timeLeft = 30;
    room.gameState.isTieBreaker = isTieBreaker;

    const currentDay = room.gameState?.day || 1;
    if (!room.gameLog) room.gameLog = [];
    room.gameLog.push({
        day: currentDay,
        type: 'voting_start',
        text: isTieBreaker ? 'Началось повторное голосование' : 'Началось голосование'
    });

    if (room.gameState) {
        room.gameState.gameLog = room.gameLog || [];
    }

    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            tallyVotes(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

function castVote(room, io, voterUsername, candidateName) {
    if (!room.gameState || room.gameState.phase !== 3) return;

    const voter = room.players.find(p => (p.username === voterUsername || p.name === voterUsername) && p.isAlive !== false);
    if (!voter) return;

    if (!room.gameState.votingCandidates || !room.gameState.votingCandidates.includes(candidateName)) {
        return;
    }

    // При дуэли (переголосование между 2 игроками) кандидаты лишаются права голоса
    const isTieBreakerDuel = room.gameState.isTieBreaker && room.gameState.votingCandidates.length === 2;
    if (isTieBreakerDuel) {
        const voterDisplayName = voter.username || voter.name || voterUsername;
        if (
            room.gameState.votingCandidates.includes(voterUsername) ||
            room.gameState.votingCandidates.includes(voterDisplayName) ||
            (voter.username && room.gameState.votingCandidates.includes(voter.username)) ||
            (voter.name && room.gameState.votingCandidates.includes(voter.name))
        ) {
            return;
        }
    }

    if (!room.gameState.votes) {
        room.gameState.votes = {};
    }

    room.gameState.votes[voterUsername] = candidateName;
    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
}

function tallyVotes(room, io) {
    const voteCounts = {};
    room.gameState.votingCandidates.forEach(c => voteCounts[c] = 0);

    const isTieBreakerDuel = room.gameState.isTieBreaker && room.gameState.votingCandidates.length === 2;

    const votesByCandidate = {};
    Object.entries(room.gameState.votes || {}).forEach(([voter, candidate]) => {
        const voterPlayer = room.players.find(p => (p.username === voter || p.name === voter) && p.isAlive !== false);
        if (!voterPlayer) return;

        // Если это дуэль на переголосовании, исключаем голоса самих кандидатов дуэли
        if (isTieBreakerDuel) {
            const voterDisplayName = voterPlayer.username || voterPlayer.name || voter;
            if (
                room.gameState.votingCandidates.includes(voter) ||
                room.gameState.votingCandidates.includes(voterDisplayName) ||
                (voterPlayer.username && room.gameState.votingCandidates.includes(voterPlayer.username)) ||
                (voterPlayer.name && room.gameState.votingCandidates.includes(voterPlayer.name))
            ) {
                return;
            }
        }

        if (!room.gameState.votingCandidates.includes(candidate)) return;

        if (!votesByCandidate[candidate]) votesByCandidate[candidate] = [];
        votesByCandidate[candidate].push(voter);
        if (voteCounts[candidate] !== undefined) {
            voteCounts[candidate]++;
        }

        // Начисление опыта за точный дневной голос
        const candidatePlayer = room.players.find(p => (p.username === candidate || p.name === candidate));

        if (voterPlayer && candidatePlayer) {
            const isVoterMafia = voterPlayer.team === 'Мафия';
            const isCandidateMafia = candidatePlayer.team === 'Мафия';
            const isCandidateSheriff = candidatePlayer.role === (ROLES.SHERIFF ? ROLES.SHERIFF.name : 'Шериф');

            if (!isVoterMafia && isCandidateMafia) {
                voterPlayer.earnedXp = (voterPlayer.earnedXp || 0) + XP_CONFIG.POINTS.CORRECT_VOTE;
            } else if (isVoterMafia && isCandidateSheriff) {
                voterPlayer.earnedXp = (voterPlayer.earnedXp || 0) + XP_CONFIG.POINTS.CORRECT_VOTE;
            }
        }
    });

    let votingSummary = Object.entries(voteCounts)
        .map(([candidate, count]) => {
            const voters = votesByCandidate[candidate] ? votesByCandidate[candidate].join(', ') : 'никто';
            return `${candidate} (${count}): ${voters}`;
        })
        .join(' | ');

    const currentDay = room.gameState?.day || 1;
    if (!room.gameLog) room.gameLog = [];
    room.gameLog.push({
        day: currentDay,
        type: 'voting_results',
        text: `Итоги голосования: ${votingSummary}`
    });

    if (room.gameState) {
        room.gameState.gameLog = room.gameLog || [];
    }

    let maxVotes = -1;
    let leaders = [];

    Object.keys(voteCounts).forEach(candidate => {
        const count = voteCounts[candidate];
        if (count > maxVotes) {
            maxVotes = count;
            leaders = [candidate];
        } else if (count === maxVotes) {
            leaders.push(candidate);
        }
    });

    if (leaders.length === 1) {
        eliminatePlayer(room, io, leaders[0], false);
    } else {
        if (room.gameState.isTieBreaker) {
            room.gameState.phaseText = 'Повторная ничья. Никто не выбывает';
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
            setTimeout(() => startNightPhase(room, io), 3000);
        } else {
            startDefenseSpeeches(room, io, leaders);
        }
    }
}

function startDefenseSpeeches(room, io, tiedCandidates) {
    room.gameState.phase = 2.5;
    room.gameState.phaseText = 'Оправдательная речь';
    room.gameState.tieCandidates = tiedCandidates;
    room.gameState.speakersQueue = [...tiedCandidates];
    room.gameState.currentSpeakerIndex = 0;
    room.gameState.currentSpeaker = tiedCandidates[0];
    room.gameState.timeLeft = 30;
    room.gameState.speechDuration = 30;

    notifySpeakerStart(room, io, room.gameState.currentSpeaker);

    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            nextDefenseSpeaker(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

function nextDefenseSpeaker(room, io) {
    room.gameState.currentSpeakerIndex++;

    if (room.gameState.currentSpeakerIndex < room.gameState.speakersQueue.length) {
        const nextSpeakerName = room.gameState.speakersQueue[room.gameState.currentSpeakerIndex];
        room.gameState.currentSpeaker = nextSpeakerName;
        room.gameState.timeLeft = 30;

        notifySpeakerStart(room, io, nextSpeakerName);
        broadcastAudioPermissions(room, io);
    } else {
        clearInterval(room.timer);
        startVotingPhase(room, io, true);
    }
}

function eliminatePlayer(room, io, candidateName, isFromNight = false) {
    const player = room.players.find(p => p.username === candidateName || p.name === candidateName);
    
    if (player) {
        const currentLives = player.lives || 1;
        
        if (currentLives > 1) {
            player.lives = currentLives - 1;
            return;
        }
        
        player.lives = 0;
        player.isAlive = false;
    }

    const currentDay = room.gameState?.day || 1;
    if (!room.gameLog) room.gameLog = [];
    room.gameLog.push({
        day: currentDay,
        type: isFromNight ? 'night_kill' : 'day_kill',
        text: isFromNight 
            ? `По итогам ночи был исключён игрок ${candidateName}` 
            : `По итогам дня был исключён игрок ${candidateName}`
    });

    if (room.gameState) {
        room.gameState.gameLog = room.gameLog;
    }

    broadcastAudioPermissions(room, io);

    if (checkWinCondition(room, io)) {
        return;
    }

    startLastWordPhase(room, io, candidateName, isFromNight);
}

function startLastWordPhase(room, io, candidateName, isFromNight = false) {
    const speechDuration = room.settings?.timers?.individualSpeech ?? 60;

    room.gameState.phase = 4;
    room.gameState.phaseText = `${candidateName} отправляется варить кофе для всех.`;
    room.gameState.currentSpeaker = candidateName;
    room.gameState.timeLeft = speechDuration;
    room.gameState.isFromNight = isFromNight;

    notifySpeakerStart(room, io, candidateName);

    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            if (room.gameState.isFromNight) {
                setPhase(room, 1, io);
            } else {
                startNightPhase(room, io);
            }
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

function startNightPhase(room, io) {
    room.gameState.phase = 5;
    room.gameState.phaseText = 'Ночь... Наступает время ролей';
    room.gameState.timeLeft = 30;
    room.gameState.nightSkipVotes = [];

    room.gameState.nightVotes = {};
    room.gameState.nightTarget = null;
    room.gameState.maniacTarget = null;
    room.gameState.sheriffChecks = {};
    room.gameState.donChecks = {}; // <-- Сброс ночной проверки Дона
    room.gameState.doctorHeals = {};
    room.gameState.doctorTarget = null;

    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            endNightPhase(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

function skipNightPhase(room, io, username) {
    if (room.gameState && room.gameState.phase === 5) {
        const player = room.players.find(p => p.username === username || p.name === username);
        
        const civilianRoleName = ROLES.CIVILIAN ? ROLES.CIVILIAN.name : 'Мирный житель';
        if (player && player.isAlive !== false && player.role !== civilianRoleName) {
            if (!room.gameState.nightSkipVotes.includes(username)) {
                room.gameState.nightSkipVotes.push(username);
            }

            const activeRoles = room.players.filter(p => p.isAlive !== false && p.role !== civilianRoleName);
            
            if (room.gameState.nightSkipVotes.length >= activeRoles.length) {
                if (room.timer) clearInterval(room.timer);
                endNightPhase(room, io);
            } else {
                io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
            }
        }
    }
}

/**
 * Этап 1 ночного хода Дона: проверка игрока на статус Шерифа (roleAction).
 * Вызывается только один раз за ночь.
 * После успешной проверки устанавливает donChecks[username], чтобы
 * клиент знал, что пора переходить ко второму этапу (выстрелу).
 */
function handleRoleAction(room, speakerUsername, roleName, targetName, extraParams = {}) {
    if (!room || !room.gameState || room.gameState.phase !== 5) return null;

    const player = room.players.find(p => (p.username === speakerUsername || p.name === speakerUsername) && p.isAlive !== false);
    if (!player) return null;

    const donRoleName = ROLES.DON ? ROLES.DON.name : 'Дон мафии';

    if (roleName === donRoleName) {
        if (!room.gameState.donChecks) room.gameState.donChecks = {};

        // Если Дон уже сделал проверку в эту ночь — повторная проверка запрещена.
        // Выстрел обрабатывается отдельной функцией handleDonShot.
        if (room.gameState.donChecks[speakerUsername]) {
            return { error: 'Дон уже совершил проверку в эту ночь. Используйте nightAction для выстрела.' };
        }

        // Делегируем проверку в performAction роли DON.
        // performAction сам установит donChecks[speakerUsername] при успехе.
        return ROLES.DON.performAction(room, speakerUsername, targetName, extraParams);
    }

    const roleKey = Object.keys(ROLES).find(k => ROLES[k].name === roleName);
    if (roleKey && typeof ROLES[roleKey].performAction === 'function') {
        return ROLES[roleKey].performAction(room, speakerUsername, targetName, extraParams);
    }

    return null;
}

/**
 * Этап 2 ночного хода Дона: ночной выстрел мафии (nightAction).
 * Разрешён только после того, как Дон уже совершил проверку (donChecks установлен).
 * Записывает голос Дона в nightVotes.
 * В городском режиме: голос Дона имеет приоритет при разногласиях.
 * В спортивном режиме: убийство только при 100% единогласии.
 */
function handleDonShot(room, speakerUsername, targetName) {
    if (!room || !room.gameState || room.gameState.phase !== 5) return null;

    const player = room.players.find(p =>
        (p.username === speakerUsername || p.name === speakerUsername) && p.isAlive !== false
    );
    if (!player) return null;

    const donRoleName = ROLES.DON ? ROLES.DON.name : 'Дон мафии';
    if (player.role !== donRoleName) return null;

    if (!room.gameState.donChecks) room.gameState.donChecks = {};

    // Выстрел разрешён только после проверки
    if (!room.gameState.donChecks[speakerUsername]) {
        return { error: 'Дон должен сначала сделать проверку (roleAction) перед выстрелом.' };
    }

    if (!room.gameState.nightVotes) room.gameState.nightVotes = {};
    room.gameState.nightVotes[speakerUsername] = targetName;

    // Пересчитываем предварительную цель в зависимости от режима игры
    const gameMode = (room.settings && room.settings.gameMode) ||
                     (room.settings && room.settings.rules && room.settings.rules.gameMode) ||
                     'city';
    const mafiaRoleName = ROLES.MAFIA ? ROLES.MAFIA.name : 'Мафия';
    const aliveMafia = room.players.filter(p =>
        p.isAlive !== false &&
        (p.role === mafiaRoleName || p.role === donRoleName || p.team === 'Мафия')
    );
    const votes = aliveMafia
        .map(p => room.gameState.nightVotes[p.username || p.name])
        .filter(Boolean);
    const isUnanimous = votes.length > 0 && votes.every(v => v === votes[0]);

    if (gameMode === 'sport') {
        const allVoted = votes.length === aliveMafia.length;
        room.gameState.nightTarget = (allVoted && isUnanimous) ? votes[0] : null;
    } else {
        // city: единогласие → убиваем, разногласие → решение за Доном
        if (isUnanimous) {
            room.gameState.nightTarget = votes[0];
        } else {
            room.gameState.nightTarget = targetName; // голос Дона имеет приоритет
        }
    }

    return `Цель для выстрела мафии зафиксирована: ${targetName}`;
}

function endNightPhase(room, io) {
    room.gameState.day = (room.gameState.day || 1) + 1;

    // 1. Определение цели Мафии (с учетом городского и спортивного режимов)
    const gameMode = room.settings?.gameMode || 'city';
    const donRoleName = ROLES.DON ? ROLES.DON.name : 'Дон мафии';
    const mafiaRoleName = ROLES.MAFIA ? ROLES.MAFIA.name : 'Мафия';

    const aliveMafia = room.players.filter(p => p.isAlive !== false && (p.role === mafiaRoleName || p.role === donRoleName || p.team === 'Мафия'));
    const mafiaVotesMap = room.gameState.nightVotes || {};
    const votes = aliveMafia.map(p => mafiaVotesMap[p.username || p.name]).filter(Boolean);

    let mafiaTarget = null;

    if (gameMode === 'sport') {
        // В спортивном режиме требуются голоса ВСЕХ живых мафиози и 100% единогласие
        const allVoted = votes.length === aliveMafia.length && aliveMafia.length > 0;
        const isUnanimous = votes.length > 0 && votes.every(v => v === votes[0]);
        
        if (allVoted && isUnanimous) {
            mafiaTarget = votes[0];
        } else {
            mafiaTarget = null; // Промах при любом расхождении или недоголосовании
        }
    } else {
        // В городском режиме: при единогласии — убиваем, при разногласиях — решение за Доном
        const isUnanimous = votes.length > 0 && votes.every(v => v === votes[0]);
        if (isUnanimous) {
            mafiaTarget = votes[0];
        } else {
            const donPlayer = aliveMafia.find(p => p.role === donRoleName);
            if (donPlayer && mafiaVotesMap[donPlayer.username || donPlayer.name]) {
                mafiaTarget = mafiaVotesMap[donPlayer.username || donPlayer.name];
            } else if (votes.length > 0) {
                // Если Дона нет или он не проголосовал — большинством голосов
                const voteCounts = {};
                votes.forEach(target => { voteCounts[target] = (voteCounts[target] || 0) + 1; });
                let maxVotes = 0;
                for (const [target, count] of Object.entries(voteCounts)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        mafiaTarget = target;
                    }
                }
            }
        }
    }

    room.gameState.nightTarget = mafiaTarget;

    const maniacTarget = room.gameState.maniacTarget || null;
    const doctorTarget = room.gameState.doctorTarget || null;

    let killedPlayers = []; // Игроки, атакованные ночью
    let savedPlayers = [];  // Игроки, спасённые Доктором

    // 2. Проверка лечения Доктора (спасает от Мафии или от Маньяка)
    if (doctorTarget) {
        if (doctorTarget === mafiaTarget || doctorTarget === maniacTarget) {
            savedPlayers.push(doctorTarget);

            // Начисление XP Доктору за успешное лечение
            const doctorRole = ROLES.DOCTOR ? ROLES.DOCTOR.name : 'Доктор';
            const doctor = room.players.find(p => p.isAlive !== false && p.role === doctorRole);
            if (doctor) {
                doctor.earnedXp = (doctor.earnedXp || 0) + XP_CONFIG.POINTS.ROLE_ACTION;
            }
        }
    }

    // 3. Обработка атаки Мафии
    if (mafiaTarget && mafiaTarget !== doctorTarget) {
        killedPlayers.push(mafiaTarget);

        // Начисление XP Мафии и Дону за точный выстрел
        room.players
            .filter(p => p.isAlive !== false && (p.role === mafiaRoleName || p.role === donRoleName || p.team === 'Мафия'))
            .forEach(mafia => {
                mafia.earnedXp = (mafia.earnedXp || 0) + XP_CONFIG.POINTS.ROLE_ACTION;
            });
    }

    // 4. Обработка атаки Маньяка
    if (maniacTarget && maniacTarget !== doctorTarget) {
        if (!killedPlayers.includes(maniacTarget)) {
            killedPlayers.push(maniacTarget);
        }

        // Начисление XP Маньяку за удачное нападение
        const maniacRole = ROLES.MANIAC ? ROLES.MANIAC.name : 'Маньяк';
        const maniac = room.players.find(p => p.isAlive !== false && p.role === maniacRole);
        if (maniac) {
            maniac.earnedXp = (maniac.earnedXp || 0) + XP_CONFIG.POINTS.ROLE_ACTION;
        }
    }

    room.lastHealedTarget = doctorTarget;

    // 5. Расчёт урона и жизней (учитывая Живчика с 2 жизнями)
    const actuallyEliminated = [];

    killedPlayers.forEach(targetName => {
        const victim = room.players.find(p => (p.username === targetName || p.name === targetName) && p.isAlive !== false);
        if (victim) {
            const currentLives = victim.lives || 1;
            if (currentLives > 1) {
                victim.lives = currentLives - 1;
            } else {
                victim.lives = 0;
                victim.isAlive = false;
                actuallyEliminated.push(targetName);
            }
        }
    });

    // 6. Формирование сообщения для ночной сводки
    let newsMessages = [];
    if (actuallyEliminated.length > 0) {
        newsMessages.push(`Ночью погибли: ${actuallyEliminated.join(', ')}.`);
    }
    if (savedPlayers.length > 0) {
        newsMessages.push(`Доктор спас игрока ${savedPlayers.join(', ')}!`);
    }
    if (actuallyEliminated.length === 0 && savedPlayers.length === 0) {
        newsMessages.push('Сегодня ночью никто не отравился.');
    }

    const newsMessage = newsMessages.join(' ');
    const newsData = {
        killed: actuallyEliminated.length > 0 ? actuallyEliminated : null,
        message: newsMessage
    };

    if (!room.gameLog) room.gameLog = [];
    room.gameLog.push({
        day: room.gameState.day,
        type: 'night_results',
        text: newsData.message
    });
    room.gameState.gameLog = room.gameLog;

    // Сброс всех целей перед новым днём
    room.gameState.maniacTarget = null;
    room.gameState.nightTarget = null;
    room.gameState.doctorTarget = null;

    io.to(room.id).emit('nightNews', newsData);

    // 7. Проверка победы
    if (checkWinCondition(room, io)) {
        return;
    }

    // 8. Переход к первому дневному обсуждению или последнему слову
    if (actuallyEliminated.length > 0) {
        startLastWordPhase(room, io, actuallyEliminated[0], true);
    } else {
        setPhase(room, 1, io);
    }
}

function handleDonCheck(room, donSocketId, targetName) {
    const targetPlayer = room.players.find(p => (p.username || p.name) === targetName);
    if (!targetPlayer) return;

    const isSheriff = targetPlayer.role && targetPlayer.role.includes('Шериф');
    const resultText = isSheriff
        ? `Игрок ${targetName} — Шериф!`
        : `Игрок ${targetName} — НЕ Шериф.`;

    // Исправлено: было room.state (несуществующее поле), теперь room.gameState
    if (!room.gameState) return resultText;
    if (!room.gameState.donChecks) {
        room.gameState.donChecks = {};
    }

    const donPlayer = room.players.find(p => p.id === donSocketId);
    if (donPlayer) {
        const donName = donPlayer.username || donPlayer.name;
        room.gameState.donChecks[donName] = { target: targetName, result: resultText };
    }

    return resultText;
}

function startGame(room, io) {
    assignRoles(room);

    room.players.forEach(player => {
        player.earnedXp = 0;
        if (player.id) {
            io.to(player.id).emit('yourRole', { role: player.role });
        }
    });

    io.to(room.id).emit('updatePlayers', room.players);
    broadcastAudioPermissions(room, io);

    // Проверяем условия запуска стартовой договорки:
    // 1) Режим «Спортивная мафия»
    // 2) В роздаче есть Дон
    const gameMode = room.settings?.rules?.gameMode || room.settings?.gameMode || 'city';
    const donRoleName = ROLES.DON ? ROLES.DON.name : 'Дон мафии';
    const hasDon = room.players.some(p => p.role === donRoleName);

    if (gameMode === 'sport' && hasDon) {
        startMafiaHuddle(room, io);
    } else {
        setPhase(room, 0, io);
    }
}

/**
 * Стартовая договорка чёрной команды (phase = 0.5).
 * Запускается ОДИН РАЗ за партию — до первых суток.
 * Активна только при: Спортивная мафия + роль Дона в составе.
 * Чёрные игроки (Мафия / Дон) получают 60 секунд на закрытое общение.
 * Остальные «спят» — их UI показывает экран ожидания, микрофоны заглушены.
 * По истечении таймера автоматически переход к фазе 0 (знакомство с ролью).
 */
function startMafiaHuddle(room, io) {
    const HUDDLE_DURATION = 60;

    room.gameState = {
        phase: 0.5,
        phaseText: 'Договорка: Мафия совещается',
        day: 1,
        timeLeft: HUDDLE_DURATION,
        huddleDone: true,      // Флаг однократности — больше фаза не повторяется
        players: room.players,
        gameLog: room.gameLog || []
    };

    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
    broadcastAudioPermissions(room, io);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            // Договорка завершена — переходим к стандартному знакомству с ролью
            setPhase(room, 0, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', sanitizeGameState(room.gameState));
        }
    }, 1000);
}

module.exports = {
    startGame,
    startMafiaHuddle,
    setPhase,
    startIndividualSpeechPhase,
    finishSpeechEarly,
    nominateCandidate,
    castVote,
    startVotingPhase,
    tallyVotes,
    eliminatePlayer,
    startLastWordPhase,
    startNightPhase,
    skipNightPhase,
    handleRoleAction,
    handleDonShot,
    handleDonCheck,
    endNightPhase
};