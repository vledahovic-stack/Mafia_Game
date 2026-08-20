export const AudioModule = {
  localStream: null,
  peerConnections: {},
  iceCandidateQueues: {}, // Буфер для ранних ICE-кандидатов

  async startMicrophone() {
    if (this.localStream) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      return this.localStream;
    } catch (error) {
      console.error('Ошибка доступа к микрофону:', error);
      return null;
    }
  },

  toggleMicrophone(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  },

  toggleIncomingAudio(audioElements, enabled) {
    audioElements.forEach(audio => {
      audio.muted = !enabled;
    });
  },

  async createPeerConnection(targetUserId, socket) {
    // Если соединение уже есть, возвращаем его
    if (this.peerConnections[targetUserId]) {
      return this.peerConnections[targetUserId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.iceCandidateQueues[targetUserId] = [];

    // Гарантируем, что микрофон захвачен перед добавлением треков
    if (!this.localStream) {
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
      
      // Принудительный запуск воспроизведения (обход Autoplay Policy)
      audioEl.play().catch(err => {
        console.warn('Автовоспроизведение заблокировано браузером. Требуется клик по странице.', err);
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          target: targetUserId,
          signal: { candidate: event.candidate }
        });
      }
    };

    this.peerConnections[targetUserId] = pc;
    return pc;
  },

  async handleSignal(fromUserId, signal, socket) {
    let pc = this.peerConnections[fromUserId];
    if (!pc) {
      pc = await this.createPeerConnection(fromUserId, socket);
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      // Применяем накопленные ICE-кандидаты после установки RemoteDescription
      if (this.iceCandidateQueues[fromUserId]) {
        while (this.iceCandidateQueues[fromUserId].length > 0) {
          const candidate = this.iceCandidateQueues[fromUserId].shift();
          await pc.addIceCandidate(candidate);
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
        await pc.addIceCandidate(candidate);
      } else {
        // Сохраняем кандидат в очередь, если RemoteDescription еще не установлен
        if (!this.iceCandidateQueues[fromUserId]) {
          this.iceCandidateQueues[fromUserId] = [];
        }
        this.iceCandidateQueues[fromUserId].push(candidate);
      }
    }
  },

  async connectToPeer(targetUserId, socket) {
    const pc = await this.createPeerConnection(targetUserId, socket);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', {
      target: targetUserId,
      signal: { sdp: pc.localDescription }
    });
  },

  disconnect() {
    Object.values(this.peerConnections).forEach(pc => pc.close());
    this.peerConnections = {};
    this.iceCandidateQueues = {};

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
};