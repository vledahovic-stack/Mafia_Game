import { AudioModule } from './audio.js';
const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || urlParams.get('id');
const username = localStorage.getItem('username') || 'Игрок_' + Math.floor(Math.random() * 1000);

let myRole = 'Мирный житель';
let currentSettings = null;
let myNominatedCandidate = null;
let lastSpeaker = null;
let isMicOn = true;
let myBlacklist = [];

let lastPhase = null;
let lastSpeakerName = null;
let lastStateJSON = '';

function createAudioButton(player, socketId) {
    const isMe = (player.id === socketId);
    const btn = document.createElement('button');
    btn.className = 'card-audio-btn';
    btn.style.margin = '5px';
    btn.style.padding = '2px 6px';
    btn.style.fontSize = '0.8rem';

    const updateBtnText = (muted) => {
        if (isMe) {
            btn.textContent = isMicOn ? '🎙️ Микрофон' : '🔇 Выкл';
        } else {
            btn.textContent = muted ? '🔇 Вкл звук' : '🔊 Выкл звук';
        }
    };

    if (isMe) {
        updateBtnText(false);
        btn.onclick = async () => {
            try {
                isMicOn = !isMicOn;
                await AudioModule.toggleMicrophone(isMicOn);
                updateBtnText();
            } catch (err) {
                alert('Браузер заблокировал микрофон. Разрешите доступ к микрофону в настройках браузера.');
            }
        };
    } else {
        const audioEl = document.getElementById(`audio-${player.id}`);
        updateBtnText(audioEl ? audioEl.muted : false);
        
        btn.onclick = () => {
            const targetAudio = document.getElementById(`audio-${player.id}`);
            if (targetAudio) {
                targetAudio.muted = !targetAudio.muted;
                updateBtnText(targetAudio.muted);
            } else {
                alert('Аудиопоток игрока еще не готов.');
            }
        };
    }
    return btn;
}

const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const startGameBtn = document.getElementById('start-game-btn');
const openSettingsBtn = document.getElementById('open-settings-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsForm = document.getElementById('settings-form');
const dayCounter = document.getElementById('day-counter');
const gamePhase = document.getElementById('game-phase');
const phaseTimer = document.getElementById('phase-timer');
const playersGrid = document.getElementById('players-grid');
const skipPhaseBtn = document.getElementById('skip-phase-btn');
const skipCountSpan = document.getElementById('skip-count');
const endGameBtn = document.getElementById('end-game-btn');

let finishSpeechBtn = document.getElementById('finish-speech-btn');
let skipNightBtn = null;

const roleModal = document.getElementById('role-modal');
const modalPlayerRole = document.getElementById('modal-player-role');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

function switchToGameScreen() {
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'block';

    const roleCardBlock = document.getElementById('role-card-block');
    if (roleCardBlock) {
        roleCardBlock.style.display = 'none';
    }
}

function switchToLobbyScreen() {
    if (lobbyScreen) lobbyScreen.style.display = 'block';
    if (gameScreen) gameScreen.style.display = 'none';

    const roleCardBlock = document.getElementById('role-card-block');
    if (roleCardBlock) {
        roleCardBlock.style.display = 'block';
    }
}

socket.on('blacklistUpdated', (updatedBlacklist) => {
    myBlacklist = updatedBlacklist;
});

socket.on('connect', () => {
    if (roomId) {
        socket.emit('joinRoom', { roomId, username });
    }
    socket.emit('getBlacklist');
});

socket.on('signal', ({ from, signal }) => {
  AudioModule.handleSignal(from, signal, socket);
});

socket.on('room-joined', async () => {
  await AudioModule.startMicrophone();
});

socket.on('user-joined', ({ userId }) => {
  AudioModule.connectToPeer(userId, socket);
});

socket.on('user-left', ({ userId }) => {
  if (AudioModule.peerConnections[userId]) {
    AudioModule.peerConnections[userId].close();
    delete AudioModule.peerConnections[userId];
  }
  const audioEl = document.getElementById(`audio-${userId}`);
  if (audioEl) {
    audioEl.remove();
  }
});

socket.on('kicked', () => {
    window.location.href = '/';
});

if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener('click', () => {
        socket.emit('leaveRoom', { roomId });
        window.location.href = '/';
    });
}

socket.on('settingsUpdated', (settings) => {
    currentSettings = settings;
});

socket.on('playSpeakerSignal', () => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 587.33;
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.log('Аудио недоступно');
    }
});

socket.on('updatePlayers', (players) => {
    if (lobbyPlayersList) {
        lobbyPlayersList.innerHTML = '';
        const isHost = players.length > 0 && players[0].id === socket.id;

        players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'lobby-player-card';
            item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; marginBottom: 6px; padding: 8px; background: #282a45; border-radius: 6px; cursor: pointer; position: relative;';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.username || player.name;
            item.appendChild(nameSpan);

            const controlsDiv = document.createElement('div');
            const audioBtn = createAudioButton(player, socket.id);
            controlsDiv.appendChild(audioBtn);
            item.appendChild(controlsDiv);

            if (player.id !== socket.id) {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    showPlayerContextMenu(player, socket, roomId, isHost);
                });
            }

            lobbyPlayersList.appendChild(item);
        });

        if (startGameBtn) startGameBtn.style.display = isHost ? 'inline-block' : 'none';
        if (openSettingsBtn) openSettingsBtn.style.display = isHost ? 'inline-block' : 'none';
    }
});

function showPlayerContextMenu(player, socket, roomId, isHost) {
    let oldMenu = document.getElementById('player-context-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'player-context-menu';
    menu.style.cssText = 'position: fixed; background: #1a1c29; border: 1px solid #434978; border-radius: 8px; padding: 8px; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 6px; min-width: 200px;';
    
    menu.style.top = '50%';
    menu.style.left = '50%';
    menu.style.transform = 'translate(-50%, -50%)';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; margin-bottom: 4px; padding: 4px; border-bottom: 1px solid #434978; color: #fff; text-align: center;';
    title.textContent = player.username || player.name;
    menu.appendChild(title);

    if (isHost) {
        const kickBtn = document.createElement('button');
        kickBtn.textContent = '❌ Выгнать из комнаты';
        kickBtn.style.cssText = 'width: 100%; padding: 8px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        kickBtn.onclick = () => {
            socket.emit('kickPlayer', { roomId, targetId: player.id });
            menu.remove();
        };
        menu.appendChild(kickBtn);
    }

    const targetUserId = player.userId || player.id;
    const isBlocked = myBlacklist.some(id => String(id) === String(targetUserId));

    const blacklistBtn = document.createElement('button');
    blacklistBtn.textContent = isBlocked ? '✅ Из чёрного списка' : '🚫 В чёрный список';
    blacklistBtn.style.cssText = `width: 100%; padding: 8px 12px; background: ${isBlocked ? '#27ae60' : '#d35400'}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;`;

    blacklistBtn.onclick = () => {
        if (isBlocked) {
            socket.emit('removeFromBlacklist', { targetUserId });
        } else {
            if (confirm(`Заблокировать ${player.username || player.name}?`)) {
                socket.emit('addToBlacklist', { targetUserId, roomId });
            }
        }
        menu.remove();
    };
    menu.appendChild(blacklistBtn);

    const closeMenuBtn = document.createElement('button');
    closeMenuBtn.textContent = 'Закрыть';
    closeMenuBtn.style.cssText = 'width: 100%; padding: 6px; background: #434978; color: white; border: none; border-radius: 4px; cursor: pointer;';
    closeMenuBtn.onclick = () => menu.remove();
    menu.appendChild(closeMenuBtn);

    document.body.appendChild(menu);
}

socket.on('gameStarted', () => {
    sessionStorage.removeItem('game_closed_' + roomId);
    switchToGameScreen();
});

socket.on('updateCardCount', (count) => {
    const cardCountEl = document.getElementById('card-count');
    if (cardCountEl) {
        cardCountEl.textContent = count;
    }
});

socket.on('yourRole', (data) => {
    if (data && data.role) {
        myRole = data.role;
        showRoleModal(data.role);
    }
});

socket.on('actionResult', ({ target, result }) => {
    showActionResultModal(target, result);
});

socket.on('nightNews', (data) => {
    showNightNewsModal(data.message);
});

socket.on('errorMessage', (msg) => {
    alert(msg);
});

function updateMicrophoneState(gameState, myPlayer) {
    if (!myPlayer || myPlayer.isAlive === false || !gameState) {
        AudioModule.toggleMicrophone(false);
        return;
    }

    const myName = myPlayer.username || myPlayer.name;
    const isMyTurnToSpeak = (gameState.currentSpeaker === myName);
    const isMafia = (myPlayer.role === 'Мафия' || myPlayer.team === 'Мафия');

    let canSpeak = false;

    switch (gameState.phase) {
        case 1:
            canSpeak = true;
            break;

        case 2:
        case 2.5:
        case 4:
            canSpeak = isMyTurnToSpeak;
            break;

        case 5:
            canSpeak = isMafia;
            break;

        default:
            canSpeak = false;
            break;
    }

    AudioModule.toggleMicrophone(canSpeak);
}

socket.on('gameStateUpdate', (state) => {
    if (state.settings) {
        currentSettings = state.settings;
    }

    const isGameActive = state.phase && state.phase >= 1 && state.phase <= 5;

    if (state.phase === 6) {
        if (sessionStorage.getItem('game_closed_' + roomId) === 'true') {
            switchToLobbyScreen();
            return;
        } else {
            switchToGameScreen();
            showGameOverModal(state.winner, state.players);
            return;
        }
    }

    if (!isGameActive) {
        switchToLobbyScreen();
        return;
    }

    switchToGameScreen();

    if (state.currentSpeaker !== lastSpeaker || state.phase !== 2) {
        myNominatedCandidate = null;
        lastSpeaker = state.currentSpeaker;
    }

    if (dayCounter) dayCounter.textContent = `День ${state.day || 1}`;
    if (gamePhase) gamePhase.textContent = state.phaseText || state.phase;
    
    if (phaseTimer) {
        const minutes = Math.floor((state.timeLeft || 0) / 60);
        const seconds = (state.timeLeft || 0) % 60;
        phaseTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    const stateCompareCopy = {
        phase: state.phase,
        currentSpeaker: state.currentSpeaker,
        speakerNominations: state.speakerNominations,
        votes: state.votes,
        nightVotes: state.nightVotes,
        sheriffChecks: state.sheriffChecks,
        doctorTarget: state.doctorTarget,
        players: state.players ? state.players.map(p => ({ id: p.id, isAlive: p.isAlive, name: p.username || p.name })) : []
    };
	
    const currentStateJSON = JSON.stringify(stateCompareCopy);

    if (currentStateJSON !== lastStateJSON) {
        lastStateJSON = currentStateJSON;
        renderGridContent(state);
    }

    const me = state.players?.find(p => (p.username === username || p.name === username || p.id === socket.id));

    if (skipPhaseBtn) {
        skipPhaseBtn.style.display = state.phase === 1 ? 'inline-block' : 'none';
        if (skipCountSpan) {
            skipCountSpan.textContent = `(${state.skipVotes || 0}/${state.requiredVotes || 0})`;
        }

        const myName = me ? (me.username || me.name) : username;

        if (state.votedPlayers && (state.votedPlayers.includes(myName) || state.votedPlayers.includes(username))) {
            skipPhaseBtn.disabled = true;
        } else {
            skipPhaseBtn.disabled = false;
        }
    }

    if (state.gameLog) {
        renderGameLog(state.gameLog);
    }

    updateMicrophoneState(state, me);
});

function renderGridContent(state) {
    let gameControls = document.getElementById('game-controls');
    if (gameControls) {
        if (!finishSpeechBtn) {
            finishSpeechBtn = document.createElement('button');
            finishSpeechBtn.id = 'finish-speech-btn';
            finishSpeechBtn.textContent = 'Закончить речь';
            finishSpeechBtn.style.display = 'none';
            finishSpeechBtn.addEventListener('click', () => {
                socket.emit('finishSpeech', { roomId });
            });
            gameControls.appendChild(finishSpeechBtn);
        }

        if (!skipNightBtn) {
            skipNightBtn = document.createElement('button');
            skipNightBtn.id = 'skip-night-btn';
            skipNightBtn.textContent = 'Пропустить ночь';
            skipNightBtn.style.display = 'none';
            skipNightBtn.addEventListener('click', () => {
                socket.emit('skipNightPhase', { roomId });
            });
            gameControls.appendChild(skipNightBtn);
        }
    }

    if (playersGrid && state.players) {
        playersGrid.innerHTML = '';

        const me = state.players.find(p => (p.username === username || p.name === username || p.id === socket.id));
        const myName = me ? (me.username || me.name) : username;
        const isMyTurn = state.currentSpeaker === myName || state.currentSpeaker === username;

        if (state.phase === 2 || state.phase === 2.5 || state.phase === 4) {
            if (skipNightBtn) skipNightBtn.style.display = 'none';
            playersGrid.className = 'single-speaker-mode';

            const speakerName = state.currentSpeaker;
            const speaker = state.players.find(p => (p.username === speakerName || p.name === speakerName));
    
            if (speaker) {
                const card = document.createElement('div');
                card.className = 'player-card speaker-card';

                card.innerHTML = `
                    <div class="player-name">${speaker.username || speaker.name}</div>
                    <div class="speaker-label">${state.phase === 4 ? 'Последнее слово...' : 'Говорит...'}</div>
                `;
                playersGrid.appendChild(card);

                const currentNomination = state.speakerNominations ? state.speakerNominations[speakerName] : null;

                if (currentNomination) {
                    const nominationBadge = document.createElement('div');
                    nominationBadge.className = 'current-nomination-badge';
                    nominationBadge.style.cssText = `
                        margin-top: 10px;
                        padding: 6px 12px;
                        background: rgba(231, 76, 60, 0.9);
                        border-radius: 6px;
                        color: white;
                        font-weight: bold;
                        font-size: 0.95rem;
                        border: 1px solid #c0392b;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        text-align: center;
                    `;
                    nominationBadge.textContent = `Выставляет: ${currentNomination}`;
                    playersGrid.appendChild(nominationBadge);
                }
            }

            const isFirstDay = state.day === 1;
            const allowFirstDayVoting = currentSettings?.rules?.firstDayVoting ?? state.allowFirstDayVoting ?? false;
            const canNominate = !isFirstDay || allowFirstDayVoting;

            if (state.phase === 2 && isMyTurn && canNominate) {
                const nominateBox = document.createElement('div');
                nominateBox.className = 'nominate-box';
                nominateBox.innerHTML = '<h4>Выставить кандидатуру (макс. 1):</h4>';
                
                const aliveOtherPlayers = state.players.filter(p => p.isAlive !== false && (p.username || p.name) !== myName);
                
                const renderNominateButtons = () => {
                    const oldBtns = nominateBox.querySelectorAll('.nominate-btn');
                    oldBtns.forEach(b => b.remove());

                    aliveOtherPlayers.forEach(p => {
                        const pName = p.username || p.name;
                        const isMyChoice = myNominatedCandidate === pName;
                        const btn = document.createElement('button');
                        btn.className = `nominate-btn ${isMyChoice ? 'active' : ''}`;
                        btn.textContent = pName + (isMyChoice ? ' (Выставлен вами)' : '');
                        btn.onclick = () => {
                            myNominatedCandidate = pName;
                            socket.emit('nominateCandidate', { roomId, candidateName: pName });
                            renderNominateButtons();
                        };
                        nominateBox.appendChild(btn);
                    });
                };

                renderNominateButtons();
                playersGrid.appendChild(nominateBox);
            }

            if (finishSpeechBtn) {
                finishSpeechBtn.style.display = isMyTurn ? 'inline-block' : 'none';
            }
        } 
        else if (state.phase === 3) {
            if (finishSpeechBtn) finishSpeechBtn.style.display = 'none';
            if (skipNightBtn) skipNightBtn.style.display = 'none';
            playersGrid.className = 'voting-mode';

            const myVote = state.votes ? (state.votes[myName] || state.votes[username]) : null;

            const totalVoted = Object.keys(state.votes || {}).length;
            const totalVoters = state.players.filter(p => p.isAlive !== false).length;

            const votesCounterBox = document.createElement('div');
            votesCounterBox.className = 'total-votes-box';
            votesCounterBox.style.cssText = 'width: 100%; text-align: center; margin-bottom: 15px; font-weight: bold; font-size: 1.1rem; color: #fff;';
            votesCounterBox.textContent = `Проголосовало: ${totalVoted} из ${totalVoters}`;
            playersGrid.appendChild(votesCounterBox);

            (state.votingCandidates || []).forEach(candName => {
                const candCard = document.createElement('div');
                candCard.className = `voting-card ${myVote === candName ? 'selected' : ''}`;
                candCard.innerHTML = `
                    <div class="cand-name">${candName}</div>
                `;

                if (me && me.isAlive !== false) {
                    candCard.onclick = () => {
                        socket.emit('castVote', { roomId, candidateName: candName });
                    };
                }

                playersGrid.appendChild(candCard);
            });
        } 
        else if (state.phase === 5) {
            if (finishSpeechBtn) finishSpeechBtn.style.display = 'none';
            
            const isAlive = me && me.isAlive !== false;
            const isActiveRole = isAlive && myRole !== 'Мирный житель';

            if (skipNightBtn) {
                skipNightBtn.style.display = isActiveRole ? 'inline-block' : 'none';
                if (state.nightSkipVotes && (state.nightSkipVotes.includes(myName) || state.nightSkipVotes.includes(username))) {
                    skipNightBtn.disabled = true;
                    skipNightBtn.textContent = 'Ожидание остальных...';
                } else {
                    skipNightBtn.disabled = false;
                    skipNightBtn.textContent = 'Пропустить ночь';
                }
            }

            if (!isActiveRole) {
                playersGrid.className = 'night-mode-civilian';
                playersGrid.innerHTML = `
                    <div class="night-banner">
                        <div class="moon-icon">🌙</div>
                        <h3>Город засыпает...</h3>
                        <p>Мирные жители спят. Ожидайте завершения действий активных ролей.</p>
                    </div>
                `;
            } else {
                playersGrid.className = 'voting-mode';
                
                let hintText = '';
                if (myRole.includes('Шериф')) hintText = 'Чей багажник проверить?';
                else if (myRole.includes('Мафия') || myRole.includes('Дон')) hintText = 'Кого угостить несвежим пончиком?';
                else if (myRole.includes('Доктор')) hintText = 'Кого отправить на клизму?';

                if (hintText) {
                    const hintBox = document.createElement('div');
                    hintBox.style.cssText = 'width: 100%; text-align: center; margin-bottom: 12px; font-weight: bold; color: #f1c40f; font-size: 1.05rem;';
                    hintBox.textContent = hintText;
                    playersGrid.appendChild(hintBox);
                }

                let selectablePlayers = state.players.filter(player => player.isAlive !== false);
                if (myRole.includes('Шериф')) {
                    selectablePlayers = selectablePlayers.filter(player => (player.username || player.name) !== myName);
                }

                selectablePlayers.forEach(player => {
                    const pName = player.username || player.name;
                    const card = document.createElement('div');

                    let isTargeted = false;
                    if (myRole.includes('Шериф') && state.sheriffChecks && (state.sheriffChecks[myName]?.target === pName || state.sheriffChecks[username]?.target === pName)) {
                        isTargeted = true;
                    } else if ((myRole.includes('Мафия') || myRole.includes('Дон')) && state.nightVotes && (state.nightVotes[myName] === pName || state.nightVotes[username] === pName)) {
                        isTargeted = true;
                    } else if (myRole.includes('Доктор') && (state.doctorTarget === pName || (state.doctorHeals && (state.doctorHeals[myName] === pName || state.doctorHeals[username] === pName)))) {
                        isTargeted = true;
                    }

                    card.className = `voting-card ${isTargeted ? 'selected' : ''}`;
                    
                    const statusText = isTargeted ? 'Цель выбрана ✓' : 'Нажмите для выбора';

                    card.innerHTML = `
                        <div class="cand-name">${pName}</div>
                        <div class="vote-count">${statusText}</div>
                    `;

                    card.onclick = () => {
                       socket.emit('nightAction', { roomId, targetName: pName });
                    };

                    playersGrid.appendChild(card);
                });
            }
        }
        else {
            playersGrid.className = 'grid-mode';
            if (finishSpeechBtn) finishSpeechBtn.style.display = 'none';
            if (skipNightBtn) skipNightBtn.style.display = 'none';

            state.players.forEach(player => {
                const card = document.createElement('div');
                card.className = `player-card ${player.id === null ? 'offline' : ''} ${!player.isAlive ? 'dead' : ''}`;
                
                card.innerHTML = `
                    <div class="player-name">${player.username || player.name}</div>
                    <div class="player-status">${player.id === null ? 'Офлайн' : (player.isAlive ? 'В игре' : 'Исключён')}</div>
                `;

                if (player.id) {
                    const audioBtn = createAudioButton(player, socket.id);
                    card.appendChild(audioBtn);
                }
                playersGrid.appendChild(card);
            });
        }

        if (endGameBtn) {
            const isHost = state.players.length > 0 && state.players[0].id === socket.id;
            endGameBtn.style.display = isHost ? 'inline-block' : 'none';
        }
    }
}

function renderGameLog(logs) {
    const logContainer = document.getElementById('game-log');
    if (!logContainer) return;

    logContainer.innerHTML = '';
    logs.forEach(log => {
        const item = document.createElement('div');
        item.className = `log-item log-${log.type}`;
        item.textContent = `[День ${log.day}] ${log.text}`;
        logContainer.appendChild(item);
    });

    logContainer.scrollTop = logContainer.scrollHeight;
}

function showGameOverModal(winner, players) {
    if (sessionStorage.getItem('game_closed_' + roomId) === 'true') {
        switchToLobbyScreen();
        return;
    }

    let gameOverModal = document.getElementById('game-over-modal');
    if (!gameOverModal) {
        gameOverModal = document.createElement('div');
        gameOverModal.id = 'game-over-modal';
        gameOverModal.className = 'modal';
        gameOverModal.style.zIndex = '9999';
        
        gameOverModal.innerHTML = `
            <div class="modal-content" style="max-width: 450px; padding: 20px; text-align: center;">
                <h2 id="game-over-title" style="margin-bottom: 10px; font-size: 1.6rem; color: #f1c40f;">🏆 Игра окончена!</h2>
                <div id="game-over-winner" style="font-size: 1.2rem; font-weight: bold; margin-bottom: 15px; color: #fff;"></div>
                <div style="text-align: left; background: #282a45; padding: 12px; border-radius: 10px; border: 1px solid #434978; margin-bottom: 15px; max-height: 250px; overflow-y: auto;">
                    <h4 style="margin-top: 0; margin-bottom: 10px; color: #cbd5e0; border-bottom: 1px solid #434978; padding-bottom: 5px;">Раскрытие ролей:</h4>
                    <div id="game-over-roles-list"></div>
                </div>
                <button id="game-over-confirm-btn" style="width: 100%; padding: 10px; font-size: 1rem; font-weight: bold; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">Вернуться в лобби</button>
            </div>
        `;
        document.body.appendChild(gameOverModal);

        document.getElementById('game-over-confirm-btn').onclick = () => {
            sessionStorage.setItem('game_closed_' + roomId, 'true');
            gameOverModal.style.display = 'none';
            switchToLobbyScreen();
        };
    }

    const winnerTextElem = document.getElementById('game-over-winner');
    const isMafiaWin = winner === 'Мафия';
    const winnerColor = isMafiaWin ? '#e74c3c' : '#2ecc71';
    winnerTextElem.innerHTML = `Победила команда: <span style="color: ${winnerColor}">${winner || 'Завершено'}</span> 🎉`;

    const rolesListElem = document.getElementById('game-over-roles-list');
    rolesListElem.innerHTML = '';

    if (players && players.length > 0) {
        players.forEach(p => {
            const pName = p.username || p.name;
            const pRole = p.role || 'Мирный житель';
            const isAliveText = p.isAlive ? '🟢 Жив' : '😡 Исключён';
            
            let roleIcon = '🍩';
            if (pRole.includes('Мафия')) roleIcon = '🕶️';
            else if (pRole.includes('Шериф')) roleIcon = '⭐';
            else if (pRole.includes('Доктор')) roleIcon = '🩺';

            const item = document.createElement('div');
            item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #32375a; font-size: 0.95rem;';
            item.innerHTML = `
                <span><b>${pName}</b></span>
                <span>${roleIcon} ${pRole} <small style="opacity: 0.7; margin-left: 5px;">(${isAliveText})</small></span>
            `;
            rolesListElem.appendChild(item);
        });
    }

    gameOverModal.style.display = 'flex';
}

function showActionResultModal(target, result) {
    let actionModal = document.getElementById('action-result-modal');
    if (!actionModal) {
        actionModal = document.createElement('div');
        actionModal.id = 'action-result-modal';
        actionModal.className = 'modal';
        actionModal.innerHTML = `
            <div class="modal-content">
                <h3>🔍 Досье проверки</h3>
                <div id="action-result-text" style="margin: 15px 0;"></div>
                <button id="action-result-confirm-btn" style="width: 100%;">Принято</button>
            </div>
        `;
        document.body.appendChild(actionModal);

        document.getElementById('action-result-confirm-btn').onclick = () => {
            actionModal.style.display = 'none';
        };
    }

    const isMafia = result.includes('пончиков');
    const resultColor = isMafia ? '#ff6b6b' : '#1dd1a1';
    
    const resultTextElem = document.getElementById('action-result-text');
    resultTextElem.innerHTML = `
        <div style="background: #282a45; padding: 12px; border-radius: 10px; border: 1px solid #434978;">
            <p style="color: #cbd5e0; font-size: 0.85rem; margin-bottom: 6px;">Объект проверки: <b>${target}</b></p>
            <p style="color: ${resultColor}; font-size: 1rem; font-weight: 600; line-height: 1.4;">${result}</p>
        </div>
    `;
    actionModal.style.display = 'flex';
}

function showNightNewsModal(messageText) {
    let newsModal = document.getElementById('night-news-modal');
    if (!newsModal) {
        newsModal = document.createElement('div');
        newsModal.id = 'night-news-modal';
        newsModal.className = 'modal';
        newsModal.innerHTML = `
            <div class="modal-content">
                <h3>Итоги ночи 😴</h3>
                <div id="night-news-text"></div>
                <button id="night-news-confirm-btn" style="width: 100%; margin-top: 15px;">Понятно</button>
            </div>
        `;
        document.body.appendChild(newsModal);

        document.getElementById('night-news-confirm-btn').onclick = () => {
            newsModal.style.display = 'none';
        };
    }

    document.getElementById('night-news-text').innerHTML = messageText;
    newsModal.style.display = 'flex';
}

function showRoleModal(role) {
    if (roleModal && modalPlayerRole) {
        let roleClass = 'civilian';
        let roleIcon = '🍩🥸';
        let roleDesc = 'Просто пришёл поесть бесплатные пончики.';

        if (role.includes('Мафия') || role.includes('Дон')) {
            roleClass = 'mafia';
            roleIcon = '🕶️🔫';
            roleDesc = 'Заказывает пиццу и убирает свидетелей.';
        } else if (role.includes('Шериф')) {
            roleClass = 'sheriff';
            roleIcon = '⭐🕵️';
            roleDesc = 'Ищет улики и потерянные очки.';
        } else if (role.includes('Доктор')) {
            roleClass = 'doctor';
            roleIcon = '🩺💉';
            roleDesc = 'Лечит подозрительные синяки и укусы.';
        } else if (role.includes('Живчик') || role.includes('zhivchik')) {
            roleClass = 'zhivchik';
            roleIcon = '🏃‍♂️🛡️';
            roleDesc = 'Живчик выдерживает два выстрела перед тем, как выбыть.';
        }

        modalPlayerRole.innerHTML = `
            <div class="role-card-item ${roleClass}" style="margin: 15px auto; max-width: 240px;">
                <div class="role-icon">${roleIcon}</div>
                <div class="role-name">${role}</div>
                <div class="role-desc">${roleDesc}</div>
            </div>
        `;
        roleModal.style.display = 'flex';
    }
}

if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
        if (currentSettings) {
            document.getElementById('setting-generalMeeting').value = currentSettings.timers.generalMeeting;
            document.getElementById('setting-individualSpeech').value = currentSettings.timers.individualSpeech;

            document.getElementById('setting-maxPlayers').value = currentSettings.rules.maxPlayers;
            document.getElementById('setting-firstDayVoting').checked = currentSettings.rules.firstDayVoting;
            document.getElementById('setting-secretVoting').checked = currentSettings.rules.secretVoting;

            document.getElementById('setting-extraMafia').value = currentSettings.roles.extraMafia || 0;
            document.getElementById('setting-don').checked = !!currentSettings.roles.don;
            document.getElementById('setting-sheriff').checked = !!currentSettings.roles.sheriff;
            document.getElementById('setting-doctor').checked = !!currentSettings.roles.doctor;
            document.getElementById('setting-zhivchik').checked = !!currentSettings.roles.zhivchik;
        }
        settingsModal.style.display = 'flex';
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
}

if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newSettings = {
            timers: {
                generalMeeting: parseInt(document.getElementById('setting-generalMeeting').value) || 0,
                individualSpeech: parseInt(document.getElementById('setting-individualSpeech').value) || 60
            },
            rules: {
                maxPlayers: parseInt(document.getElementById('setting-maxPlayers').value) || 10,
                firstDayVoting: document.getElementById('setting-firstDayVoting').checked,
                secretVoting: document.getElementById('setting-secretVoting').checked
            },
            roles: {
                extraMafia: parseInt(document.getElementById('setting-extraMafia').value) || 0,
                don: document.getElementById('setting-don').checked ? 1 : 0,
                sheriff: document.getElementById('setting-sheriff').checked ? 1 : 0,
                doctor: document.getElementById('setting-doctor').checked ? 1 : 0,
                zhivchik: document.getElementById('setting-zhivchik').checked ? 1 : 0
            }
        };

        socket.emit('updateSettings', { roomId, newSettings });
        settingsModal.style.display = 'none';
    });
}

socket.on('gameEnded', (data) => {
    if (data && data.winner) {
        showGameOverModal(data.winner, data.players);
    } else {
        switchToLobbyScreen();
    }
});

if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', () => {
        roleModal.style.display = 'none';
    });
}

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        socket.emit('startGame', { roomId });
    });
}

if (skipPhaseBtn) {
    skipPhaseBtn.addEventListener('click', () => {
        socket.emit('voteSkipPhase', { roomId });
    });
}

if (endGameBtn) {
    endGameBtn.addEventListener('click', () => {
        socket.emit('endGame', { roomId });
    });
}

function initJournalUI() {
    const openLogBtn = document.createElement('button');
    openLogBtn.id = 'open-log-btn';
    openLogBtn.textContent = '📜 Журнал';
    
    const gameControls = document.getElementById('game-controls');
    if (gameControls) {
        gameControls.appendChild(openLogBtn);
    } else {
        document.body.appendChild(openLogBtn);
    }

    const logModal = document.createElement('div');
    logModal.id = 'log-modal';
    logModal.innerHTML = `
        <div class="log-modal-content">
            <h3>📜 Журнал действий</h3>
            <div id="game-log">Пусто</div>
            <button class="log-close-btn">Закрыть</button>
        </div>
    `;
    document.body.appendChild(logModal);

    openLogBtn.onclick = () => { logModal.style.display = 'flex'; };
    logModal.querySelector('.log-close-btn').onclick = () => { logModal.style.display = 'none'; };
}

initJournalUI();

window.openRoleMenu = function() {
    const modal = document.getElementById('role-select-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeRoleMenu = function() {
    const modal = document.getElementById('role-select-modal');
    if (modal) modal.style.display = 'none';
};

window.selectDesiredRole = function(role) {
    socket.emit('selectRoleCard', { role: role });
    window.closeRoleMenu();
};