const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

async function loadIceServers(token) {
  try {
    const res = await fetch('/api/ice', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = await res.json();
    return Array.isArray(data.iceServers) && data.iceServers.length ? data.iceServers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

function avatarEl(name, color, className = '') {
  const node = el('div', `avatar ${className}`.trim(), initials(name));
  node.style.background = color;
  return node;
}

function makeTile({ name, color, isSelf }) {
  const root = el('div', `voice-tile${isSelf ? ' self' : ''}`);
  const video = el('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isSelf) video.muted = true;

  const avatar = avatarEl(name, color, 'tile-avatar');
  const label = el('div', 'tile-label');
  const nameEl = el('span', 'name', isSelf ? `${name} (you)` : name);
  const muteEl = el('span', 'tile-muted', 'MUTED');
  muteEl.hidden = true;
  label.append(nameEl, muteEl);

  const statusEl = el('div', 'tile-status');
  statusEl.hidden = true;

  const shareEl = el('div', 'tile-sharing', 'Sharing screen');
  shareEl.hidden = true;

  root.append(video, avatar, label, statusEl, shareEl);

  return {
    root,
    setStream(stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    },
    setState({ muted, camera, sharing }) {
      muteEl.hidden = !muted;
      const hasVideo = Boolean(video.srcObject);
      root.classList.toggle('cam-on', Boolean(camera && hasVideo));
      root.classList.toggle('sharing', Boolean(sharing && hasVideo));
      shareEl.hidden = !sharing;
    },
    setStatus(text) {
      statusEl.textContent = text;
      statusEl.hidden = !text;
    },
  };
}

export class Voice {
  constructor({ socket, selfUser, toast, onJoin, onLeave }) {
    this.socket = socket;
    this.selfUser = selfUser;
    this.toast = toast;
    this.onJoin = onJoin;
    this.onLeave = onLeave;

    this.channelId = null;
    this.channelName = '';
    this.localStream = null;
    this.screenStream = null;
    this.cameraTrack = null;
    this.sharing = false;
    this.selfMuted = false;
    this.selfCam = false;
    this.connecting = false;

    this.participants = new Map();
    this.selfTile = null;
    this.destroyed = false;
    this.iceReady = loadIceServers(socket.auth?.token);

    this.tilesEl = $('voice-tiles');
    this.statusEl = $('voice-status');
    this.titleEl = $('voice-title');
    this.micBtn = $('voice-mic');
    this.camBtn = $('voice-cam');
    this.screenBtn = $('voice-screen');
    this.leaveBtn = $('voice-leave');
    this.dockEl = $('voice-dock');
    this.dockName = $('voice-dock-name');
    this.dockSub = $('voice-dock-sub');
    this.dockMic = $('dock-mic');
    this.dockCam = $('dock-cam');
    this.dockScreen = $('dock-screen');
    this.dockLeave = $('dock-leave');

    this.micBtn.addEventListener('click', () => this.toggleMute());
    this.dockMic.addEventListener('click', () => this.toggleMute());
    this.camBtn.addEventListener('click', () => this.toggleCamera());
    this.dockCam.addEventListener('click', () => this.toggleCamera());
    this.screenBtn.addEventListener('click', () => this.toggleScreen());
    this.dockScreen.addEventListener('click', () => this.toggleScreen());
    this.leaveBtn.addEventListener('click', () => this.leave());
    this.dockLeave.addEventListener('click', () => this.leave());

    this.bindSocket();
  }

  bindSocket() {
    const socket = this.socket;

    socket.on('voice:peer-joined', ({ peer }) => {
      this.addParticipant(peer);
      this.refreshVoiceMeta();
    });

    socket.on('voice:peer-left', ({ socketId }) => {
      this.removeParticipant(socketId);
      this.refreshVoiceMeta();
    });

    socket.on('voice:peer-state', ({ userId, muted, camera, sharing }) => {
      for (const p of this.participants.values()) {
        if (p.info.userId === userId) {
          p.info.muted = muted;
          p.info.camera = camera;
          p.info.sharing = Boolean(sharing);
          p.tile.setState({ muted, camera, sharing: p.info.sharing });
        }
      }
      this.refreshVoiceMeta();
    });

    socket.on('voice:signal', (payload) => {
      this.handleSignal(payload).catch((err) => console.warn('voice signal error', err));
    });

    socket.on('disconnect', () => {
      if (!this.channelId) return;
      this.setStatus('Reconnecting…', 'bad');
      for (const p of this.participants.values()) p.tile.setStatus('Reconnecting…');
    });

    socket.on('connect', async () => {
      if (!this.channelId || this.destroyed) return;
      await this.rejoin();
    });
  }

  get active() {
    return Boolean(this.channelId);
  }

  async acquireMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.toast('Voice chat requires localhost or HTTPS');
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.toast('Camera unavailable — joining with audio only');
        return audioOnly;
      } catch {
        this.toast('No microphone or camera access — joining listen-only');
        return null;
      }
    }
  }

  async join(channel) {
    if (this.channelId === channel.id) return true;
    if (this.channelId) this.cleanup({ silent: true, keepView: true });

    this.channelId = channel.id;
    this.channelName = channel.name;
    this.titleEl.textContent = `Voice · ${channel.name}`;
    this.statusEl.textContent = 'Connecting…';
    this.statusEl.className = 'connection-status';
    this.tilesEl.replaceChildren();
    this.selfTile = null;

    if (!this.localStream || this.localStream.getTracks().every((t) => t.readyState === 'ended')) {
      this.localStream = await this.acquireMedia();
    }
    const audioTrack = this.localStream?.getAudioTracks()[0];
    const videoTrack = this.localStream?.getVideoTracks()[0];
    this.selfMuted = !audioTrack;
    this.selfCam = Boolean(videoTrack);

    await this.iceReady;
    const ok = await this.sendJoin();
    if (!ok) {
      this.cleanup({ silent: true, keepView: true });
      return false;
    }

    this.dockEl.hidden = false;
    this.dockName.textContent = this.channelName;
    this.updateControls();
    this.refreshVoiceMeta();
    this.onJoin?.(channel);
    return true;
  }

  sendJoin() {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.toast('Voice connection timed out');
        resolve(false);
      }, 10000);

      this.socket.emit(
        'voice:join',
        { channelId: this.channelId, muted: this.selfMuted, camera: this.selfCam },
        (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!res?.ok) {
            this.toast(res?.error || 'Could not join the voice channel');
            return resolve(false);
          }
          this.statusEl.className = 'connection-status';
          this.renderSelfTile();
          for (const peer of res.peers) {
            this.addParticipant(peer);
            this.initiate(peer.socketId).catch((err) => console.warn('offer failed', err));
          }
          this.refreshVoiceMeta();
          resolve(true);
        },
      );
    });
  }

  renderSelfTile() {
    if (!this.selfTile) {
      this.selfTile = makeTile({
        name: this.selfUser.username,
        color: this.selfUser.color,
        isSelf: true,
      });
      this.tilesEl.prepend(this.selfTile.root);
    }
    if (this.localStream) this.selfTile.setStream(this.localStream);
    this.selfTile.setState({ muted: this.selfMuted, camera: this.selfCam, sharing: this.sharing });
  }

  addParticipant(peer) {
    const existing = this.participants.get(peer.socketId);
    if (existing) {
      existing.info = { ...existing.info, ...peer };
      existing.tile.setState({ muted: peer.muted, camera: peer.camera, sharing: peer.sharing });
      return existing;
    }
    const tile = makeTile({ name: peer.username, color: peer.color, isSelf: false });
    tile.setState({ muted: peer.muted, camera: peer.camera, sharing: peer.sharing });
    tile.setStatus('Connecting…');
    this.tilesEl.append(tile.root);
    const participant = {
      info: { ...peer },
      tile,
      pc: null,
      pending: [],
    };
    this.participants.set(peer.socketId, participant);
    return participant;
  }

  removeParticipant(socketId) {
    const participant = this.participants.get(socketId);
    if (!participant) return;
    participant.pc?.close();
    participant.tile.root.remove();
    this.participants.delete(socketId);
  }

  outboundStream() {
    return this.sharing && this.screenStream ? this.screenStream : this.localStream;
  }

  async ensurePeer(participant) {
    if (participant.pc) return participant.pc;
    const iceServers = (await this.iceReady) ?? DEFAULT_ICE_SERVERS;
    const pc = new RTCPeerConnection({ iceServers });

    const outbound = this.outboundStream();
    if (outbound) {
      for (const track of outbound.getTracks()) {
        pc.addTrack(track, outbound);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const c = event.candidate;
      this.signal(participant.info.socketId, {
        type: 'candidate',
        candidate: {
          candidate: c.candidate,
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
        },
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      participant.tile.setStream(stream);
      participant.tile.setState({
        muted: participant.info.muted,
        camera: participant.info.camera,
        sharing: participant.info.sharing,
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        participant.tile.setStatus('');
        this.setStatus('Connected', 'ok');
      } else if (state === 'failed') {
        participant.tile.setStatus('Connection failed');
        this.setStatus('Connection problem', 'bad');
      }
    };

    participant.pc = pc;
    return pc;
  }

  async initiate(socketId) {
    const participant = this.participants.get(socketId);
    if (!participant || participant.pc) return;
    const pc = await this.ensurePeer(participant);
    const outbound = this.outboundStream();
    if (!outbound?.getAudioTracks().length) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    if (!outbound?.getVideoTracks().length) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal(socketId, {
      type: 'offer',
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
    });
  }

  signal(to, data) {
    this.socket.emit('voice:signal', { to, data });
  }

  async handleSignal({ from, userId, username, color, data }) {
    if (!this.channelId || !data) return;
    const participant =
      this.participants.get(from) ??
      this.addParticipant({ socketId: from, userId, username, color, muted: false, camera: false });
    const pc = await this.ensurePeer(participant);

    if (data.type === 'offer') {
      await pc.setRemoteDescription(data.sdp);
      await this.flushCandidates(participant);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal(from, {
        type: 'answer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
      this.refreshVoiceMeta();
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(data.sdp);
      await this.flushCandidates(participant);
    } else if (data.type === 'candidate' && data.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        participant.pending.push(data.candidate);
      }
    } else if (data.type === 'negotiate') {
      await pc.setRemoteDescription(data.sdp);
      await this.flushCandidates(participant);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal(from, {
        type: 'negotiate-answer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
    } else if (data.type === 'negotiate-answer') {
      await pc.setRemoteDescription(data.sdp);
      await this.flushCandidates(participant);
    }
  }

  async flushCandidates(participant) {
    const queued = participant.pending;
    participant.pending = [];
    for (const candidate of queued) {
      await participant.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  async rejoin() {
    if (this.connecting) return;
    this.connecting = true;
    try {
      this.setStatus('Reconnecting…', 'bad');
      for (const p of [...this.participants.values()]) {
        p.pc?.close();
        p.tile.root.remove();
      }
      this.participants.clear();

      if (!this.localStream || this.localStream.getTracks().every((t) => t.readyState === 'ended')) {
        this.localStream = await this.acquireMedia();
        const audioTrack = this.localStream?.getAudioTracks()[0];
        this.selfMuted = !audioTrack;
        this.selfCam = Boolean(this.localStream?.getVideoTracks()[0]);
      }

      const ok = await this.sendJoin();
      if (!ok) this.cleanup({ silent: true, keepView: true });
      this.updateControls();
      this.refreshVoiceMeta();
    } finally {
      this.connecting = false;
    }
  }

  toggleMute() {
    if (!this.channelId) return;
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return this.toast('No microphone is available');
    track.enabled = !track.enabled;
    this.selfMuted = !track.enabled;
    this.socket.emit('voice:state', {
      muted: this.selfMuted,
      camera: this.selfCam,
      sharing: this.sharing,
    });
    this.updateControls();
    this.selfTile?.setState({ muted: this.selfMuted, camera: this.selfCam, sharing: this.sharing });
  }

  toggleCamera() {
    if (!this.channelId) return;
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return this.toast('No camera is available');
    track.enabled = !track.enabled;
    this.selfCam = track.enabled;
    this.socket.emit('voice:state', {
      muted: this.selfMuted,
      camera: this.selfCam,
      sharing: this.sharing,
    });
    this.updateControls();
    this.selfTile?.setState({ muted: this.selfMuted, camera: this.selfCam, sharing: this.sharing });
  }

  toggleScreen() {
    if (!this.channelId) return;
    if (this.sharing) return this.stopScreen();
    return this.startScreen();
  }

  async renegotiate(participant) {
    const pc = participant.pc;
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal(participant.info.socketId, {
      type: 'negotiate',
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
    });
  }

  async startScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return this.toast('Screen sharing is not supported in this browser');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        audio: false,
      });
    } catch {
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return this.toast('No screen was selected');
    }

    this.screenStream = stream;
    this.sharing = true;
    this.cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    track.addEventListener('ended', () => this.stopScreen());

    for (const participant of [...this.participants.values()]) {
      const pc = participant.pc;
      if (!pc) continue;
      const transceiver = pc
        .getTransceivers()
        .find((t) => t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video');
      if (!transceiver) {
        pc.addTrack(track, stream);
        await this.renegotiate(participant).catch(() => {});
        continue;
      }
      await transceiver.sender.replaceTrack(track).catch(() => {});
      if (transceiver.direction === 'recvonly') {
        transceiver.direction = 'sendonly';
        await this.renegotiate(participant).catch(() => {});
      }
    }

    if (this.selfTile) {
      this.selfTile.setStream(stream);
      this.selfTile.setState({ muted: this.selfMuted, camera: true, sharing: true });
    }
    this.socket.emit('voice:state', { muted: this.selfMuted, camera: this.selfCam, sharing: true });
    this.updateControls();
  }

  async stopScreen() {
    if (!this.sharing && !this.screenStream) return;
    this.sharing = false;
    const camera =
      this.cameraTrack && this.cameraTrack.readyState === 'live'
        ? this.cameraTrack
        : this.localStream?.getVideoTracks()[0] ?? null;

    for (const participant of [...this.participants.values()]) {
      const pc = participant.pc;
      if (!pc) continue;
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(camera).catch(() => {});
    }

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) track.stop();
      this.screenStream = null;
    }
    this.cameraTrack = null;

    if (this.selfTile) {
      if (this.localStream) this.selfTile.setStream(this.localStream);
      this.selfTile.setState({
        muted: this.selfMuted,
        camera: Boolean(camera && this.selfCam),
        sharing: false,
      });
    }
    if (this.channelId) {
      this.socket.emit('voice:state', {
        muted: this.selfMuted,
        camera: this.selfCam,
        sharing: false,
      });
    }
    this.updateControls();
  }

  updateControls() {
    this.micBtn.textContent = this.selfMuted ? 'Unmute' : 'Mute';
    this.camBtn.textContent = this.selfCam ? 'Camera on' : 'Camera off';
    this.micBtn.classList.toggle('off', this.selfMuted);
    this.camBtn.classList.toggle('off', !this.selfCam);
    this.screenBtn.textContent = this.sharing ? 'Stop sharing' : 'Share screen';
    this.screenBtn.classList.toggle('off', this.sharing);
    this.dockMic.textContent = this.selfMuted ? 'Unmute' : 'Mute';
    this.dockCam.textContent = this.selfCam ? 'Cam on' : 'Cam off';
    this.dockScreen.textContent = this.sharing ? 'Stop' : 'Screen';
    this.dockMic.classList.toggle('off', this.selfMuted);
    this.dockCam.classList.toggle('off', !this.selfCam);
    this.dockScreen.classList.toggle('off', this.sharing);
  }

  setStatus(text, tone = '') {
    if (!this.channelId) return;
    this.statusEl.textContent = text;
    this.statusEl.className = `connection-status ${tone}`.trim();
  }

  refreshVoiceMeta() {
    if (!this.channelId) return;
    const count = 1 + this.participants.size;
    this.dockSub.textContent = count > 1 ? `${count} connected` : 'Waiting for others…';
    if (!this.statusEl.classList.contains('bad')) {
      this.setStatus(count > 1 ? `${count} connected` : 'Waiting for others…', count > 1 ? 'ok' : '');
    }
  }

  leave() {
    this.cleanup({ silent: false });
  }

  cleanup({ silent = false, keepView = false } = {}) {
    if (!this.channelId) return;
    if (!silent && this.socket.connected) this.socket.emit('voice:leave');

    for (const p of this.participants.values()) p.pc?.close();
    this.participants.clear();
    this.tilesEl.replaceChildren();
    this.selfTile = null;

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) track.stop();
      this.screenStream = null;
    }
    this.sharing = false;
    this.cameraTrack = null;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }

    this.channelId = null;
    this.channelName = '';
    this.dockEl.hidden = true;
    this.selfMuted = false;
    this.selfCam = false;
    if (!keepView) this.onLeave?.();
  }

  destroy() {
    this.destroyed = true;
    this.cleanup({ silent: true });
  }
}
