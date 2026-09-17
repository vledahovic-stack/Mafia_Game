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

// Флаг: сделал ли Дон проверку в текущую ночь (обновляется через actionResult и сбрасывается при старте ночи)
let donAlreadyChecked = false;

function createAudioButton(player, socketId) {
    const isMe = (player.id === socketId);
    const btn = document.createElement('button');
    btn.className = 'card-audio-btn';

    const updateBtnText = (muted) => {
        if (isMe) {
            btn.textContent = isMicOn ? '🎙️' : '🔇';
        } else {
            btn.textContent = muted ? '🔇' : '🔊';
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
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsForm = document.getElementById('settings-form');
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

document.querySelectorAll('#leave-room-btn, #game-leave-room-btn, .leave-room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        socket.emit('leaveRoom', { roomId });
        window.location.href = '/';
    });
});

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

function updateLobbyTableSlots(players) {
    const grid = document.querySelector('.lobby-empty-table-grid');
    if (!grid) return;

    const slots = grid.querySelectorAll('.table-slot-card');
    if (!slots || slots.length === 0) return;

    const isHost = players.length > 0 && players[0].id === socket.id;

    slots.forEach((slot, index) => {
        const player = players[index];
        const slotNum = index + 1;

        const newSlot = slot.cloneNode(false);
        slot.parentNode.replaceChild(newSlot, slot);

        if (player) {
            const pName = player.username || player.name || `Игрок ${slotNum}`;
            const isMe = (player.id === socket.id);

            newSlot.classList.add('occupied');
            newSlot.style.borderColor = isMe ? 'rgba(29, 209, 161, 0.5)' : 'rgba(255, 209, 102, 0.4)';
            newSlot.style.borderStyle = 'solid';
            newSlot.style.background = isMe ? 'rgba(29, 209, 161, 0.08)' : 'rgba(255, 255, 255, 0.05)';
            
            newSlot.innerHTML = `
                <div class="slot-num" style="color: ${isMe ? 'var(--clr-teal)' : 'var(--clr-gold)'}; opacity: 1; font-size: 0.95rem; font-weight: 800;">#${slotNum}</div>
                <div style="font-size: 1.3rem; line-height: 1.2; margin: 2px 0;">👤</div>
                <div class="slot-status" style="color: #fff; font-weight: 700; opacity: 1; font-size: 0.85rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${pName}">${pName}</div>
            `;

            if (!isMe) {
                newSlot.style.cursor = 'pointer';
                newSlot.addEventListener('click', () => {
                    showPlayerContextMenu(player, socket, roomId, isHost, newSlot);
                });
                newSlot.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showPlayerContextMenu(player, socket, roomId, isHost, newSlot);
                });
            }
        } else {
            newSlot.classList.remove('occupied');
            newSlot.style.borderColor = '';
            newSlot.style.borderStyle = '';
            newSlot.style.background = '';
            newSlot.style.cursor = 'default';

            newSlot.innerHTML = `
                <div class="slot-num">${slotNum}</div>
                <div class="slot-status">Свободно</div>
            `;
        }
    });
}

socket.on('updatePlayers', (players) => {
    if (lobbyPlayersList) {
        lobbyPlayersList.innerHTML = '';
        const isHost = players.length > 0 && players[0].id === socket.id;

        players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'lobby-player-card';
            item.dataset.playerId = player.userId || player.id;
            item.dataset.socketId = player.id;
            
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
                    showPlayerContextMenu(player, socket, roomId, isHost, item);
                });
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (e.target.closest('button')) return;
                    showPlayerContextMenu(player, socket, roomId, isHost, item);
                });
            }

            lobbyPlayersList.appendChild(item);
        });

        if (startGameBtn) startGameBtn.style.display = isHost ? 'inline-block' : 'none';
        if (openSettingsBtn) openSettingsBtn.style.display = isHost ? 'inline-block' : 'none';
    }

    // Синхронизация 12 слотов стола в лобби
    updateLobbyTableSlots(players);
});

function showPlayerContextMenu(player, socket, roomId, isHost, targetElement = null) {
    let oldMenu = document.getElementById('player-context-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'player-context-menu';
    menu.className = 'ctx-menu';

    const title = document.createElement('div');
    title.className = 'ctx-menu-title';
    title.textContent = player.username || player.name;
    menu.appendChild(title);

    if (isHost) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'ctx-menu-kick';
        kickBtn.textContent = '❌ Выгнать из комнаты';
        kickBtn.onclick = () => {
            socket.emit('kickPlayer', { roomId, targetId: player.id });
            menu.remove();
        };
        menu.appendChild(kickBtn);
    }

    const targetUserId = player.userId || player.id;
    const isBlocked = myBlacklist.some(id => String(id) === String(targetUserId));

    const blacklistBtn = document.createElement('button');
    blacklistBtn.className = 'ctx-menu-block';
    blacklistBtn.style.background = isBlocked ? 'var(--clr-teal)' : '#e67e22';
    blacklistBtn.textContent = isBlocked ? '✅ Из чёрного списка' : '🚫 В чёрный список';

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
    closeMenuBtn.className = 'ctx-menu-close';
    closeMenuBtn.textContent = 'Закрыть';
    closeMenuBtn.onclick = () => menu.remove();
    menu.appendChild(closeMenuBtn);

    document.body.appendChild(menu);

    if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        const menuWidth = 220;
        const menuHeight = menu.offsetHeight || 160;

        let left = rect.right + 12;
        let top = rect.top;

        // Если не помещается справа от карточки
        if (left + menuWidth > window.innerWidth - 10) {
            if (rect.left + menuWidth <= window.innerWidth - 10) {
                left = rect.left;
                top = rect.bottom + 6;
            } else {
                left = Math.max(10, window.innerWidth - menuWidth - 10);
            }
        }

        // Если выходит за нижний край окна
        if (top + menuHeight > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - menuHeight - 10);
        }

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.transform = 'none';
    }

    const handleOutsideClick = (e) => {
        if (!menu.contains(e.target) && (!targetElement || !targetElement.contains(e.target))) {
            menu.remove();
            document.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('contextmenu', handleOutsideClick);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
        document.addEventListener('contextmenu', handleOutsideClick);
    }, 50);
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
        updateSidebarRoleInfo(data.role);
    }
});

socket.on('actionResult', ({ target, result }) => {
    // Устанавливаем флаг: Дон совершил проверку, теперь ждёт этап 2
    donAlreadyChecked = true;

    // Показываем результат проверки (не показываем для подтверждения выстрела)
    if (result && !result.toLowerCase().includes('выстрел')) {
        showActionResultModal(target, result);
    }

    // Гарантируем, что nightModal остаётся видимым и активным для второго действия
    const nightModal = document.getElementById('nightModal');
    if (nightModal) {
        nightModal.style.display = 'block';
    }
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
        case 0.5:
            // Договорка: говорят только члены чёрной команды
            canSpeak = isMafia;
            break;

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

function updateCentralPhaseBanner(state) {
    const phaseBanner = document.getElementById('game-phase-banner');
    if (!phaseBanner || !state) return;

    const dayText = `День ${state.day || 1}`;
    const phaseText = state.phaseText || String(state.phase);
    const minutes = Math.floor((state.timeLeft || 0) / 60);
    const seconds = (state.timeLeft || 0) % 60;
    const timerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    let phaseIcon = '🌤️';
    let phaseBg = 'rgba(255,209,102,0.08)';
    let phaseBorder = 'rgba(255,209,102,0.3)';
    let phaseColor = 'var(--clr-gold)';

    if (state.phase === 5 || state.phase === 0.5) {
        phaseIcon = '🌙';
        phaseBg = 'rgba(84,160,255,0.08)';
        phaseBorder = 'rgba(84,160,255,0.3)';
        phaseColor = 'var(--clr-blue)';
    } else if (state.phase === 3) {
        phaseIcon = '⚖️';
        phaseBg = 'rgba(255,83,112,0.08)';
        phaseBorder = 'rgba(255,83,112,0.3)';
        phaseColor = 'var(--clr-red)';
    } else if (state.phase === 2 || state.phase === 2.5) {
        phaseIcon = '🗣️';
        phaseBg = 'rgba(29,209,161,0.08)';
        phaseBorder = 'rgba(29,209,161,0.3)';
        phaseColor = 'var(--clr-teal)';
    } else if (state.phase === 4) {
        phaseIcon = '💬';
        phaseBg = 'rgba(255,159,67,0.08)';
        phaseBorder = 'rgba(255,159,67,0.3)';
        phaseColor = 'var(--clr-orange)';
    }

    phaseBanner.style.display = 'flex';
    phaseBanner.style.background = phaseBg;
    phaseBanner.style.borderColor = phaseBorder;

    phaseBanner.innerHTML = `
        <div class="phase-banner-content">
            <div class="phase-banner-day" style="color:${phaseColor};">
                <span class="phase-banner-icon">${phaseIcon}</span>
                <strong>${dayText}</strong>
            </div>
            <span class="phase-banner-sep">•</span>
            <div class="phase-banner-title">${phaseText}</div>
            <span class="phase-banner-sep">•</span>
            <div class="phase-banner-timer">⏱ ${timerText}</div>
        </div>
    `;
}

socket.on('gameStateUpdate', (state) => {
    if (state.settings) {
        currentSettings = state.settings;
    }

    const isGameActive = state.phase && (state.phase === 0.5 || (state.phase >= 1 && state.phase <= 5));

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

    // ─── Обновляем центральный динамический баннер и таймер на каждом тике сокета ───
    updateCentralPhaseBanner(state);

    if (state.phase === 5) {
        const myName = username;
        const checks = state.donChecks;
        const hasDonCheck = checks && (checks[myName] || Object.keys(checks).length > 0);
        if (!hasDonCheck) {
            donAlreadyChecked = false;
        }
    }

    if (state.currentSpeaker !== lastSpeaker || state.phase !== 2) {
        myNominatedCandidate = null;
        lastSpeaker = state.currentSpeaker;
    }

    const stateCompareCopy = {
        phase: state.phase,
        currentSpeaker: state.currentSpeaker,
        speakerNominations: state.speakerNominations,
        votes: state.votes,
        nightVotes: state.nightVotes,
        maniacTarget: state.maniacTarget,
        sheriffChecks: state.sheriffChecks,
        doctorTarget: state.doctorTarget,
        donChecks: state.donChecks,
        players: state.players ? state.players.map(p => ({ id: p.id, isAlive: p.isAlive, name: p.username || p.name })) : []
    };

    const currentStateJSON = JSON.stringify(stateCompareCopy);

    if (currentStateJSON !== lastStateJSON) {
        lastStateJSON = currentStateJSON;
        renderGridContent(state);
    }

    const me = state.players?.find(p => (p.username === username || p.name === username || p.id === socket.id));
    const isHost = !!state.players && state.players.length > 0 && state.players[0].id === socket.id;

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

    const endGameBurgerItem = document.querySelector('.burger-end-game-item');
    const isBurgerGameActive = !!gameScreen && gameScreen.style.display !== 'none' && !!state && typeof state.phase === 'number' && state.phase > 0 && !!me;
    if (endGameBurgerItem) {
        endGameBurgerItem.style.display = (window.innerWidth <= 768 && isBurgerGameActive && isHost) ? 'flex' : 'none';
    }

    if (state.gameLog) {
        renderGameLog(state.gameLog);
    }

    if (state.players) {
        updateSidebarPlayers(state.players, state);
        if (me && me.role) {
            updateSidebarRoleInfo(me.role);
        } else if (myRole) {
            updateSidebarRoleInfo(myRole);
        }
    }

    updateMicrophoneState(state, me);
});

function renderGridContent(state) {
    let gameControls = document.getElementById('game-controls');
    if (gameControls) {
        if (!finishSpeechBtn) {
            finishSpeechBtn = document.createElement('button');
            finishSpeechBtn.id = 'finish-speech-btn';
            finishSpeechBtn.textContent = window.innerWidth <= 768 ? 'Пропустить речь' : 'Закончить речь';
            finishSpeechBtn.style.display = 'none';
            finishSpeechBtn.addEventListener('click', () => {
                socket.emit('finishSpeech', { roomId });
            });
            gameControls.appendChild(finishSpeechBtn);
        } else {
            finishSpeechBtn.textContent = window.innerWidth <= 768 ? 'Пропустить речь' : 'Закончить речь';
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
        const me = state.players.find(p => (p.username === username || p.name === username || p.id === socket.id));
        const myName = me ? (me.username || me.name) : username;
        const isMyTurn = state.currentSpeaker === myName || state.currentSpeaker === username;
        const isHost = state.players.length > 0 && state.players[0].id === socket.id;

        const isSpeechPhase = (state.phase === 2 || state.phase === 2.5 || state.phase === 4);
        const isVotingPhase = (state.phase === 3);
        const isNightPhase = (state.phase === 5);
        const actionPanel = document.getElementById('game-action-panel');
        const centerPanel = document.querySelector('.game-panel-center');

        if (centerPanel) centerPanel.classList.toggle('speech-phase-active', isSpeechPhase);
        if (actionPanel) actionPanel.classList.toggle('speech-phase-active', isSpeechPhase);

        // ─── Полная очистка состояния обоих экранов перед рендером новой фазы ───
        playersGrid.innerHTML = '';
        playersGrid.classList.add('hidden');
        playersGrid.style.display = 'none';

        if (actionPanel) {
            actionPanel.innerHTML = '';
            actionPanel.classList.add('hidden');
            actionPanel.style.display = 'none';
        }
        if (finishSpeechBtn) finishSpeechBtn.style.display = 'none';
        if (skipNightBtn) skipNightBtn.style.display = 'none';

        if (isSpeechPhase) {
            // ─── ФАЗА 2: ИНДИВИДУАЛЬНАЯ РЕЧЬ (Сетка 4x3 полностью скрыта, отображается ТОЛЬКО карточка спикера и кандидаты) ───
            playersGrid.classList.add('hidden');
            playersGrid.style.display = 'none';

            const speakerName = state.currentSpeaker;
            const speakerIndex = state.players.findIndex(p => (p.username === speakerName || p.name === speakerName)) + 1 || 1;
            const speakerPlayer = state.players.find(p => (p.username === speakerName || p.name === speakerName));
            const isSpeakerMe = (speakerName === myName || speakerName === username);

            if (actionPanel && speakerName) {
                actionPanel.classList.remove('hidden');
                actionPanel.style.display = 'flex';

                // Увеличенная карточка текущего спикера в нормальном потоке: строка сверху, квадратная карточка ниже
                const speakerHeader = document.createElement('div');
                speakerHeader.className = 'speaker-player-header-row';
                speakerHeader.innerHTML = `
                    <span class="speaker-player-number">#${speakerIndex}</span>
                    <span class="speaker-player-name">${speakerName}${isSpeakerMe ? ' (Вы)' : ''}</span>
                `;
                actionPanel.appendChild(speakerHeader);

                const speakerCard = document.createElement('div');
                speakerCard.className = 'speaker-card-prominent';
                speakerCard.innerHTML = '<div class="speaker-player-avatar" aria-label="Карточка спикера"></div>';
                actionPanel.appendChild(speakerCard);

                const speakerStatus = document.createElement('div');
                speakerStatus.className = 'speaker-status-tag';
                speakerStatus.textContent = state.phase === 4 ? 'Последнее слово...' : 'Индивидуальная речь...';
                actionPanel.appendChild(speakerStatus);

                // Информационный блок с вынесенным кандидатом
                const currentNomination = state.speakerNominations ? state.speakerNominations[speakerName] : null;
                if (currentNomination) {
                    const nominationBadge = document.createElement('div');
                    nominationBadge.className = 'nomination-status-badge';
                    nominationBadge.innerHTML = `⚖️ Выставлен на голосование: <strong>${currentNomination}</strong>`;
                    actionPanel.appendChild(nominationBadge);
                } else if (!isMyTurn) {
                    const nominationBadge = document.createElement('div');
                    nominationBadge.className = 'nomination-status-badge empty';
                    nominationBadge.textContent = 'Кандидатура пока не выставлена';
                    actionPanel.appendChild(nominationBadge);
                }

                // Для текущего спикера: выбор кандидатов
                const isFirstDay = state.day === 1;
                const allowFirstDayVoting = currentSettings?.rules?.firstDayVoting ?? state.allowFirstDayVoting ?? false;
                const canNominate = !isFirstDay || allowFirstDayVoting;

                if (state.phase === 2 && isMyTurn && canNominate) {
                    const aliveOtherPlayers = state.players.filter(p => p.isAlive !== false && (p.username || p.name) !== myName);
                    const hasNomination = Boolean(currentNomination || myNominatedCandidate);

                    // ─── Unified action-list-wrap: Номинация ───
                    const nominateWrap = document.createElement('div');
                    nominateWrap.className = 'action-list-wrap';

                    // Шапка-баннер
                    const nominateHeader = document.createElement('div');
                    nominateHeader.className = 'action-list-header';
                    nominateHeader.innerHTML = `
                        <div class="action-list-header-left">
                            <span class="action-list-header-icon">📋</span>
                            <span>Выставить кандидатуру</span>
                        </div>
                        <div class="action-list-header-right">
                            ${hasNomination ? `✅ Выбор сделан` : `Макс. 1 кандидат`}
                        </div>
                    `;
                    nominateWrap.appendChild(nominateHeader);

                    // Список кандидатов
                    const nominateList = document.createElement('div');
                    nominateList.className = 'action-list';

                    if (aliveOtherPlayers.length === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'action-list-empty';
                        empty.textContent = 'Нет доступных игроков.';
                        nominateList.appendChild(empty);
                    } else {
                        aliveOtherPlayers.forEach(p => {
                            const pName = p.username || p.name;
                            const pIndex = state.players.findIndex(pl => (pl.username === pName || pl.name === pName)) + 1 || '?';
                            const isMyChoice = (currentNomination ? currentNomination === pName : myNominatedCandidate === pName);

                            const row = document.createElement('div');
                            row.className = `action-list-row ${isMyChoice ? 'row-selected' : ''}`;
                            row.innerHTML = `
                                <div class="action-row-left">
                                    <span class="action-row-num">#${pIndex}</span>
                                    <span class="action-row-avatar">👤</span>
                                    <div class="action-row-name-block">
                                        <span class="action-row-name" title="${pName}">${pName}</span>
                                    </div>
                                </div>
                                <div class="action-row-right">
                                    ${isMyChoice
                                        ? `<div class="action-confirmed-badge">✅ Выдвинут</div>`
                                        : `<button type="button" class="action-btn">${hasNomination ? 'ИЗМЕНИТЬ' : 'ВЫДВИНУТЬ'}</button>`
                                    }
                                </div>
                            `;

                            if (!isMyChoice) {
                                const btn = row.querySelector('.action-btn');
                                if (btn) {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        myNominatedCandidate = pName;
                                        socket.emit('nominateCandidate', { roomId, candidateName: pName });
                                    });
                                }
                            }
                            nominateList.appendChild(row);
                        });
                    }

                    nominateWrap.appendChild(nominateList);
                    actionPanel.appendChild(nominateWrap);
                }
            }

            if (finishSpeechBtn) {
                finishSpeechBtn.style.display = isMyTurn ? 'inline-block' : 'none';
            }
        } else if (isVotingPhase) {
            // ─── ФАЗА 3: ГОЛОСОВАНИЕ (Сетка 4x3 скрыта, вертикальный список кандидатов по центру) ───
            playersGrid.classList.add('hidden');
            playersGrid.style.display = 'none';

            if (actionPanel) {
                actionPanel.classList.remove('hidden');
                actionPanel.style.display = 'flex';

                const myVote = state.votes ? (state.votes[myName] || state.votes[username]) : null;
                const hasVoted = Boolean(myVote);
                const alivePlayers = state.players.filter(p => p.isAlive !== false);
                const isTieBreaker = Boolean(state.isTieBreaker);
                const candidates = state.votingCandidates || [];
                const isDuelRevote = isTieBreaker && candidates.length === 2;
                const isCandidateInDuel = isDuelRevote && (
                    candidates.includes(myName) || candidates.includes(username) ||
                    (me && (candidates.includes(me.username) || candidates.includes(me.name)))
                );
                const isAlive = me && me.isAlive !== false;
                const canVote = isAlive && !isCandidateInDuel;
                const eligibleVoters = isDuelRevote
                    ? alivePlayers.filter(p => { const pn = p.username || p.name; return !candidates.includes(pn) && !candidates.includes(p.username) && !candidates.includes(p.name); })
                    : alivePlayers;
                const totalVoters = eligibleVoters.length;
                const votedCount = Object.keys(state.votes || {}).filter(k => !(isDuelRevote && candidates.includes(k))).length;

                // ─── Unified action-list-wrap: Голосование ───
                const votingWrap = document.createElement('div');
                votingWrap.className = 'action-list-wrap';

                // Шапка-баннер
                const votingHeader = document.createElement('div');
                votingHeader.className = 'action-list-header';
                const headerIcon = isDuelRevote ? '⚖️' : '🗳️';
                const headerTitle = isDuelRevote ? 'Переголосование (дуэль)' : 'Голосование';
                votingHeader.innerHTML = `
                    <div class="action-list-header-left">
                        <span class="action-list-header-icon">${headerIcon}</span>
                        <span>${headerTitle}</span>
                    </div>
                    <div class="action-list-header-right">
                        📊 Проголосовало: <strong>${votedCount} из ${totalVoters}</strong>
                    </div>
                `;
                votingWrap.appendChild(votingHeader);

                // Предупреждение для участника дуэли
                if (isCandidateInDuel) {
                    const warn = document.createElement('div');
                    warn.className = 'action-list-warning';
                    warn.innerHTML = '⚖️ <strong>Вы участник дуэли</strong> и лишены права голоса в этом раунде.';
                    votingWrap.appendChild(warn);
                }

                // Список кандидатов
                const votingList = document.createElement('div');
                votingList.className = 'action-list';

                if (candidates.length === 0) {
                    const emptyEl = document.createElement('div');
                    emptyEl.className = 'action-list-empty';
                    emptyEl.textContent = 'Кандидаты на голосование отсутствуют.';
                    votingList.appendChild(emptyEl);
                } else {
                    candidates.forEach(candName => {
                        const candPlayer = state.players.find(p => (p.username === candName || p.name === candName));
                        const candIndex = state.players.findIndex(p => (p.username === candName || p.name === candName)) + 1 || '?';
                        const isCandMe = (candName === myName || candName === username);
                        const hasVotedForThis = (myVote === candName);
                        const isDisabled = !canVote;

                        const row = document.createElement('div');
                        row.className = `action-list-row ${hasVotedForThis ? 'row-selected' : ''} ${isDisabled ? 'row-disabled' : ''}`;

                        row.innerHTML = `
                            <div class="action-row-left">
                                <span class="action-row-num">#${candIndex}</span>
                                <span class="action-row-avatar">👤</span>
                                <div class="action-row-name-block">
                                    <span class="action-row-name" title="${candName}">${candName}${isCandMe ? ' (Вы)' : ''}</span>
                                </div>
                            </div>
                            <div class="action-row-right">
                                ${hasVotedForThis
                                    ? `<div class="action-confirmed-badge">✅ Ваш голос</div>`
                                    : `<button type="button" class="action-btn" ${isDisabled ? 'disabled' : ''}>${hasVoted ? 'ИЗМЕНИТЬ ГОЛОС' : 'ГОЛОСОВАТЬ'}</button>`
                                }
                            </div>
                        `;

                        if (!hasVotedForThis && canVote) {
                            const voteBtn = row.querySelector('.action-btn');
                            if (voteBtn) {
                                voteBtn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    const candId = candPlayer ? candPlayer.id : null;
                                    socket.emit('submitVote', { roomId, candidateId: candId, candidateName: candName });
                                    socket.emit('castVote', { roomId, candidateName: candName, candidateId: candId });
                                });
                            }
                        }

                        votingList.appendChild(row);
                    });
                }

                votingWrap.appendChild(votingList);
                actionPanel.appendChild(votingWrap);
            }
        } else if (isNightPhase) {
            // ─── ФАЗА 5: НОЧЬ (Сетка 4×3 полностью скрыта, вертикальный список целей по центру) ───
            playersGrid.classList.add('hidden');
            playersGrid.style.display = 'none';

            const isAlive = me && me.isAlive !== false;
            const isActiveRole = isAlive && myRole !== 'Мирный житель';
            const myRoleLower = (myRole || '').toLowerCase();

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

            if (actionPanel) {
                actionPanel.classList.remove('hidden');
                actionPanel.style.display = 'flex';

                if (!isActiveRole) {
                    // Пассивный игрок — баннер ожидания
                    const nightContainer = document.createElement('div');
                    nightContainer.className = 'night-phase-container';

                    const sleepBanner = document.createElement('div');
                    sleepBanner.className = 'night-sleep-banner';
                    sleepBanner.innerHTML = '<span class="night-sleep-icon">🌙</span><span>Город засыпает... Ожидайте завершения ночных действий.</span>';
                    nightContainer.appendChild(sleepBanner);
                    actionPanel.appendChild(nightContainer);
                } else {
                    // Активная роль — вертикальный список целей
                    if (myRoleLower.includes('дон')) {
                        const checks = state.donChecks;
                        if (checks && (checks[myName] || checks[username])) donAlreadyChecked = true;
                    }

                    let roleIcon = '🌙';
                    let hintText = '';

                    if (myRoleLower.includes('шериф')) {
                        roleIcon = '🔍'; hintText = 'Чей багажник проверить?';
                    } else if (myRoleLower.includes('дон')) {
                        roleIcon = '🎩';
                        hintText = !donAlreadyChecked ? 'Шаг 1: Кого проверить на шерифство?' : 'Шаг 2: Выберите цель для выстрела:';
                    } else if (myRoleLower.includes('мафия')) {
                        roleIcon = '🔫'; hintText = 'Кого угостить несвежим пончиком?';
                    } else if (myRoleLower.includes('доктор')) {
                        roleIcon = '💊'; hintText = 'Кого исцелить этой ночью?';
                    } else if (myRoleLower.includes('маньяк') || myRoleLower.includes('maniac')) {
                        roleIcon = '🔪'; hintText = 'Выберите цель для ночной атаки:';
                    }

                    const gameMode = currentSettings?.rules?.gameMode || currentSettings?.gameMode || 'city';
                    const isSportMode = gameMode === 'sport';

                    let selectablePlayers = state.players.filter(p => p.isAlive !== false);
                    if (myRoleLower.includes('шериф')) {
                        selectablePlayers = selectablePlayers.filter(p => (p.username || p.name) !== myName);
                    }

                    // ─── Unified action-list-wrap: Ночное действие ───
                    const nightWrap = document.createElement('div');
                    nightWrap.className = 'action-list-wrap';

                    // Шапка-баннер
                    const nightHeader = document.createElement('div');
                    nightHeader.className = 'action-list-header';
                    nightHeader.innerHTML = `
                        <div class="action-list-header-left">
                            <span class="action-list-header-icon">${roleIcon}</span>
                            <span>Ночное действие</span>
                        </div>
                        <div class="action-list-header-right">${hintText}</div>
                    `;
                    nightWrap.appendChild(nightHeader);

                    // Список целей
                    const nightList = document.createElement('div');
                    nightList.className = 'action-list';

                    selectablePlayers.forEach(player => {
                        const pName = player.username || player.name;
                        const pIndex = state.players.findIndex(p => (p.username === pName || p.name === pName)) + 1 || '?';
                        const isCandMe = (pName === myName || pName === username);

                        let isSelected = false;
                        let selectedLabel = '';
                        let sideInfo = '';

                        if (myRoleLower.includes('шериф')) {
                            if (state.sheriffChecks && (state.sheriffChecks[myName]?.target === pName || state.sheriffChecks[username]?.target === pName)) {
                                isSelected = true; selectedLabel = '🔍 Проверен';
                            }
                        } else if (myRoleLower.includes('дон')) {
                            const isMafiaTarget = state.nightVotes && (state.nightVotes[myName] === pName || state.nightVotes[username] === pName);
                            const isDonChecked = state.donChecks && (state.donChecks[myName]?.target === pName || state.donChecks[username]?.target === pName);
                            if (!donAlreadyChecked) {
                                if (isDonChecked) { isSelected = true; selectedLabel = '✅ Проверен'; }
                            } else {
                                if (isDonChecked) sideInfo = '🔍 Ранее проверен';
                                if (isMafiaTarget) { isSelected = true; selectedLabel = '🔫 Цель выстрела'; }
                            }
                        } else if (myRoleLower.includes('мафия')) {
                            const myNightVote = state.nightVotes && (state.nightVotes[myName] === pName || state.nightVotes[username] === pName);
                            if (myNightVote) { isSelected = true; selectedLabel = '✅ Выбор сделан'; }
                            if (!isSportMode && !myNightVote && state.nightVotes) {
                                const av = Object.values(state.nightVotes);
                                if (av.length > 0 && av.every(v => v === pName)) sideInfo = '🎯 Согласие команды';
                            }
                        } else if (myRoleLower.includes('доктор')) {
                            if (state.doctorTarget === pName || (state.doctorHeals && (state.doctorHeals[myName] === pName || state.doctorHeals[username] === pName))) {
                                isSelected = true; selectedLabel = '✅ Выбор сделан';
                            }
                        } else if (myRoleLower.includes('маньяк') || myRoleLower.includes('maniac')) {
                            if (state.maniacTarget === pName) { isSelected = true; selectedLabel = '✅ Выбор сделан'; }
                        }

                        // Sheriff and Don Step 1 investigation are single-shot and lock after selection
                        const isLockedSingleShot = (
                            myRoleLower.includes('шериф') && !!(state.sheriffChecks && (state.sheriffChecks[myName] || state.sheriffChecks[username]))
                        ) || (
                            myRoleLower.includes('дон') && !donAlreadyChecked && !!(state.donChecks && (state.donChecks[myName] || state.donChecks[username]))
                        );

                        const isDisabledOther = isLockedSingleShot && !isSelected;

                        const row = document.createElement('div');
                        row.className = `action-list-row ${isSelected ? 'row-selected' : ''} ${isDisabledOther ? 'row-disabled' : ''}`;

                        row.innerHTML = `
                            <div class="action-row-left">
                                <span class="action-row-num">#${pIndex}</span>
                                <span class="action-row-avatar">👤</span>
                                <div class="action-row-name-block">
                                    <span class="action-row-name" title="${pName}">${pName}${isCandMe ? ' (Вы)' : ''}</span>
                                    ${sideInfo ? `<span class="action-row-sub">${sideInfo}</span>` : ''}
                                </div>
                            </div>
                            <div class="action-row-right">
                                ${isSelected
                                    ? `<div class="action-confirmed-badge">${selectedLabel}</div>`
                                    : `<button type="button" class="action-btn" ${isDisabledOther ? 'disabled' : ''}>ВЫБРАТЬ</button>`
                                }
                            </div>
                        `;

                        if (!isSelected && !isDisabledOther) {
                            const btn = row.querySelector('.action-btn');
                            if (btn) {
                                btn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    if (myRoleLower.includes('дон')) {
                                        if (!donAlreadyChecked) socket.emit('roleAction', { roomId, roleName: 'Дон мафии', targetName: pName });
                                        else socket.emit('nightAction', { roomId, targetName: pName });
                                    } else if (myRoleLower.includes('шериф')) {
                                        socket.emit('roleAction', { roomId, roleName: 'Шериф', targetName: pName });
                                    } else {
                                        socket.emit('nightAction', { roomId, targetName: pName });
                                    }
                                });
                            }
                        }

                        nightList.appendChild(row);
                    });

                    nightWrap.appendChild(nightList);
                    actionPanel.appendChild(nightWrap);
                }
            }
        } else {
            // ─── ДРУГИЕ ФАЗЫ (1, 0.5): Сетка 4×3 отображается ───
            playersGrid.classList.remove('hidden');
            playersGrid.style.display = 'grid';
            playersGrid.className = 'table-players-grid grid-mode';
            playersGrid.innerHTML = '';

            const TOTAL_SLOTS = 12;
            for (let i = 0; i < TOTAL_SLOTS; i++) {
                const player = state.players[i];
                const card = document.createElement('div');

                if (player) {
                    const pName = player.username || player.name || `Игрок ${i + 1}`;
                    const isMe = (player.id === socket.id);
                    const isAlive = player.isAlive !== false;
                    const isSpeaker = state.currentSpeaker === pName;

                    card.className = `player-card ${!isAlive ? 'dead' : ''} ${isSpeaker ? 'is-speaker' : ''}`;

                    if (!isAlive) {
                        card.style.borderColor = 'rgba(255,83,112,0.35)';
                        card.style.background = 'rgba(255,83,112,0.06)';
                    } else if (isSpeaker) {
                        card.style.borderColor = 'rgba(255,209,102,0.7)';
                        card.style.background = 'rgba(255,209,102,0.12)';
                    } else if (isMe) {
                        card.style.borderColor = 'rgba(29,209,161,0.5)';
                        card.style.background = 'rgba(29,209,161,0.07)';
                    }

                    const statusText = isAlive ? (isSpeaker ? '🗣️ Говорит' : '🟢 В игре') : '💀 Выбыл';
                    const statusColor = isAlive ? (isSpeaker ? 'var(--clr-gold)' : 'var(--clr-teal)') : 'var(--clr-red)';
                    const audioBtn = createAudioButton(player, socket.id);

                    card.innerHTML = `
                        <div style="font-size:0.78rem;font-weight:800;color:var(--clr-muted);opacity:0.7;">#${i + 1}</div>
                        <div style="font-size:0.88rem;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${pName}">${pName}${isMe ? ' (Вы)' : ''}</div>
                        <div style="font-size:0.75rem;color:${statusColor};">${statusText}</div>
                    `;
                    card.appendChild(audioBtn);

                    if (!isMe) {
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', (e) => {
                            if (e.target.closest('button')) return;
                            showPlayerContextMenu(player, socket, roomId, isHost, card);
                        });
                        card.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            if (e.target.closest('button')) return;
                            showPlayerContextMenu(player, socket, roomId, isHost, card);
                        });
                    }
                } else {
                    card.className = 'player-card';
                    card.style.opacity = '0.35';
                    card.style.cursor = 'default';
                    card.innerHTML = `
                        <div style="font-size:0.78rem;font-weight:800;color:var(--clr-muted);opacity:0.7;">#${i + 1}</div>
                        <div style="font-size:0.82rem;color:var(--clr-muted);">Свободно</div>
                    `;
                }
                playersGrid.appendChild(card);
            }

            // Фаза 1: Общее собрание (actionPanel строго скрыт)
            if (state.phase === 1) {
                if (actionPanel) {
                    actionPanel.innerHTML = '';
                    actionPanel.classList.add('hidden');
                    actionPanel.style.display = 'none';
                }
            }

            // Фаза 0.5 — договорка
            if (state.phase === 0.5) {
                const isMafiaPlayer = me && me.isAlive !== false &&
                    (myRole.includes('Мафия') || myRole.includes('Дон') || (me.team && me.team === 'Мафия'));

                if (actionPanel) {
                    actionPanel.classList.remove('hidden');
                    actionPanel.style.display = 'flex';
                    actionPanel.style.flexDirection = 'column';
                    actionPanel.style.alignItems = 'center';
                    actionPanel.style.gap = '8px';

                    const huddle = document.createElement('div');
                    huddle.style.cssText = `padding:12px 16px;border-radius:12px;text-align:center;background:${isMafiaPlayer ? 'rgba(255,83,112,0.1)' : 'rgba(84,160,255,0.08)'};border:1px solid ${isMafiaPlayer ? 'rgba(255,83,112,0.3)' : 'rgba(84,160,255,0.2)'};max-width:440px;width:100%;`;
                    if (isMafiaPlayer) {
                        const teamNames = (state.players || []).filter(p => p.isAlive !== false && p.team === 'Мафия').map(p => `<span class="huddle-team-tag">${p.username || p.name}</span>`).join('');
                        huddle.innerHTML = `<div style="font-size:1.4rem;">🎭</div><h3 style="color:var(--clr-red);margin:4px 0;">Договорка</h3><p style="color:var(--clr-muted);font-size:0.85rem;">У вас <strong>60 секунд</strong> на выработку стратегии. Говорите свободно.</p><div class="huddle-team-list" style="margin-top:6px;">Члены команды: ${teamNames}</div>`;
                    } else {
                        huddle.innerHTML = `<div style="font-size:1.4rem;">🌙</div><h3 style="color:var(--clr-muted);margin:4px 0;">Город спит...</h3><p style="color:var(--clr-muted);font-size:0.85rem;">Чёрная команда проводит закрытое совещание. Ожидайте завершения договорки.</p>`;
                    }
                    actionPanel.appendChild(huddle);
                }
            }
        }

        if (endGameBtn) {
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
            <div class="modal-content game-over-modal-content">
                <h2 id="game-over-title" class="game-over-title">🏆 Игра окончена!</h2>
                <div id="game-over-winner" class="game-over-winner"></div>
                <div class="game-over-roles-wrap">
                    <h4>Раскрытие ролей:</h4>
                    <div id="game-over-roles-list"></div>
                </div>
                <button id="game-over-confirm-btn" class="game-over-confirm-btn">Вернуться в лобби</button>
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
    const winnerClass = isMafiaWin ? 'u-color-red' : 'u-color-teal';
    winnerTextElem.innerHTML = `Победила команда: <span class="${winnerClass}">${winner || 'Завершено'}</span> 🎉`;

    const rolesListElem = document.getElementById('game-over-roles-list');
    rolesListElem.innerHTML = '';

    if (players && players.length > 0) {
        players.forEach(p => {
            const pName = p.username || p.name;
            const pRole = p.role || 'Мирный житель';
            const isAliveText = p.isAlive ? '🟢 Жив' : '😡 Исключён';
            
            let roleIcon = '🍩';
            if (pRole.includes('Дон')) roleIcon = '🎩';
            else if (pRole.includes('Мафия')) roleIcon = '🕶️';
            else if (pRole.includes('Шериф')) roleIcon = '⭐';
            else if (pRole.includes('Доктор')) roleIcon = '🩺';
            else if (pRole.includes('Маньяк') || pRole.includes('maniac')) roleIcon = '🔪';

            const item = document.createElement('div');
            item.className = 'game-over-role-item';
            item.innerHTML = `
                <span><b>${pName}</b></span>
                <span>${roleIcon} ${pRole} <small class="game-over-role-status">(${isAliveText})</small></span>
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
            <div class="modal-content action-result-modal-content">
                <h3>🔍 Досье проверки</h3>
                <div id="action-result-text"></div>
                <button id="action-result-confirm-btn" class="action-result-confirm-btn">Принято</button>
            </div>
        `;
        document.body.appendChild(actionModal);
    }

    document.getElementById('action-result-confirm-btn').onclick = () => {
        actionModal.style.display = 'none';
        const nightModal = document.getElementById('nightModal');
        if (nightModal) {
            nightModal.style.display = 'block';
        }
    };

    const resultLower = (result || '').toLowerCase();
    const isPositiveFind = resultLower.includes('шериф') || resultLower.includes('пончиков');
    const resultVerdictClass = isPositiveFind ? 'action-result--found' : 'action-result--not-found';
    
    const resultTextElem = document.getElementById('action-result-text');
    resultTextElem.innerHTML = `
        <div class="action-result-dossier">
            <p class="action-result-target">Объект проверки: <b>${target}</b></p>
            <p class="action-result-verdict ${resultVerdictClass}">${result}</p>
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
                <button id="night-news-confirm-btn" class="night-news-confirm-btn">Понятно</button>
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

        if (role.includes('Дон')) {
            roleClass = 'don';
            roleIcon = '🎩🕶️';
            roleDesc = 'Глава мафии. Каждую ночь ищет Шерифа и руководит голосованием мафии.';
        } else if (role.includes('Мафия')) {
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
        } else if (role.includes('Маньяк') || role.includes('maniac')) {
            roleClass = 'maniac';
            roleIcon = '🔪🩸';
            roleDesc = 'Одиночка. Каждую ночь устраняет одну цель, чтобы остаться последним выжившим.';
        }

        modalPlayerRole.innerHTML = `
            <div class="role-card-item ${roleClass} role-modal-card">
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
            document.getElementById('setting-gameMode').value = currentSettings.rules.gameMode || 'city'; // ← Добавлено
            document.getElementById('setting-firstDayVoting').checked = currentSettings.rules.firstDayVoting;
            document.getElementById('setting-secretVoting').checked = currentSettings.rules.secretVoting;

            document.getElementById('setting-extraMafia').value = currentSettings.roles.extraMafia || 0;
            document.getElementById('setting-don').checked = !!currentSettings.roles.don;
            document.getElementById('setting-sheriff').checked = !!currentSettings.roles.sheriff;
            document.getElementById('setting-doctor').checked = !!currentSettings.roles.doctor;
            document.getElementById('setting-zhivchik').checked = !!currentSettings.roles.zhivchik;
            document.getElementById('setting-maniac').checked = !!currentSettings.roles.maniac;
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
                gameMode: document.getElementById('setting-gameMode').value, // ← Добавлено
                firstDayVoting: document.getElementById('setting-firstDayVoting').checked,
                secretVoting: document.getElementById('setting-secretVoting').checked
            },
            roles: {
                extraMafia: parseInt(document.getElementById('setting-extraMafia').value) || 0,
                don: document.getElementById('setting-don').checked ? 1 : 0,
                sheriff: document.getElementById('setting-sheriff').checked ? 1 : 0,
                doctor: document.getElementById('setting-doctor').checked ? 1 : 0,
                zhivchik: document.getElementById('setting-zhivchik').checked ? 1 : 0,
                maniac: document.getElementById('setting-maniac').checked ? 1 : 0
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

function updateSidebarRoleInfo(role) {
    const rolePanel = document.getElementById('my-role-panel');
    const roleNameEl = document.getElementById('my-role-display-name');
    const roleDescEl = document.getElementById('my-role-display-desc');
    if (!roleNameEl || !role) return;

    roleNameEl.textContent = role;

    let desc = 'Днем вычисляйте мафию на голосованиях и очистите город.';
    let roleClass = 'role-civilian';

    const rLower = role.toLowerCase();
    if (rLower.includes('дон')) {
        desc = 'Глава мафии. Ищите Шерифа ночью и координируйте клан.';
        roleClass = 'role-don';
    } else if (rLower.includes('мафия')) {
        desc = 'Стреляйте ночью вместе с кланом и захватите город.';
        roleClass = 'role-mafia';
    } else if (rLower.includes('шериф')) {
        desc = 'Ночью проверяйте игроков и ведите мирных к победе.';
        roleClass = 'role-sheriff';
    } else if (rLower.includes('доктор')) {
        desc = 'Ночью лечите жителей и спасайте от ночных покушений.';
        roleClass = 'role-doctor';
    } else if (rLower.includes('живчик')) {
        desc = 'Имеете 2 жизни: выдерживаете одно любое нападение.';
        roleClass = 'role-zhivchik';
    } else if (rLower.includes('маньяк')) {
        desc = 'Одиночка: устраняйте жителей ночью ради личной победы.';
        roleClass = 'role-maniac';
    }

    if (roleDescEl) roleDescEl.textContent = desc;

    if (rolePanel) {
        rolePanel.className = `my-role-badge-card ${roleClass}`;
    }
}

function updateSidebarPlayers(players, state) {
    const sidebarList = document.getElementById('game-sidebar-players-list');
    const aliveCountEl = document.getElementById('sidebar-alive-count');
    if (!sidebarList || !players) return;

    const alivePlayers = players.filter(p => p.isAlive !== false);
    if (aliveCountEl) {
        aliveCountEl.textContent = `Живых: ${alivePlayers.length}/${players.length}`;
    }

    const isHost = players.length > 0 && players[0].id === socket.id;

    sidebarList.innerHTML = '';
    players.forEach((player, index) => {
        const pName = player.username || player.name || `Игрок ${index + 1}`;
        const isAlive = player.isAlive !== false;
        const isSpeaker = state && state.currentSpeaker === pName;
        const isMe = (player.username === username || player.name === username || player.id === socket.id);

        const row = document.createElement('div');
        row.className = `sidebar-player-row ${isSpeaker ? 'is-speaker' : ''} ${!isAlive ? 'is-dead' : ''}`;
        row.dataset.playerId = player.userId || player.id;
        row.dataset.socketId = player.id;

        const left = document.createElement('div');
        left.className = 'sidebar-player-left';
        left.innerHTML = `
            <span class="sidebar-player-num">#${index + 1}</span>
            <span class="sidebar-player-name" title="${pName}">${pName} ${isMe ? '(Вы)' : ''}</span>
        `;

        const right = document.createElement('div');
        right.className = 'sidebar-player-right';

        const statusTag = document.createElement('span');
        statusTag.className = `sidebar-status-tag ${isAlive ? 'alive' : 'dead'}`;
        statusTag.textContent = isAlive ? (isSpeaker ? '🗣️ Говорит' : '🟢 Жив') : '💀 Выбыл';
        right.appendChild(statusTag);

        const audioBtn = createAudioButton(player, socket.id);
        right.appendChild(audioBtn);

        row.appendChild(left);
        row.appendChild(right);

        if (!isMe) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                showPlayerContextMenu(player, socket, roomId, isHost, row);
            });
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (e.target.closest('button')) return;
                showPlayerContextMenu(player, socket, roomId, isHost, row);
            });
        }

        sidebarList.appendChild(row);
    });
}

function initMobileLogDrawer() {
    const mobileCloseLogBtn = document.getElementById('mobile-log-close-btn');
    const mobileLogBackdrop = document.getElementById('mobile-log-backdrop');
    const gamePanelLog = document.getElementById('game-panel-log');

    function toggleMobileLog(open) {
        const logPanel = document.getElementById('game-panel-log') || gamePanelLog;
        const backdrop = document.getElementById('mobile-log-backdrop') || mobileLogBackdrop;
        if (!logPanel) return;
        const isOpen = logPanel.classList.contains('mobile-open');
        const shouldOpen = (open !== undefined) ? open : !isOpen;
        if (shouldOpen) {
            logPanel.classList.add('mobile-open');
            if (backdrop) backdrop.classList.add('active');
        } else {
            logPanel.classList.remove('mobile-open');
            if (backdrop) backdrop.classList.remove('active');
        }
    }

    window.toggleMobileLog = toggleMobileLog;

    // Привязываем все кнопки журнала с классом .mobile-log-btn или соответствующими ID
    document.querySelectorAll('.mobile-log-btn, #mobile-log-toggle-btn, #lobby-log-toggle-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            toggleMobileLog(true);
        };
    });

    if (mobileCloseLogBtn) mobileCloseLogBtn.onclick = () => toggleMobileLog(false);
    if (mobileLogBackdrop) mobileLogBackdrop.onclick = () => toggleMobileLog(false);
}

initMobileLogDrawer();

function initBurgerMenu() {
    function closeAllBurgerDropdowns() {
        document.querySelectorAll('.game-burger-dropdown').forEach(dd => dd.classList.remove('open'));
    }

    document.querySelectorAll('.game-burger-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrap = btn.closest('.game-burger-menu-wrap');
            const dropdown = wrap ? wrap.querySelector('.game-burger-dropdown') : null;
            if (!dropdown) return;
            const isOpen = dropdown.classList.contains('open');
            closeAllBurgerDropdowns();
            if (!isOpen) {
                dropdown.classList.add('open');
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.game-burger-menu-wrap')) {
            closeAllBurgerDropdowns();
        }
    });

    // Пункт «⚙️ Настройки»
    document.querySelectorAll('.burger-settings-item').forEach(btn => {
        btn.addEventListener('click', () => {
            closeAllBurgerDropdowns();
            const openSettingsBtn = document.getElementById('open-settings-btn');
            if (openSettingsBtn && openSettingsBtn.style.display !== 'none') {
                openSettingsBtn.click();
            } else {
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal) {
                    if (currentSettings) {
                        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
                        const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
                        if (currentSettings.timers) {
                            setVal('setting-generalMeeting', currentSettings.timers.generalMeeting);
                            setVal('setting-individualSpeech', currentSettings.timers.individualSpeech);
                        }
                        if (currentSettings.rules) {
                            setVal('setting-maxPlayers', currentSettings.rules.maxPlayers);
                            setVal('setting-gameMode', currentSettings.rules.gameMode || 'city');
                            setCheck('setting-firstDayVoting', currentSettings.rules.firstDayVoting);
                            setCheck('setting-secretVoting', currentSettings.rules.secretVoting);
                        }
                        if (currentSettings.roles) {
                            setVal('setting-extraMafia', currentSettings.roles.extraMafia || 0);
                            setCheck('setting-don', currentSettings.roles.don);
                            setCheck('setting-sheriff', currentSettings.roles.sheriff);
                            setCheck('setting-doctor', currentSettings.roles.doctor);
                            setCheck('setting-zhivchik', currentSettings.roles.zhivchik);
                            setCheck('setting-maniac', currentSettings.roles.maniac);
                        }
                    }
                    settingsModal.style.display = 'flex';
                }
            }
        });
    });

    // Пункт «🔄 Обновить»
    document.querySelectorAll('.burger-reload-item').forEach(btn => {
        btn.addEventListener('click', () => {
            closeAllBurgerDropdowns();
            window.location.reload(true);
        });
    });

    // Пункт «🚪 Выйти»
    document.querySelectorAll('.burger-end-game-item').forEach(btn => {
        btn.addEventListener('click', () => {
            closeAllBurgerDropdowns();
            socket.emit('endGame', { roomId });
        });
    });

    document.querySelectorAll('.burger-leave-item').forEach(btn => {
        btn.addEventListener('click', () => {
            closeAllBurgerDropdowns();
            socket.emit('leaveRoom', { roomId });
            window.location.href = '/';
        });
    });
}

initBurgerMenu();

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

// Блокировка масштабирования двухпальцевым жестом на Android
document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// Блокировка двойного тапа
document.addEventListener('dblclick', function(e) {
    e.preventDefault();
}, { passive: false });

document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });