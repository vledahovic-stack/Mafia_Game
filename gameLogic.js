const { ROLES, assignRoles, checkWinCondition } = require('./rolesConfig');

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
    }

    if (phase === 1 && generalMeetingTime === 0) {
        startIndividualSpeechPhase(room, io);
        return;
    }

    io.to(room.id).emit('gameStateUpdate', room.gameState);

    room.timer = setInterval(() => {
        if (room.gameState.timeLeft > 0) {
            room.gameState.timeLeft--;
            io.to(room.id).emit('gameStateUpdate', room.gameState);
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
    runSpeechTimer(room, io);
}

function runSpeechTimer(room, io) {
    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', room.gameState);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            nextSpeaker(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', room.gameState);
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

        io.to(room.id).emit('gameStateUpdate', room.gameState);
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

    io.to(room.id).emit('gameStateUpdate', room.gameState);

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
            io.to(room.id).emit('gameStateUpdate', room.gameState);
        }
    }, 1000);
}

function castVote(room, io, voterUsername, candidateName) {
    if (room.gameState && room.gameState.phase === 3) {
        if (room.gameState.votingCandidates.includes(candidateName)) {
            room.gameState.votes[voterUsername] = candidateName;
            io.to(room.id).emit('gameStateUpdate', room.gameState);
        }
    }
}

function tallyVotes(room, io) {
    const voteCounts = {};
    room.gameState.votingCandidates.forEach(c => voteCounts[c] = 0);

    const votesByCandidate = {};
    Object.entries(room.gameState.votes || {}).forEach(([voter, candidate]) => {
        if (!votesByCandidate[candidate]) votesByCandidate[candidate] = [];
        votesByCandidate[candidate].push(voter);
        if (voteCounts[candidate] !== undefined) {
            voteCounts[candidate]++;
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
            io.to(room.id).emit('gameStateUpdate', room.gameState);
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

    io.to(room.id).emit('gameStateUpdate', room.gameState);

    room.timer = setInterval(() => {
        if (!room.gameState) {
            clearInterval(room.timer);
            return;
        }

        room.gameState.timeLeft--;

        if (room.gameState.timeLeft <= 0) {
            nextDefenseSpeaker(room, io);
        } else {
            io.to(room.id).emit('gameStateUpdate', room.gameState);
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
    } else {
        clearInterval(room.timer);
        startVotingPhase(room, io, true);
    }
}

function eliminatePlayer(room, io, candidateName, isFromNight = false) {
    const player = room.players.find(p => p.username === candidateName || p.name === candidateName);
    if (player) {
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

    io.to(room.id).emit('gameStateUpdate', room.gameState);

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
            io.to(room.id).emit('gameStateUpdate', room.gameState);
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
    room.gameState.sheriffChecks = {};
    room.gameState.doctorHeals = {};
    room.gameState.doctorTarget = null;

    if (room.timer) clearInterval(room.timer);

    io.to(room.id).emit('gameStateUpdate', room.gameState);

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
            io.to(room.id).emit('gameStateUpdate', room.gameState);
        }
    }, 1000);
}

function skipNightPhase(room, io, username) {
    if (room.gameState && room.gameState.phase === 5) {
        const player = room.players.find(p => p.username === username || p.name === username);
        
        const civilianRoleName = ROLES.CIVILIAN ? ROLES.CIVILIAN.name : 'Мирный';
        if (player && player.isAlive !== false && player.role !== civilianRoleName) {
            if (!room.gameState.nightSkipVotes.includes(username)) {
                room.gameState.nightSkipVotes.push(username);
            }

            const activeRoles = room.players.filter(p => p.isAlive !== false && p.role !== civilianRoleName);
            
            if (room.gameState.nightSkipVotes.length >= activeRoles.length) {
                if (room.timer) clearInterval(room.timer);
                endNightPhase(room, io);
            } else {
                io.to(room.id).emit('gameStateUpdate', room.gameState);
            }
        }
    }
}

function endNightPhase(room, io) {
    room.gameState.day = (room.gameState.day || 1) + 1;

    const mafiaVotes = Object.values(room.gameState.nightVotes || {});
    if (mafiaVotes.length > 0) {
        const voteCounts = {};
        mafiaVotes.forEach(target => {
            voteCounts[target] = (voteCounts[target] || 0) + 1;
        });

        let maxVotes = 0;
        let selectedTarget = null;
        for (const [target, count] of Object.entries(voteCounts)) {
            if (count > maxVotes) {
                maxVotes = count;
                selectedTarget = target;
            }
        }
        room.gameState.nightTarget = selectedTarget;
    }

    let killedPlayerName = room.gameState.nightTarget || null;

    if (killedPlayerName && room.gameState.doctorTarget === killedPlayerName) {
        killedPlayerName = null;
    }

    room.lastHealedTarget = room.gameState.doctorTarget || null;

    const newsData = {
        killed: killedPlayerName,
        message: killedPlayerName 
            ? `Игрок ${killedPlayerName} съел несвежий пончик и попал в больницу. 🚑` 
            : (room.gameState.doctorTarget ? `Игрок ${room.gameState.doctorTarget} получил клизму и чувствует себя прекрасно!` : 'Сегодня ночью никто не отравился')
    };

    if (!room.gameLog) room.gameLog = [];
    room.gameLog.push({
        day: room.gameState.day,
        type: 'night_results',
        text: newsData.message
    });
    room.gameState.gameLog = room.gameLog;

    io.to(room.id).emit('nightNews', newsData);

    if (killedPlayerName) {
        eliminatePlayer(room, io, killedPlayerName, true);
    } else {
        setPhase(room, 1, io);
    }
}

function startGame(room, io) {
    assignRoles(room);

    room.players.forEach(player => {
        if (player.id) {
            io.to(player.id).emit('yourRole', { role: player.role });
        }
    });

    io.to(room.id).emit('updatePlayers', room.players);
    setPhase(room, 0, io);
}

module.exports = {
    startGame,
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
    endNightPhase
};