/**
 * audio.js / WebRTC Media Module
 * Полноценная P2P WebRTC аудио- и видеосвязь между браузерами игроков
 */

export const AudioModule = {
  localStream: null,
  peerConnections: {},
  iceCandidateQueues: {}, // Буфер для ранних ICE-кандидатов
  remoteStreams: {},      // Хранилище удаленных медиапотоков: { [userId]: MediaStream }

  serverCanSpeak: true,   // Авторитетное разрешение от сервера на включение микрофона
  userWantsMic: true,     // Пользовательское желание держать микрофон включённым
  allowedSpeakers: [],    // Список ID игроков, чей голос разрешено слышать в текущей фазе
  manuallyMutedPeers: new Set(), // Игроки, заглушенные локально пользователем через интерфейс
  onRemoteStreamUpdate: null,    // Callback при получении/обновлении видеопотока

  /**
   * Получение сохраненного разрешения видео из localStorage
   * Поддерживаемый диапазон: от 160x120 до 320x240
   */
  getVideoResolution() {
    const saved = localStorage.getItem('webrtc_video_resolution') || '320x240';
    const parts = saved.split('x').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { width: parts[0], height: parts[1], raw: saved };
    }
    return { width: 320, height: 240, raw: '320x240' };
  },

  /**
   * Получение сохраненного FPS из localStorage (10 - 30 FPS)
   */
  getVideoFPS() {
    const saved = parseInt(localStorage.getItem('webrtc_video_fps'), 10);
    if (!isNaN(saved) && saved >= 10 && saved <= 30) {
      return saved;
    }
    return 20;
  },

  /**
   * Проверка, включена ли камера пользователем
   */
  isVideoEnabled() {
    return localStorage.getItem('webrtc_video_enabled') !== 'false';
  },

  /**
   * Запуск локального медиапотока (микрофон + камера) с текущими настройками качества
   */
  async startMicrophone() {
    if (this.localStream && this.localStream.active && this.localStream.getTracks().length > 0) {
      this.updateMicrophoneHardware();
      this.updateAllLocalVideoElements();
      return this.localStream;
    }

    const res = this.getVideoResolution();
    const fps = this.getVideoFPS();
    const videoEnabled = this.isVideoEnabled();

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: videoEnabled ? {
        width: { ideal: res.width, max: 320 },
        height: { ideal: res.height, max: 240 },
        frameRate: { ideal: fps, max: 30 }
      } : false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.updateMicrophoneHardware();
      this.updateAllLocalVideoElements();
      return this.localStream;
    } catch (err) {
      console.warn('Не удалось получить комбинированный поток (камера+микрофон), пробуем только микрофон:', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.updateMicrophoneHardware();
        this.updateAllLocalVideoElements();
        return this.localStream;
      } catch (audioErr) {
        console.error('Ошибка доступа к микрофону:', audioErr);
        return null;
      }
    }
  },

  /**
   * Обновление параметров видеопотока «на лету» без разрыва WebRTC соединений
   * @param {string} resolutionStr - Строка вида "320x240" или "160x120"
   * @param {number} fpsNum - Число от 10 до 30
   * @param {boolean} isEnabled - Включена ли камера
   */
  async updateVideoQuality(resolutionStr, fpsNum, isEnabled = true) {
    if (resolutionStr) {
      localStorage.setItem('webrtc_video_resolution', resolutionStr);
    }
    if (fpsNum) {
      localStorage.setItem('webrtc_video_fps', String(fpsNum));
    }
    if (isEnabled !== undefined) {
      localStorage.setItem('webrtc_video_enabled', String(isEnabled));
    }

    const res = this.getVideoResolution();
    const fps = this.getVideoFPS();
    const videoWanted = this.isVideoEnabled();

    if (!this.localStream) {
      return;
    }

    let videoTrack = this.localStream.getVideoTracks()[0];

    if (!videoWanted) {
      // Пользователь отключил видео
      if (videoTrack) {
        videoTrack.stop();
        this.localStream.removeTrack(videoTrack);
        // Заменяем трек в peerConnections на null
        for (const pc of Object.values(this.peerConnections)) {
          const senders = pc.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(null).catch(() => {});
          }
        }
      }
      this.updateAllLocalVideoElements();
      return;
    }

    // Если камера включена
    if (videoTrack && videoTrack.readyState === 'live') {
      try {
        // Применяем новые ограничения напрямую в активный трек браузера
        await videoTrack.applyConstraints({
          width: { ideal: res.width, max: 320 },
          height: { ideal: res.height, max: 240 },
          frameRate: { ideal: fps, max: 30 }
        });
        this.updateAllLocalVideoElements();
      } catch (applyErr) {
        console.warn('applyConstraints не поддерживается или вызвал ошибку, пересоздаем видеотрек:', applyErr);
        await this.replaceLocalVideoTrack(res, fps);
      }
    } else {
      // Видеотрека еще не было или он был остановлен — создаем новый и заменяем в соединениях
      await this.replaceLocalVideoTrack(res, fps);
    }
  },

  /**
   * Создание нового видеотрека и замена во всех RTCPeerConnection без разрыва соединения
   */
  async replaceLocalVideoTrack(res, fps) {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: res.width, max: 320 },
          height: { ideal: res.height, max: 240 },
          frameRate: { ideal: fps, max: 30 }
        },
        audio: false
      });

      const newVideoTrack = videoStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const oldTrack = this.localStream?.getVideoTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
      }

      if (this.localStream) {
        this.localStream.addTrack(newVideoTrack);
      } else {
        this.localStream = videoStream;
      }

      // Обновляем трек во всех активных пиринговых соединениях
      for (const pc of Object.values(this.peerConnections)) {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video' || (!s.track && s.kind === 'video'));
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack).catch(e => console.warn('replaceTrack sender error:', e));
        } else {
          try {
            pc.addTrack(newVideoTrack, this.localStream);
          } catch (e) {}
        }
      }

      this.updateAllLocalVideoElements();
    } catch (err) {
      console.error('Ошибка при создании/замене видеотрека:', err);
    }
  },

  /**
   * Подключение медиапотока к HTML-элементу <video>
   * @param {HTMLVideoElement} videoEl - Элемент <video>
   * @param {string} peerId - ID сокета игрока или 'local' / socket.id
   * @param {boolean} isLocal - Является ли поток локальным
   */
  attachVideo(videoEl, peerId, isLocal = false) {
    if (!videoEl) return;

    let stream = null;
    if (isLocal || peerId === 'local') {
      stream = this.localStream;
      videoEl.muted = true; // Локальное видео всегда глушится, чтобы не было эха
    } else {
      stream = this.remoteStreams[peerId] || null;
      videoEl.muted = true; // Аудио воспроизводится через отдельный <audio> элемент для фазового контроля
    }

    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');

    if (stream && stream.getVideoTracks().length > 0) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      videoEl.style.display = 'block';
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    } else {
      if (videoEl.srcObject) {
        videoEl.srcObject = null;
      }
    }
  },

  /**
   * Обновление всех локальных видеоэлементов в DOM
   */
  updateAllLocalVideoElements() {
    const localVideos = document.querySelectorAll('video[data-player-video="local"], video[data-player-video="me"]');
    localVideos.forEach(v => this.attachVideo(v, 'local', true));
  },

  /**
   * Обновление видеоэлементов для конкретного пира
   */
  updatePeerVideoElements(peerId) {
    const peerVideos = document.querySelectorAll(`video[data-player-video="${peerId}"]`);
    peerVideos.forEach(v => this.attachVideo(v, peerId, false));
  },

  /**
   * Сброс медиапотоков и повторный запрос
   */
  async requestUserMediaAndReset(includeVideo = true) {
    this.disconnect();
    document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
    await this.startMicrophone();
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

  toggleMicrophone(enabled) {
    this.userWantsMic = Boolean(enabled);
    this.updateMicrophoneHardware();
  },

  toggleUserMic() {
    if (!this.serverCanSpeak) {
      return { success: false, isMicOn: false, reason: 'server_muted' };
    }
    this.userWantsMic = !this.userWantsMic;
    this.updateMicrophoneHardware();
    return { success: true, isMicOn: this.userWantsMic };
  },

  updateIncomingAudio() {
    const audioElements = document.querySelectorAll('audio[id^="audio-"]');
    audioElements.forEach(audioEl => {
      const peerId = audioEl.id.replace('audio-', '');
      const isAllowedByServer = this.allowedSpeakers.includes(peerId);
      const isManuallyMuted = this.manuallyMutedPeers.has(peerId);

      audioEl.muted = !isAllowedByServer || isManuallyMuted;
    });
  },

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
    delete this.remoteStreams[targetUserId];

    const audioEl = document.getElementById(`audio-${targetUserId}`);
    if (audioEl) {
      audioEl.remove();
    }
    this.updatePeerVideoElements(targetUserId);
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
      const remoteStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);

      if (!this.remoteStreams[targetUserId]) {
        this.remoteStreams[targetUserId] = remoteStream;
      } else {
        // Добавляем трек, если его еще нет
        if (!this.remoteStreams[targetUserId].getTracks().some(t => t.id === event.track.id)) {
          this.remoteStreams[targetUserId].addTrack(event.track);
        }
      }

      // 1. Управление аудиоэлементом для пира
      let audioEl = document.getElementById(`audio-${targetUserId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${targetUserId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
      }
      if (audioEl.srcObject !== remoteStream) {
        audioEl.srcObject = remoteStream;
      }
      this.updateIncomingAudio();

      const playAudio = () => {
        audioEl.play().catch(err => {
          const unlock = () => {
            audioEl.play().catch(() => {});
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
          };
          document.addEventListener('click', unlock);
          document.addEventListener('touchstart', unlock);
        });
      };
      playAudio();

      // 2. Обновление видеоэлементов пира в DOM
      this.updatePeerVideoElements(targetUserId);

      if (typeof this.onRemoteStreamUpdate === 'function') {
        this.onRemoteStreamUpdate(targetUserId, remoteStream);
      }
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
    this.remoteStreams = {};

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