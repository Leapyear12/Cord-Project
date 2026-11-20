import { Voice } from './voice.js';
import { Project, renderDiff } from './project.js';

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('cord_token'),
  user: null,
  authMode: 'login',
  servers: [],
  serverId: null,
  server: null,
  channelId: null,
  messages: [],
  hasMore: false,
  loadingOlder: false,
  presence: new Map(),
  unread: new Set(),
  typing: new Map(),
  socket: null,
  view: 'empty',
  channelModalType: 'text',
  reconnected: false,
  refreshingServers: false,
  merges: new Map(),
  thread: { rootId: null, root: null, replies: [] },
  pendingFiles: [],
};

let voice = null;
let project = null;
let typingCooldown = 0;

/* --------------------------------- helpers -------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return String(name).trim().slice(0, 2).toUpperCase();
}

function serverInitials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return initials(name);
}

function avatarEl(name, color, className = '') {
  const node = el('div', `avatar ${className}`.trim(), initials(name));
  node.style.background = color;
  return node;
}

function toast(message) {
  const node = el('div', 'toast', message);
  $('toast-container').append(node);
  setTimeout(() => node.remove(), 3400);
}

function formError(scope, message) {
  const target = scope?.querySelector?.('.form-error');
  if (!target) return;
  target.textContent = message || '';
  target.hidden = !message;
}

async function api(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function formatTime(ts) {
  return timeFmt.format(new Date(ts));
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return longDateFmt.format(date);
}

function saveLast(serverId, channelId) {
  try {
    localStorage.setItem('cord_last', JSON.stringify({ serverId, channelId }));
  } catch {}
}

function readLast() {
  try {
    return JSON.parse(localStorage.getItem('cord_last') || 'null');
  } catch {
    return null;
  }
}

function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    let url = match[0];
    let trailing = '';
    while (/[.,!?;:)\]]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    if (match.index > last) frag.append(text.slice(last, match.index));
    if (url) {
      const a = el('a', '', url);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      frag.append(a);
    }
    if (trailing) frag.append(trailing);
    last = match.index + match[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* ------------------------------ files/threads ----------------------------- */

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TEXT_FILE_RE = /\.(md|txt|log|js|mjs|cjs|ts|json|css|html?|xml|csv|py|c|h|cpp|hpp|java|kt|go|rs|rb|php|sql|ya?ml|sh|ini|toml)$/i;
const isTextAttachment = (attachment) =>
  /^text\//.test(attachment.mime || '') ||
  /json|javascript|xml|yaml|sql/.test(attachment.mime || '') ||
  TEXT_FILE_RE.test(attachment.name || '');

function fileUrl(attachment, inline = false) {
  const token = encodeURIComponent(state.token || '');
  return `/api/files/${attachment.id}?token=${token}${inline ? '&inline=1' : ''}`;
}

function extLabel(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name || '');
  return match ? match[1].toUpperCase() : 'FILE';
}

function attachmentNode(attachment) {
  const wrap = el('div', 'msg-attachments');
  if ((attachment.mime || '').startsWith('image/')) {
    const img = el('img', 'msg-image');
    img.src = fileUrl(attachment, true);
    img.alt = attachment.name;
    img.loading = 'lazy';
    wrap.append(img);
  } else if ((attachment.mime || '').startsWith('video/')) {
    const video = el('video', 'msg-media');
    video.src = fileUrl(attachment, true);
    video.controls = true;
    wrap.append(video);
  } else if ((attachment.mime || '').startsWith('audio/')) {
    const audio = el('audio', 'msg-media');
    audio.src = fileUrl(attachment, true);
    audio.controls = true;
    wrap.append(audio);
  } else {
    const link = el('a', 'msg-attachment');
    link.href = fileUrl(attachment);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(
      el('span', 'ext', extLabel(attachment.name)),
      el('span', 'file-name', attachment.name),
      el('span', 'file-size', formatBytes(attachment.size)),
    );
    if (isTextAttachment(attachment)) {
      const open = el('button', 'open-editor', 'Open in editor');
      open.type = 'button';
      open.dataset.attachment = String(attachment.id);
      link.append(open);
    }
    wrap.append(link);
  }
  return wrap;
}

function mergeCard(merge) {
  const card = el('div', 'merge-card');
  const approveCount = merge.votes.filter((v) => v.vote === 'approve').length;
  const head = el('div', 'merge-card-head');
  head.append(el('span', '', `${merge.proposer.username} · ${merge.docName}`));
  const status = el('span', `merge-status ${merge.status}`, merge.status);
  if (merge.status === 'pending') status.textContent = `${approveCount}/${merge.voters.length} approved`;
  head.append(status);
  card.append(head);

  const votes = el('div', 'merge-card-votes');
  if (!merge.voters.length) {
    votes.append(el('span', '', 'No other members were online, so the changes were applied instantly.'));
  } else {
    votes.append(el('span', '', 'Reviewers:'));
    for (const voterId of merge.voters) {
      const vote = merge.votes.find((v) => v.userId === voterId);
      const chip = el('span', `vote-chip ${vote ? vote.vote : 'pending'}`);
      chip.textContent = vote ? (vote.vote === 'approve' ? '✓' : '✕') : '…';
      chip.title = vote ? `${vote.username} ${vote.vote}d` : 'waiting for a vote';
      votes.append(chip);
    }
  }
  card.append(votes);

  const actions = el('div', 'merge-card-actions');
  const openBtn = el('button', 'btn ghost small', 'Open file');
  openBtn.type = 'button';
  openBtn.addEventListener('click', () => project?.openDoc(merge.docId));
  actions.append(openBtn);

  if (merge.status === 'pending') {
    let diffBox = null;
    const toggle = el('button', 'btn ghost small', 'View changes');
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      if (diffBox) {
        diffBox.remove();
        diffBox = null;
        toggle.textContent = 'View changes';
        return;
      }
      toggle.disabled = true;
      diffBox = el('div', 'merge-card-diff', 'Loading file…');
      card.append(diffBox);
      try {
        const { doc } = await api(`/docs/${merge.docId}`);
        diffBox.replaceChildren(renderDiff(doc.content, merge.content));
        toggle.textContent = 'Hide changes';
      } catch (err) {
        diffBox.replaceChildren(el('div', 'diff-more', err.message || 'Could not load the file'));
      }
      toggle.disabled = false;
    });
    actions.append(toggle);

    const myVote = merge.votes.find((v) => v.userId === state.user.id);
    if (merge.voters.includes(state.user.id) && !myVote) {
      const approve = el('button', 'btn small', 'Approve');
      approve.type = 'button';
      approve.addEventListener('click', () => project?.vote(merge.id, 'approve'));
      const decline = el('button', 'btn small danger', 'Decline');
      decline.type = 'button';
      decline.addEventListener('click', () => project?.vote(merge.id, 'reject'));
      actions.append(approve, decline);
    }
    if (state.server?.ownerId === state.user.id) {
      const mergeNow = el('button', 'btn small primary', 'Merge now');
      mergeNow.type = 'button';
      mergeNow.title = 'Owner override';
      mergeNow.addEventListener('click', () => project?.decide(merge.id, true));
      actions.append(mergeNow);
    }
  }
  card.append(actions);
  return card;
}

async function loadMerges(serverId) {
  try {
    const { merges } = await api(`/servers/${serverId}/merges?status=all`);
    for (const merge of merges) state.merges.set(merge.id, merge);
    refreshMergeMessages();
  } catch {}
}

function refreshMergeMessages() {
  for (const message of state.messages) {
    if (!message.mergeId || !state.merges.has(message.mergeId)) continue;
    const node = messagesEl.querySelector(`.msg[data-id="${message.id}"]`);
    if (node) node.replaceWith(createMessageNode(message, node.classList.contains('grouped')));
  }
  if (state.thread.root) renderThreadRoot();
  if (state.thread.rootId) renderThreadReplies();
}

function renderPendingFiles() {
  const wrap = $('pending-files');
  wrap.replaceChildren();
  wrap.hidden = !state.pendingFiles.length;
  state.pendingFiles.forEach((entry, index) => {
    const chip = el('div', `file-chip${entry.uploading ? ' uploading' : ''}`);
    chip.append(
      el('span', 'file-name', entry.name),
      el('span', 'file-size', entry.uploading ? 'Uploading…' : formatBytes(entry.size)),
    );
    if (!entry.uploading) {
      const remove = el('button', '', '×');
      remove.type = 'button';
      remove.title = 'Remove';
      remove.addEventListener('click', () => {
        state.pendingFiles.splice(index, 1);
        renderPendingFiles();
      });
      chip.append(remove);
    }
    wrap.append(chip);
  });
}

async function uploadFile(file) {
  if (!state.channelId) return toast('Open a text channel first');
  if (file.size > 10 * 1024 * 1024) return toast(`${file.name} is larger than 10 MB`);
  const entry = { id: null, name: file.name, size: file.size, uploading: true, attachment: null };
  state.pendingFiles.push(entry);
  renderPendingFiles();
  try {
    const res = await fetch(`/api/channels/${state.channelId}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    entry.id = data.attachment.id;
    entry.attachment = data.attachment;
  } catch (err) {
    state.pendingFiles = state.pendingFiles.filter((f) => f !== entry);
    toast(err.message);
  } finally {
    entry.uploading = false;
    renderPendingFiles();
  }
}

async function openAttachmentInEditor(attachment) {
  try {
    const { doc } = await api(`/files/${attachment.id}/open`, { method: 'POST' });
    await project.loadDocs();
    await project.openDoc(doc.id);
  } catch (err) {
    toast(err.message);
  }
}

async function saveMessageToProject(message) {
  if (!state.serverId || !project) return;
  const raw = (message.content || 'message').split('\n')[0].trim();
  const base = raw.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'message';
  const content = message.content || (message.attachments || []).map((a) => a.name).join('\n');
  try {
    const { doc } = await api(`/servers/${state.serverId}/docs`, {
      method: 'POST',
      body: JSON.stringify({ name: `${base}.md`, content }),
    });
    await project.loadDocs();
    await project.openDoc(doc.id);
    toast(`Saved to ${doc.name}`);
  } catch (err) {
    toast(err.message);
  }
}

function openThread(message) {
  if (!state.channelId || message.threadId) return;
  state.thread.rootId = message.id;
  state.thread.root = message;
  state.thread.replies = [];
  $('thread-panel').hidden = false;
  syncPaneHandles();
  $('thread-replies').replaceChildren(el('div', 'thread-placeholder', 'Loading replies…'));
  renderThreadRoot();
  $('thread-input').focus();
  api(`/channels/${state.channelId}/threads/${message.id}`)
    .then((data) => {
      if (state.thread.rootId !== message.id) return;
      state.thread.root = data.parent ?? message;
      state.thread.replies = data.replies;
      renderThreadRoot();
      renderThreadReplies(true);
      const current = state.messages.find((m) => m.id === message.id);
      if (current && current.replyCount !== state.thread.root?.replyCount) {
        current.replyCount = state.thread.root?.replyCount ?? 0;
        updateMessageNode(current, state.channelId);
      }
    })
    .catch((err) => {
      toast(err.message);
      $('thread-replies').replaceChildren(el('div', 'thread-placeholder', 'Could not load the thread.'));
    });
}

function closeThread() {
  state.thread = { rootId: null, root: null, replies: [] };
  $('thread-panel').hidden = true;
  syncPaneHandles();
  $('thread-root').replaceChildren();
  $('thread-replies').replaceChildren();
  $('thread-input').value = '';
}

function renderThreadRoot() {
  const holder = $('thread-root');
  holder.replaceChildren();
  if (state.thread.root) holder.append(createMessageNode(state.thread.root, false));
}

function renderThreadReplies(scroll = false) {
  const holder = $('thread-replies');
  holder.replaceChildren();
  if (!state.thread.replies.length) {
    holder.append(el('div', 'thread-placeholder', 'No replies yet. Start the conversation.'));
    return;
  }
  for (const reply of state.thread.replies) holder.append(createMessageNode(reply, false));
  if (scroll) holder.scrollTop = holder.scrollHeight;
}

function onThreadSubmit(event) {
  event.preventDefault();
  if (!state.thread.rootId || !state.channelId) return;
  const input = $('thread-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  state.socket.emit(
    'message:send',
    { channelId: state.channelId, content, threadId: state.thread.rootId },
    (res) => {
      if (!res?.ok) {
        toast(res?.error || 'Could not reply');
        if (!input.value) input.value = content;
      }
    },
  );
}

/* ----------------------------------- auth ---------------------------------- */

function setAuthMode(mode) {
  state.authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
  $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  formError($('auth-form'), '');
}

function showAuthError(message) {
  formError($('auth-form'), message);
}

function showAuth() {
  $('app').hidden = true;
  $('auth').hidden = false;
  document.title = 'Chatterbox';
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  if (!username || !password) return showAuthError('Enter a username and password');

  const button = $('auth-submit');
  button.disabled = true;
  try {
    const path = state.authMode === 'login' ? '/login' : '/register';
    const data = await api(path, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('cord_token', data.token);
    $('auth-password').value = '';
    formError($('auth-form'), '');
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  if (!window.confirm('Log out of Chatterbox?')) return;
  try {
    await api('/logout', { method: 'POST' });
  } catch {}
  localStorage.removeItem('cord_token');
  localStorage.removeItem('cord_last');
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
  }
  location.reload();
}

/* -------------------------------- app boot -------------------------------- */

async function enterApp() {
  $('auth').hidden = true;
  $('app').hidden = false;
  renderMe();
  connectSocket();
  await refreshServers();

  const last = readLast();
  if (last?.serverId && state.servers.some((s) => s.id === last.serverId)) {
    await openServer(last.serverId, last.channelId);
  } else if (state.servers.length) {
    await openServer(state.servers[0].id);
  } else {
    showNoServer();
  }
}

function renderMe() {
  const user = state.user;
  const meAvatar = $('me-avatar');
  meAvatar.style.background = user.color;
  meAvatar.textContent = initials(user.username);
  $('me-name').textContent = user.username;
  const railUser = $('rail-user');
  railUser.classList.add('avatar');
  railUser.style.background = user.color;
  railUser.textContent = initials(user.username);
}

function connectSocket() {
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
  }
  const socket = io({ auth: { token: state.token }, transports: ['websocket'] });
  state.socket = socket;
  voice = new Voice({
    socket,
    selfUser: state.user,
    toast,
    onJoin: () => showVoiceView(),
    onLeave: () => {
      if (state.channelId) showTextView();
      else showEmpty();
      renderSidebar();
    },
  });

  project = new Project({
    socket,
    merges: state.merges,
    toast,
    getUser: () => state.user,
    getServer: () => state.server,
    getServerId: () => state.serverId,
    getChannelId: () => state.channelId,
    onShow: () => showProjectView(),
    onHide: () => {
      if (state.channelId) showTextView();
      else showEmpty();
    },
  });
  if (state.serverId) project.setServer(state.serverId);

  socket.on('connect_error', (err) => {
    if (err?.message === 'unauthorized') {
      toast('Session expired — please log in again');
      setTimeout(() => {
        localStorage.removeItem('cord_token');
        location.reload();
      }, 500);
      return;
    }
    toast('Connection issue — retrying');
  });

  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') toast('Connection lost — reconnecting…');
  });

  socket.on('connect', async () => {
    if (!state.reconnected) {
      state.reconnected = true;
      return;
    }
    toast('Reconnected');
    await refreshServers();
    if (!state.serverId) return;
    try {
      const { server } = await api(`/servers/${state.serverId}`);
      state.server = server;
      state.presence = new Map(server.members.map((m) => [m.id, m.online]));
      renderMembers();
      renderSidebar();
    } catch {}
  });

  socket.on('message:new', ({ message, channelId }) => {
    if (!state.server) return;
    const channel = state.server.channels.find((c) => c.id === channelId);
    if (!channel || channel.type !== 'text') return;
    if (message.threadId) return;
    if (channelId === state.channelId) {
      appendMessage(message);
    } else {
      state.unread.add(channelId);
      renderSidebar();
      updateTitle();
    }
  });

  socket.on('message:updated', ({ message, channelId }) => {
    updateMessageNode(message, channelId);
  });

  socket.on('message:deleted', ({ id, channelId }) => {
    if (channelId !== state.channelId) return;
    state.messages = state.messages.filter((m) => m.id !== id);
    messagesEl.querySelector(`.msg[data-id="${id}"]`)?.remove();
    if (!state.thread.rootId) return;
    if (state.thread.rootId === id) {
      closeThread();
      return;
    }
    const before = state.thread.replies.length;
    state.thread.replies = state.thread.replies.filter((r) => r.id !== id);
    if (before !== state.thread.replies.length) renderThreadReplies();
  });

  socket.on('thread:reply', ({ channelId, rootId, message, parent }) => {
    if (channelId !== state.channelId) return;
    if (parent) updateMessageNode(parent, channelId);
    if (state.thread.rootId !== rootId) return;
    state.thread.root = parent ?? state.thread.root;
    if (!state.thread.replies.some((r) => r.id === message.id)) {
      state.thread.replies.push(message);
    }
    renderThreadRoot();
    renderThreadReplies(true);
  });

  socket.on('merge:new', ({ merge }) => {
    state.merges.set(merge.id, merge);
    refreshMergeMessages();
    project?.renderMerges();
  });

  socket.on('merge:updated', ({ merge }) => {
    state.merges.set(merge.id, merge);
    refreshMergeMessages();
    project?.renderMerges();
  });

  socket.on('typing', (payload) => {
    if (!state.server?.channels.some((c) => c.id === payload.channelId && c.type === 'text')) return;
    handleTyping(payload);
  });

  socket.on('presence:update', ({ userId, online }) => {
    state.presence.set(userId, online);
    if (state.server?.members.some((m) => m.id === userId)) renderMembers();
  });

  socket.on('member:joined', ({ serverId, member }) => {
    if (!state.server || serverId !== state.server.id) return;
    if (state.server.members.some((m) => m.id === member.id)) return;
    state.server.members.push(member);
    state.presence.set(member.id, true);
    renderMembers();
    if (member.id !== state.user.id) toast(`${member.username} joined the server`);
  });

  socket.on('channel:created', ({ channel }) => {
    if (!state.server || channel.serverId !== state.server.id) return;
    if (!state.server.channels.some((c) => c.id === channel.id)) {
      state.server.channels.push(channel);
    }
    renderSidebar();
  });

  socket.on('server:joined', () => {
    refreshServers();
  });

  socket.on('voice:occupants', ({ channelId, occupants }) => {
    const channel = state.server?.channels.find((c) => c.id === channelId);
    if (!channel) return;
    channel.occupants = occupants;
    renderSidebar();
  });
}

/* -------------------------------- servers --------------------------------- */

async function refreshServers() {
  if (state.refreshingServers) return;
  state.refreshingServers = true;
  try {
    const { servers } = await api('/servers');
    state.servers = servers;
    renderServers();
  } catch (err) {
    console.warn('Could not refresh servers', err);
  } finally {
    state.refreshingServers = false;
  }
}

function renderServers() {
  const rail = $('rail-servers');
  rail.replaceChildren();
  for (const server of state.servers) {
    const button = el('button', 'rail-btn', serverInitials(server.name));
    button.type = 'button';
    button.title = server.name;
    if (server.id === state.serverId) button.classList.add('active');
    button.addEventListener('click', () => openServer(server.id));
    rail.append(button);
  }
}

async function openServer(serverId, preferredChannelId = null) {
  let server;
  try {
    ({ server } = await api(`/servers/${serverId}`));
  } catch (err) {
    toast(err.message);
    await refreshServers();
    return;
  }

  state.serverId = serverId;
  state.server = server;
  state.presence = new Map(server.members.map((m) => [m.id, m.online]));

  project?.setServer(serverId);
  loadMerges(serverId);

  renderServers();
  renderSidebar();
  renderMembers();

  const textChannels = server.channels.filter((c) => c.type === 'text');
  const last = readLast();
  const wanted = preferredChannelId ?? (last?.serverId === serverId ? last.channelId : null);
  const target = textChannels.find((c) => c.id === wanted) ?? textChannels[0];

  if (target) {
    await openChannel(target.id);
  } else {
    state.channelId = null;
    showEmpty('No text channels', 'Create a text channel from the sidebar to start talking.');
  }
}

function showNoServer() {
  state.serverId = null;
  state.server = null;
  state.channelId = null;
  $('server-name').textContent = 'No server';
  renderServers();
  renderSidebar();
  renderMembers();
  showEmpty('No server selected', 'Create a server or join one with an invite code.');
}

async function openChannel(channelId) {
  const channel = state.server?.channels.find((c) => c.id === channelId);
  if (!channel || channel.type !== 'text') return;

  state.channelId = channel.id;
  state.unread.delete(channel.id);
  saveLast(state.serverId, channel.id);
  closeThread();
  state.pendingFiles = [];
  renderPendingFiles();

  $('channel-name').textContent = channel.name;
  $('message-input').placeholder = `Message #${channel.name}`;
  showTextView();
  renderSidebar();
  updateTitle();
  await loadMessages(channel.id);
}

function showTextView() {
  if (!state.channelId) return showEmpty();
  state.view = 'text';
  $('text-view').hidden = false;
  $('voice-view').hidden = true;
  $('project-view').hidden = true;
  $('empty-view').hidden = true;
  syncPaneHandles();
  renderTyping();
  renderSidebar();
  $('message-input').focus();
}

function showVoiceView() {
  if (!voice?.channelId) return;
  state.view = 'voice';
  $('voice-view').hidden = false;
  $('text-view').hidden = true;
  $('project-view').hidden = true;
  $('empty-view').hidden = true;
  syncPaneHandles();
  renderSidebar();
}

function showProjectView() {
  if (!state.server) return showEmpty();
  state.view = 'project';
  $('project-view').hidden = false;
  $('text-view').hidden = true;
  $('voice-view').hidden = true;
  $('empty-view').hidden = true;
  syncPaneHandles();
  renderSidebar();
}

function showEmpty(title = 'No server selected', text = 'Create a server or join one with an invite code.') {
  state.view = 'empty';
  $('text-view').hidden = true;
  $('voice-view').hidden = true;
  $('project-view').hidden = true;
  $('empty-view').hidden = false;
  $('empty-view').querySelector('h2').textContent = title;
  $('empty-view').querySelector('p').textContent = text;
  syncPaneHandles();
  renderSidebar();
}

function updateTitle() {
  document.title = state.unread.size ? `(${state.unread.size}) Chatterbox` : 'Chatterbox';
}

/* -------------------------------- sidebar --------------------------------- */

function renderSidebar() {
  const server = state.server;
  $('server-name').textContent = server ? server.name : 'No server';
  $('btn-invite').hidden = !server;
  $('btn-add-text').hidden = !server;
  $('btn-add-voice').hidden = !server;
  $('btn-project-new').hidden = !server;
  $('open-project').classList.toggle('active', Boolean(server) && state.view === 'project');

  const textList = $('text-channels');
  const voiceList = $('voice-channels');
  textList.replaceChildren();
  voiceList.replaceChildren();
  if (!server) return;

  for (const channel of server.channels.filter((c) => c.type === 'text')) {
    textList.append(channelListItem(channel));
  }

  for (const channel of server.channels.filter((c) => c.type === 'voice')) {
    voiceList.append(channelListItem(channel));
    if (channel.occupants?.length) {
      const holder = el('li');
      const list = el('ul', 'voice-occupants');
      for (const occupant of channel.occupants) {
        const row = el('li', 'voice-occupant');
        row.append(avatarEl(occupant.username, occupant.color));
        const isMe = occupant.userId === state.user.id;
        row.append(el('span', 'occ-name', isMe ? `${occupant.username} (you)` : occupant.username));
        if (occupant.muted) row.append(el('span', 'occ-muted', 'muted'));
        list.append(row);
      }
      holder.append(list);
      voiceList.append(holder);
    }
  }
}

function channelListItem(channel) {
  const li = el('li');
  const button = el('button', 'channel-row');
  button.type = 'button';

  const icon = el('span', 'channel-icon');
  icon.setAttribute('aria-hidden', 'true');
  if (channel.type === 'text') {
    icon.textContent = '#';
  } else {
    icon.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>';
  }

  const isActive =
    channel.type === 'text'
      ? state.view === 'text' && state.channelId === channel.id
      : voice?.channelId === channel.id;
  if (isActive) button.classList.add('active');

  button.append(icon, el('span', 'channel-label', channel.name));

  if (channel.type === 'text' && state.unread.has(channel.id)) {
    button.append(el('span', 'unread-dot'));
  }
  if (channel.type === 'voice' && channel.occupants?.length) {
    button.append(el('span', 'occupied-count', String(channel.occupants.length)));
  }

  button.addEventListener('click', () => {
    if (channel.type === 'text') {
      openChannel(channel.id);
    } else if (voice?.channelId === channel.id) {
      showVoiceView();
    } else {
      voice?.join(channel);
    }
  });

  li.append(button);
  return li;
}

/* -------------------------------- members --------------------------------- */

function renderMembers() {
  const list = $('member-list');
  list.replaceChildren();
  const members = state.server?.members ?? [];
  $('member-count').textContent = String(members.length);
  if (!members.length) return;

  const isOnline = (member) => state.presence.get(member.id) ?? Boolean(member.online);
  const byName = (a, b) => a.username.localeCompare(b.username);
  const groups = [
    ['Online', members.filter(isOnline).sort(byName)],
    ['Offline', members.filter((m) => !isOnline(m)).sort(byName)],
  ];

  for (const [label, group] of groups) {
    if (!group.length) continue;
    list.append(el('div', 'member-group-label', `${label} — ${group.length}`));
    for (const member of group) {
      const online = isOnline(member);
      const row = el('div', `member-row${online ? '' : ' offline'}`);
      const wrap = el('div', 'avatar-wrap');
      wrap.append(avatarEl(member.username, member.color));
      wrap.append(el('span', `status-dot${online ? ' online' : ''}`));
      row.append(wrap, el('span', 'member-name', member.username));
      if (member.isOwner) row.append(el('span', 'owner-tag', 'OWNER'));
      list.append(row);
    }
  }
}

/* -------------------------------- messages -------------------------------- */

const messagesEl = $('messages');

function dividerNode(ts) {
  const node = el('div', 'msg-divider');
  node.append(el('span', '', dayLabel(ts)));
  return node;
}

function sameAuthorWindow(prev, next) {
  return (
    Boolean(prev) &&
    prev.user.id === next.user.id &&
    next.createdAt - prev.createdAt < 5 * 60 * 1000
  );
}

function buildContentEl(message) {
  const content = el('div', 'msg-content');
  content.append(linkify(message.content));
  if (message.editedAt) content.append(el('span', 'edited', '(edited)'));
  return content;
}

function createMessageNode(message, grouped) {
  const node = el('div', `msg${grouped ? ' grouped' : ''}`);
  node.dataset.id = String(message.id);

  const gutter = el('div', 'msg-gutter');
  if (grouped) {
    gutter.append(el('span', 'msg-hover-time', formatTime(message.createdAt)));
  } else {
    gutter.append(avatarEl(message.user.username, message.user.color));
  }

  const body = el('div', 'msg-body');
  if (!grouped) {
    const head = el('div', 'msg-head');
    head.append(
      el('span', 'msg-author', message.user.username),
      el('span', 'msg-time', formatTime(message.createdAt)),
    );
    body.append(head);
  }
  if (message.content) body.append(buildContentEl(message));
  for (const attachment of message.attachments ?? []) body.append(attachmentNode(attachment));

  if (message.mergeId) {
    const merge = state.merges.get(message.mergeId);
    body.append(merge ? mergeCard(merge) : el('div', 'merge-card', 'Loading merge details…'));
  }

  if (!message.threadId && message.replyCount > 0) {
    const replyBtn = el(
      'button',
      'reply-count',
      `${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'} in thread`,
    );
    replyBtn.type = 'button';
    replyBtn.dataset.action = 'thread';
    body.append(replyBtn);
  }

  node.append(gutter, body);

  const actions = el('div', 'msg-actions');
  if (!message.threadId) {
    const thread = el('button', '', 'Thread');
    thread.type = 'button';
    thread.dataset.action = 'thread';
    actions.append(thread);
  }
  if (message.content.trim()) {
    const save = el('button', '', 'Save to Project');
    save.type = 'button';
    save.dataset.action = 'save';
    actions.append(save);
  }
  if (message.user.id === state.user.id) {
    const edit = el('button', '', 'Edit');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    const del = el('button', '', 'Delete');
    del.type = 'button';
    del.dataset.action = 'delete';
    actions.append(edit, del);
  }
  if (actions.childElementCount) node.append(actions);

  return node;
}

function renderAllMessages() {
  messagesEl.replaceChildren();
  if (state.hasMore) {
    const wrap = el('div', 'messages-top');
    const button = el('button', 'btn ghost small', 'Load older messages');
    button.type = 'button';
    button.id = 'load-older';
    button.addEventListener('click', loadOlderMessages);
    wrap.append(button);
    messagesEl.append(wrap);
  }

  if (!state.messages.length) {
    messagesEl.append(el('div', 'messages-empty', 'No messages yet. Say hello.'));
  } else {
    let prev = null;
    for (const message of state.messages) {
      const newDay = !prev || !sameDay(new Date(prev.createdAt), new Date(message.createdAt));
      if (newDay) messagesEl.append(dividerNode(message.createdAt));
      messagesEl.append(createMessageNode(message, !newDay && sameAuthorWindow(prev, message)));
      prev = message;
    }
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(message) {
  const wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
  const prev = state.messages[state.messages.length - 1];
  messagesEl.querySelector('.messages-empty')?.remove();

  let grouped = false;
  if (prev) {
    const newDay = !sameDay(new Date(prev.createdAt), new Date(message.createdAt));
    if (newDay) messagesEl.append(dividerNode(message.createdAt));
    else grouped = sameAuthorWindow(prev, message);
  }

  state.messages.push(message);
  messagesEl.append(createMessageNode(message, grouped));

  if (wasNearBottom || message.user.id === state.user.id) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function updateMessageNode(message, channelId) {
  if (channelId !== state.channelId) return;
  const index = state.messages.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    state.messages[index] = message;
    const oldNode = messagesEl.querySelector(`.msg[data-id="${message.id}"]`);
    if (oldNode) oldNode.replaceWith(createMessageNode(message, oldNode.classList.contains('grouped')));
  }
  if (state.thread.root?.id === message.id) {
    state.thread.root = message;
    renderThreadRoot();
  }
  const replyIndex = state.thread.replies.findIndex((r) => r.id === message.id);
  if (replyIndex !== -1) {
    state.thread.replies[replyIndex] = message;
    renderThreadReplies();
  }
}

async function loadMessages(channelId) {
  try {
    const data = await api(`/channels/${channelId}/messages?limit=50`);
    if (state.channelId !== channelId) return;
    state.messages = data.messages;
    state.hasMore = data.hasMore;
    renderAllMessages();
  } catch (err) {
    toast(err.message);
    messagesEl.replaceChildren(el('div', 'messages-empty', 'Could not load messages.'));
  }
}

async function loadOlderMessages() {
  if (state.loadingOlder || !state.hasMore || !state.messages.length) return;
  state.loadingOlder = true;
  const button = $('load-older');
  if (button) button.disabled = true;
  try {
    const before = state.messages[0].id;
    const data = await api(`/channels/${state.channelId}/messages?before=${before}&limit=50`);
    const oldHeight = messagesEl.scrollHeight;
    const oldTop = messagesEl.scrollTop;
    state.messages = [...data.messages, ...state.messages];
    state.hasMore = data.hasMore;
    renderAllMessages();
    messagesEl.scrollTop = messagesEl.scrollHeight - oldHeight + oldTop;
  } catch (err) {
    toast(err.message);
  } finally {
    state.loadingOlder = false;
    const fresh = $('load-older');
    if (fresh) fresh.disabled = false;
  }
}

function beginEdit(node, message) {
  if (node.querySelector('.msg-edit-input')) return;
  const contentEl = node.querySelector('.msg-content');
  if (!contentEl) return;

  const input = el('input', 'msg-edit-input');
  input.maxLength = 2000;
  input.value = message.content;
  contentEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let finished = false;
  const restore = () => {
    if (finished) return;
    finished = true;
    if (input.isConnected) input.replaceWith(buildContentEl(message));
  };

  input.addEventListener('blur', restore);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      restore();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return toast('Message cannot be empty');
    if (value === message.content) return restore();

    finished = true;
    state.socket.emit('message:edit', { messageId: message.id, content: value }, (res) => {
      if (!res?.ok) {
        toast(res?.error || 'Could not edit message');
        if (input.isConnected) input.replaceWith(buildContentEl(message));
      }
    });
  });
}

function deleteMessage(message) {
  if (!window.confirm('Delete this message?')) return;
  state.socket.emit('message:delete', { messageId: message.id }, (res) => {
    if (!res?.ok) toast(res?.error || 'Could not delete message');
  });
}

function findMessageById(id) {
  return (
    state.messages.find((m) => m.id === id) ??
    (state.thread.root?.id === id ? state.thread.root : null) ??
    state.thread.replies.find((r) => r.id === id) ??
    null
  );
}

messagesEl.addEventListener('click', (event) => {
  const openEditor = event.target.closest('.open-editor');
  if (openEditor) {
    event.preventDefault();
    const node = openEditor.closest('.msg');
    const message = node ? findMessageById(Number(node.dataset.id)) : null;
    const attachment = message?.attachments?.find((a) => a.id === Number(openEditor.dataset.attachment));
    if (attachment) openAttachmentInEditor(attachment);
    return;
  }

  const button = event.target.closest('.msg-actions button, .reply-count');
  if (!button) return;
  const node = button.closest('.msg');
  if (!node) return;
  const message = findMessageById(Number(node.dataset.id));
  if (!message) return;
  const action = button.dataset.action;
  if (action === 'edit') beginEdit(node, message);
  if (action === 'delete') deleteMessage(message);
  if (action === 'thread') openThread(message);
  if (action === 'save') saveMessageToProject(message);
});

/* --------------------------------- typing --------------------------------- */

function handleTyping({ channelId, userId, username }) {
  if (!userId || userId === state.user.id) return;
  let map = state.typing.get(channelId);
  if (!map) {
    map = new Map();
    state.typing.set(channelId, map);
  }
  const existing = map.get(userId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    map.delete(userId);
    if (state.channelId === channelId) renderTyping();
  }, 4500);
  map.set(userId, { username, timer });
  if (state.channelId === channelId) renderTyping();
}

function renderTyping() {
  const bar = $('typing');
  const map = state.channelId ? state.typing.get(state.channelId) : null;
  if (!map || !map.size) {
    bar.textContent = '';
    return;
  }
  const names = [...map.values()].map((v) => v.username);
  let text;
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length === 3) text = `${names[0]}, ${names[1]} and ${names[2]} are typing…`;
  else text = 'Several people are typing…';
  bar.textContent = text;
}

/* ------------------------------- dialogs/UI ------------------------------- */

function openDialog(id) {
  const dialog = $(id);
  formError(dialog, '');
  dialog.showModal();
  const input = dialog.querySelector('input');
  if (input) setTimeout(() => input.focus(), 30);
}

function openCreateServer() {
  $('form-create-server').reset();
  openDialog('dlg-create-server');
}

function openJoinServer() {
  $('form-join-server').reset();
  openDialog('dlg-join-server');
}

function openChannelDialog(type) {
  if (!state.serverId) return;
  state.channelModalType = type;
  $('channel-modal-title').textContent = type === 'text' ? 'Create text channel' : 'Create voice channel';
  $('channel-modal-sub').textContent =
    type === 'text'
      ? 'Text channels keep conversations organized.'
      : 'Voice channels are for hanging out with voice and video.';
  $('form-create-channel').reset();
  openDialog('dlg-create-channel');
}

function openInvite() {
  if (!state.server) return;
  $('invite-server-name').textContent = state.server.name;
  $('invite-code').textContent = state.server.inviteCode;
  openDialog('dlg-invite');
}

function toggleMembers() {
  const panel = $('members-panel');
  const mobile = window.matchMedia('(max-width: 1050px)').matches;
  const isShown = mobile ? panel.classList.contains('open') : !panel.classList.contains('hidden');
  if (isShown) {
    panel.classList.remove('open');
    panel.classList.add('hidden');
    localStorage.setItem('cb_members_hidden', '1');
  } else {
    panel.classList.remove('hidden');
    localStorage.setItem('cb_members_hidden', '0');
    if (mobile) panel.classList.add('open');
  }
  syncPaneHandles();
}

/* ------------------------------ pane layout ------------------------------- */

const PANES = {
  sidebar: { panel: 'sidebar', handle: 'split-sidebar', key: 'cb_w_sidebar', min: 180, dir: 1, reserve: 430, max: () => window.innerWidth * 0.45 },
  thread: { panel: 'thread-panel', handle: 'split-thread', key: 'cb_w_thread', min: 240, dir: -1, reserve: 340, max: () => 560 },
  members: { panel: 'members-panel', handle: 'split-members', key: 'cb_w_members', min: 180, dir: -1, reserve: 340, max: () => 420 },
  files: { panel: 'project-files', handle: 'split-files', key: 'cb_w_files', min: 140, dir: 1, reserve: 380, max: () => 420 },
};

function paneMax(cfg) {
  const panel = $(cfg.panel);
  const parent = panel.parentElement;
  const available = parent && parent.clientWidth > 0 ? parent.clientWidth : window.innerWidth;
  return Math.max(cfg.min, Math.min(cfg.max(), available - cfg.reserve));
}

function setPaneWidth(cfg, width, persist = false) {
  const panel = $(cfg.panel);
  const px = Math.round(Math.min(Math.max(width, cfg.min), paneMax(cfg)));
  panel.style.width = `${px}px`;
  if (persist) localStorage.setItem(cfg.key, String(px));
}

function bindPane(cfg) {
  const handle = $(cfg.handle);
  const panel = $(cfg.panel);
  if (!handle || !panel) return;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    try { handle.setPointerCapture(event.pointerId); } catch { /* synthetic or already-released pointer */ }
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const onMove = (moveEvent) => {
      setPaneWidth(cfg, startWidth + (moveEvent.clientX - startX) * cfg.dir);
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      localStorage.setItem(cfg.key, String(Math.round(panel.getBoundingClientRect().width)));
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });

  handle.addEventListener('dblclick', () => {
    panel.style.width = '';
    localStorage.removeItem(cfg.key);
  });

  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 48 : 16) * cfg.dir;
    setPaneWidth(cfg, panel.getBoundingClientRect().width + (event.key === 'ArrowRight' ? step : -step), true);
  });
}

function syncPaneHandles() {
  $('split-sidebar').hidden = $('app').classList.contains('sidebar-collapsed');
  $('split-thread').hidden = $('thread-panel').hidden;
  $('split-members').hidden = $('members-panel').classList.contains('hidden');
  $('split-files').hidden = $('project-view').hidden || $('project-files').classList.contains('collapsed');
}

function applyStoredPaneWidths() {
  for (const cfg of Object.values(PANES)) {
    const saved = Number(localStorage.getItem(cfg.key));
    if (Number.isFinite(saved) && saved > 0) setPaneWidth(cfg, saved);
  }
}

function setSidebarCollapsed(collapsed) {
  $('app').classList.toggle('sidebar-collapsed', collapsed);
  $('btn-sidebar-toggle').setAttribute('aria-pressed', String(!collapsed));
  localStorage.setItem('cb_sidebar_collapsed', collapsed ? '1' : '0');
  syncPaneHandles();
}

function setProjectFilesCollapsed(collapsed) {
  $('project-files').classList.toggle('collapsed', collapsed);
  $('btn-project-files').setAttribute('aria-pressed', String(!collapsed));
  localStorage.setItem('cb_files_collapsed', collapsed ? '1' : '0');
  syncPaneHandles();
}

function initPanes() {
  Object.values(PANES).forEach(bindPane);
  applyStoredPaneWidths();
  setSidebarCollapsed(localStorage.getItem('cb_sidebar_collapsed') === '1');
  setProjectFilesCollapsed(localStorage.getItem('cb_files_collapsed') === '1');
  if (localStorage.getItem('cb_members_hidden') === '1') $('members-panel').classList.add('hidden');
  syncPaneHandles();
  let frame = 0;
  window.addEventListener('resize', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const cfg of Object.values(PANES)) {
        const panel = $(cfg.panel);
        if (panel.style.width) setPaneWidth(cfg, parseFloat(panel.style.width));
      }
    });
  });
}

async function submitCreateServer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $('new-server-name').value.trim();
  if (name.length < 2) return formError(form, 'Server name must be at least 2 characters');
  try {
    const { server } = await api('/servers', { method: 'POST', body: JSON.stringify({ name }) });
    form.reset();
    $('dlg-create-server').close();
    await refreshServers();
    await openServer(server.id);
    toast(`Created “${server.name}”`);
  } catch (err) {
    formError(form, err.message);
  }
}

async function submitJoinServer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const code = $('join-code').value.trim().toLowerCase();
  if (!code) return formError(form, 'Enter an invite code');
  try {
    const { server } = await api(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST' });
    form.reset();
    $('dlg-join-server').close();
    await refreshServers();
    await openServer(server.id);
    toast(`Joined “${server.name}”`);
  } catch (err) {
    formError(form, err.message);
  }
}

async function submitCreateChannel(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $('new-channel-name').value.trim();
  if (!name) return formError(form, 'Channel name is required');
  try {
    const { channel } = await api(`/servers/${state.serverId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, type: state.channelModalType }),
    });
    form.reset();
    $('dlg-create-channel').close();
    if (state.server && !state.server.channels.some((c) => c.id === channel.id)) {
      state.server.channels.push(channel);
    }
    renderSidebar();
    if (channel.type === 'text') await openChannel(channel.id);
  } catch (err) {
    formError(form, err.message);
  }
}

async function copyInvite() {
  const code = state.server?.inviteCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast('Invite code copied');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($('invite-code'));
    selection.removeAllRanges();
    selection.addRange(range);
    toast('Select and copy the code');
  }
}

/* --------------------------------- wiring --------------------------------- */

function bindStaticUI() {
  $('tab-login').addEventListener('click', () => setAuthMode('login'));
  $('tab-register').addEventListener('click', () => setAuthMode('register'));
  $('auth-form').addEventListener('submit', onAuthSubmit);

  $('rail-add').addEventListener('click', openCreateServer);
  $('rail-join').addEventListener('click', openJoinServer);
  $('rail-user').addEventListener('click', logout);
  $('empty-create').addEventListener('click', openCreateServer);
  $('empty-join').addEventListener('click', openJoinServer);
  $('btn-logout').addEventListener('click', logout);
  $('btn-invite').addEventListener('click', openInvite);
  $('btn-add-text').addEventListener('click', () => openChannelDialog('text'));
  $('btn-add-voice').addEventListener('click', () => openChannelDialog('voice'));
  $('btn-members').addEventListener('click', toggleMembers);
  $('btn-members-close').addEventListener('click', toggleMembers);
  $('btn-sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(!$('app').classList.contains('sidebar-collapsed')));
  $('btn-sidebar-collapse').addEventListener('click', () => setSidebarCollapsed(true));
  $('btn-project-files').addEventListener('click', () => setProjectFilesCollapsed(!$('project-files').classList.contains('collapsed')));
  $('goto-join').addEventListener('click', () => {
    $('dlg-create-server').close();
    openJoinServer();
  });
  $('btn-copy-invite').addEventListener('click', copyInvite);
  $('voice-back').addEventListener('click', () => {
    if (state.channelId) showTextView();
    else showEmpty();
  });
  $('voice-dock').addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    showVoiceView();
  });

  $('form-create-server').addEventListener('submit', submitCreateServer);
  $('form-join-server').addEventListener('submit', submitJoinServer);
  $('form-create-channel').addEventListener('submit', submitCreateChannel);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  const composer = $('composer');
  const input = $('message-input');
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!state.channelId) return;
    if (!content && !state.pendingFiles.length) return;
    if (state.pendingFiles.some((f) => f.uploading)) return toast('Wait for uploads to finish');
    const channelId = state.channelId;
    const attachmentIds = state.pendingFiles.map((f) => f.id).filter(Boolean);
    const sentFiles = state.pendingFiles;
    input.value = '';
    state.pendingFiles = [];
    renderPendingFiles();

    state.socket.emit('message:send', { channelId, content, attachmentIds }, (res) => {
      if (!res?.ok) {
        toast(res?.error || 'Could not send message');
        if (!input.value) input.value = content;
        state.pendingFiles = sentFiles;
        renderPendingFiles();
      }
    });
  });

  $('btn-attach').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    for (const file of files) uploadFile(file);
  });

  $('open-project').addEventListener('click', () => {
    if (state.server) showProjectView();
  });
  $('btn-project-new').addEventListener('click', () => project?.createDoc());
  $('project-close').addEventListener('click', () => {
    if (state.channelId) showTextView();
    else showEmpty();
  });

  $('thread-close').addEventListener('click', closeThread);
  $('thread-composer').addEventListener('submit', onThreadSubmit);

  input.addEventListener('input', () => {
    if (!state.channelId) return;
    const now = Date.now();
    if (now - typingCooldown < 1800) return;
    typingCooldown = now;
    state.socket.emit('typing', { channelId: state.channelId });
  });
}

/* --------------------------------- start ---------------------------------- */

async function boot() {
  bindStaticUI();
  initPanes();
  if (!state.token) return showAuth();
  try {
    const { user } = await api('/me');
    state.user = user;
    await enterApp();
  } catch (err) {
    if (err.status === 401) {
      state.token = null;
      localStorage.removeItem('cord_token');
    } else {
      showAuthError('Could not reach the server. Reload to try again.');
    }
    showAuth();
  }
}

boot();
