export const AudioModule = {
  localStream: null,
  peerConnections: {},
  iceCandidateQueues: {}, // Буфер для ранних ICE-кандидатов

  serverCanSpeak: true,   // Авторитетное разрешение от сервера на включение микрофона
  userWantsMic: true,     // Пользовательское желание держать микрофон включённым
  allowedSpeakers: [],    // Список ID игроков, чей голос разрешено слышать в текущей фазе
  manuallyMutedPeers: new Set(), // Игроки, заглушенные локально пользователем через интерфейс

  async startMicrophone() {
    if (this.localStream && this.localStream.active && this.localStream.getAudioTracks().length > 0) {
      this.updateMicrophoneHardware();
      return this.localStream;
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      this.updateMicrophoneHardware();
      return this.localStream;
    } catch (error) {
      console.error('Ошибка доступа к микрофону:', error);
      return null;
    }
  },

  /**
   * Полный сброс текущих медиапотоков и повторный запрос разрешений на микрофон и камеру
   */
  async requestUserMediaAndReset(includeVideo = true) {
    // 1. Закрываем все текущие WebRTC соединения и останавливаем старые дорожки
    this.disconnect();

    // 2. Удаляем все ранее созданные теги <audio> для пиров
    document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());

    // 3. Запрашиваем доступ к микрофону и камере
    if (includeVideo && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const combinedStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        // Освобождаем видеотрек, если видео не выводится в интерфейс игры
        combinedStream.getVideoTracks().forEach(track => track.stop());
        
        // Оставляем аудиотрек в localStream
        this.localStream = new MediaStream(combinedStream.getAudioTracks());
      } catch (err) {
        console.warn('Не удалось запросить видео/камеру, пробуем только микрофон:', err);
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          });
        } catch (audioErr) {
          console.error('Ошибка доступа к микрофону:', audioErr);
        }
      }
    } else {
      await this.startMicrophone();
    }

    this.updateMicrophoneHardware();
    return this.localStream;
  },

  /**
   * Устанавливает серверные права на аудио и обновляет состояние треков и приём звука
   */
  setPermissions(permissions) {
    if (!permissions) return;
    this.serverCanSpeak = Boolean(permissions.canSpeak);
    if (Array.isArray(permissions.allowedSpeakers)) {
      this.allowedSpeakers = permissions.allowedSpeakers;
    }

    this.updateMicrophoneHardware();
    this.updateIncomingAudio();
  },

  /**
   * Применяет физическое состояние (enabled) к аудиодорожкам локального медиапотока
   */
  updateMicrophoneHardware() {
    const effectiveEnabled = this.serverCanSpeak && this.userWantsMic;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = effectiveEnabled;
      });
    }
  },

  /**
   * Прямое переключение микрофона
   */
  toggleMicrophone(enabled) {
    this.userWantsMic = Boolean(enabled);
    this.updateMicrophoneHardware();
  },

  /**
   * Пользовательский клик по кнопке микрофона
   * Возвращает статус переключения
   */
  toggleUserMic() {
    if (!this.serverCanSpeak) {
      return { success: false, isMicOn: false, reason: 'server_muted' };
    }
    this.userWantsMic = !this.userWantsMic;
    this.updateMicrophoneHardware();
    return { success: true, isMicOn: this.userWantsMic };
  },

  /**
   * Обновляет приём аудио для всех аудиоэлементов игроков в соответствии с правилами фазы
   */
  updateIncomingAudio() {
    const audioElements = document.querySelectorAll('audio[id^="audio-"]');
    audioElements.forEach(audioEl => {
      const peerId = audioEl.id.replace('audio-', '');
      const isAllowedByServer = this.allowedSpeakers.includes(peerId);
      const isManuallyMuted = this.manuallyMutedPeers.has(peerId);

      // Элемент глушится, если сервер запретил слушать этого игрока в данной фазе
      // ИЛИ если пользователь сам заглушил его
      audioEl.muted = !isAllowedByServer || isManuallyMuted;
    });
  },

  /**
   * Локальное переключение звука конкретного игрока пользователем
   */
  togglePeerMute(peerId) {
    if (this.manuallyMutedPeers.has(peerId)) {
      this.manuallyMutedPeers.delete(peerId);
    } else {
      this.manuallyMutedPeers.add(peerId);
    }
    this.updateIncomingAudio();
    return this.manuallyMutedPeers.has(peerId);
  },

  isPeerMuted(peerId) {
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl) return audioEl.muted;
    return !this.allowedSpeakers.includes(peerId) || this.manuallyMutedPeers.has(peerId);
  },

  closePeerConnection(targetUserId) {
    if (this.peerConnections[targetUserId]) {
      try {
        this.peerConnections[targetUserId].close();
      } catch (e) {}
      delete this.peerConnections[targetUserId];
    }
    delete this.iceCandidateQueues[targetUserId];
    const audioEl = document.getElementById(`audio-${targetUserId}`);
    if (audioEl) {
      audioEl.remove();
    }
  },

  async createPeerConnection(targetUserId, socket) {
    if (this.peerConnections[targetUserId]) {
      const state = this.peerConnections[targetUserId].connectionState;
      if (state === 'closed' || state === 'failed') {
        this.closePeerConnection(targetUserId);
      } else {
        return this.peerConnections[targetUserId];
      }
    }

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelay',
                credential: 'openrelay'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelay',
                credential: 'openrelay'
            }
        ]
    });

    this.peerConnections[targetUserId] = pc;
    this.iceCandidateQueues[targetUserId] = [];

    if (!this.localStream || !this.localStream.active) {
      await this.startMicrophone();
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (event) => {
      let audioEl = document.getElementById(`audio-${targetUserId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${targetUserId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = event.streams[0];
      
      this.updateIncomingAudio();

      const playAudio = () => {
        audioEl.play().catch(err => {
          console.warn('Автовоспроизведение ожидает взаимодействия пользователя:', err);
          const unlock = () => {
            audioEl.play().catch(e => console.error('Ошибка воспроизведения:', e));
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
          };
          document.addEventListener('click', unlock);
          document.addEventListener('touchstart', unlock);
        });
      };

      playAudio();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          target: targetUserId,
          signal: { candidate: event.candidate }
        });
      }
    };

    return pc;
  },

  async handleSignal(fromUserId, signal, socket) {
    let pc = this.peerConnections[fromUserId];
    if (signal.sdp && signal.sdp.type === 'offer') {
      if (pc && (pc.signalingState !== 'stable' || pc.connectionState === 'closed' || pc.connectionState === 'failed')) {
        this.closePeerConnection(fromUserId);
        pc = null;
      }
    }

    if (!pc) {
      pc = await this.createPeerConnection(fromUserId, socket);
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      if (this.iceCandidateQueues[fromUserId]) {
        while (this.iceCandidateQueues[fromUserId].length > 0) {
          const candidate = this.iceCandidateQueues[fromUserId].shift();
          await pc.addIceCandidate(candidate).catch(e => console.warn('Ошибка добавления ICE кандидата из очереди:', e));
        }
      }

      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', {
          target: fromUserId,
          signal: { sdp: pc.localDescription }
        });
      }
    } else if (signal.candidate) {
      const candidate = new RTCIceCandidate(signal.candidate);
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(candidate).catch(e => console.warn('Ошибка добавления ICE кандидата:', e));
      } else {
        if (!this.iceCandidateQueues[fromUserId]) {
          this.iceCandidateQueues[fromUserId] = [];
        }
        this.iceCandidateQueues[fromUserId].push(candidate);
      }
    }
  },

  async connectToPeer(targetUserId, socket) {
    this.closePeerConnection(targetUserId);
    const pc = await this.createPeerConnection(targetUserId, socket);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', {
      target: targetUserId,
      signal: { sdp: pc.localDescription }
    });
  },

  disconnect() {
    Object.values(this.peerConnections).forEach(pc => {
      try {
        pc.close();
      } catch (e) {}
    });
    this.peerConnections = {};
    this.iceCandidateQueues = {};

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.localStream = null;
    }
  }
};