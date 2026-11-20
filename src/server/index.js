import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import * as store from './db.js';
import { createPasswordHash, verifyPassword } from './auth.js';
import { PROJECT_ROOT, SERVERLESS } from './config.js';
import { saveUpload, streamUpload, readUploadText } from './storage.js';

const PORT = Number(process.env.PORT) || 4599;
const HOST = process.env.HOST || '0.0.0.0';

const DOC_MAX_CHARS = 200_000;
const UPLOAD_LIMIT_MB = SERVERLESS ? 4 : 10;
const UPLOAD_MAX_BYTES = UPLOAD_LIMIT_MB * 1024 * 1024;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; media-src 'self' blob:; " +
      "connect-src 'self' ws: wss: blob:; font-src 'self'; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use('/api/channels/:id/files', express.raw({ type: '*/*', limit: UPLOAD_MAX_BYTES }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

/* -------------------------------- rate limits ------------------------------ */

const rateBuckets = new Map();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 60_000).unref();

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

if (SERVERLESS || process.env.SOCKET_ADAPTER === 'postgres') {
  try {
    const { createAdapter } = await import('@socket.io/postgres-adapter');
    await store.pool.query(`
      CREATE TABLE IF NOT EXISTS socket_io_attachments (
        id          bigserial UNIQUE,
        created_at  timestamptz DEFAULT NOW(),
        payload     bytea
      )
    `);
    io.adapter(createAdapter(store.pool));
  } catch (err) {
    console.error('socket adapter unavailable, using in-memory rooms:', err.message);
  }
}

/* ------------------------------- shared state ------------------------------ */

const userSockets = new Map(); // userId -> Set<socketId>
const voiceChannels = new Map(); // channelId -> Map<userId, entry>
const online = (userId) => userSockets.has(userId);

const docCache = new Map(); // docId -> { content, rev, userId, timer }
const docViewers = new Map(); // docId -> Map<userId, count>

function docState(doc) {
  let state = docCache.get(doc.id);
  if (!state) {
    state = { content: doc.content, rev: doc.updated_at, userId: doc.updated_by, timer: null };
    docCache.set(doc.id, state);
  }
  return state;
}

function scheduleDocSave(docId) {
  const state = docCache.get(docId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    store.updateDoc(docId, state.content, state.userId).catch((err) => console.error('doc save', err));
  }, 700);
}

function addDocViewer(docId, userId) {
  let map = docViewers.get(docId);
  if (!map) {
    map = new Map();
    docViewers.set(docId, map);
  }
  map.set(userId, (map.get(userId) ?? 0) + 1);
}

function removeDocViewer(docId, userId) {
  const map = docViewers.get(docId);
  if (!map) return false;
  const next = (map.get(userId) ?? 0) - 1;
  if (next <= 0) map.delete(userId);
  else map.set(userId, next);
  if (map.size === 0) {
    docViewers.delete(docId);
    return false;
  }
  return true;
}

async function emitDocPresence(docId) {
  try {
    const doc = await store.getDoc(docId);
    if (!doc) return;
    const ids = [...(docViewers.get(docId)?.keys() ?? [])];
    const users = (await store.listChannelMembers(doc.server_id))
      .filter((m) => ids.includes(m.id))
      .map((m) => ({ id: m.id, username: m.username, color: m.color }));
    io.to(`doc:${docId}`).emit('doc:presence', { docId, users });
  } catch (err) {
    console.error('doc presence', err);
  }
}

function applyTextOps(text, ops) {
  let out = text;
  for (const op of ops.slice(0, 500)) {
    if (!op || typeof op !== 'object') continue;
    const at = Math.max(0, Math.min(out.length, Number(op.at) || 0));
    const remove = Math.max(0, Math.min(out.length - at, Number(op.remove) || 0));
    const insert = typeof op.insert === 'string' ? op.insert : '';
    out = out.slice(0, at) + insert + out.slice(at + remove);
    if (out.length > DOC_MAX_CHARS) return null;
  }
  return out;
}

async function applyMerge(request) {
  const doc = await store.getDoc(request.docId);
  if (!doc) return;
  const proposerId = request.proposer?.id ?? null;
  const state = docState(doc);
  state.content = request.content;
  state.rev = Math.max(Date.now(), state.rev + 1);
  state.userId = proposerId;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  await store.updateDoc(doc.id, request.content, proposerId);
  io.to(`doc:${doc.id}`).emit('doc:merged', {
    docId: doc.id,
    mergeId: request.id,
    content: request.content,
    rev: state.rev,
    by: request.proposer,
  });
}

async function evaluateMerge(requestId) {
  const request = await store.getMergeRequest(requestId);
  if (!request || request.status !== 'pending') return request;

  if (request.votes.some((v) => v.vote === 'reject')) {
    const resolved = await store.resolveMergeRequest(requestId, 'rejected');
    await broadcastToServer(resolved.serverId, 'merge:updated', { merge: resolved });
    return resolved;
  }
  const approved = new Set(request.votes.filter((v) => v.vote === 'approve').map((v) => v.userId));
  if (request.voters.every((id) => approved.has(id))) {
    const resolved = await store.resolveMergeRequest(requestId, 'approved');
    await applyMerge(resolved);
    await broadcastToServer(resolved.serverId, 'merge:updated', { merge: resolved });
    return resolved;
  }
  await broadcastToServer(request.serverId, 'merge:updated', { merge: request });
  return request;
}

async function joinUserToServerRooms(userId) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const roomIds = await store.listServerIdsForUser(userId);
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    for (const serverId of roomIds) socket.join(`server:${serverId}`);
    socket.join(`user:${userId}`);
  }
}

function broadcastToServer(serverId, event, payload, exceptSocket = null) {
  const room = io.to(`server:${serverId}`);
  (exceptSocket ? room.except(exceptSocket) : room).emit(event, payload);
}

async function broadcastToUserServers(userId, event, payload) {
  for (const serverId of await store.listServerIdsForUser(userId)) {
    io.to(`server:${serverId}`).emit(event, payload);
  }
}

/* --------------------------------- shapes --------------------------------- */

function channelShape(channel) {
  return {
    id: channel.id,
    serverId: channel.server_id,
    name: channel.name,
    type: channel.type,
    occupants: voiceOccupants(channel.id),
  };
}

async function serverDetail(serverRow, userId) {
  const members = (await store.listChannelMembers(serverRow.id)).map((m) => ({
    id: m.id,
    username: m.username,
    color: m.color,
    online: online(m.id),
    isOwner: m.id === serverRow.owner_id,
  }));
  return {
    id: serverRow.id,
    name: serverRow.name,
    ownerId: serverRow.owner_id,
    inviteCode: serverRow.invite_code,
    channels: (await store.listChannels(serverRow.id)).map(channelShape),
    members,
  };
}

function voiceOccupants(channelId) {
  const room = voiceChannels.get(channelId);
  if (!room) return [];
  return [...room.values()].map((e) => ({
    userId: e.userId,
    username: e.username,
    color: e.color,
    muted: e.muted,
    camera: e.camera,
    sharing: Boolean(e.sharing),
  }));
}

function emitOccupants(channelId, serverId) {
  broadcastToServer(serverId, 'voice:occupants', {
    channelId,
    occupants: voiceOccupants(channelId),
  });
}

async function removeVoiceUser(userId) {
  for (const [channelId, room] of voiceChannels) {
    const entry = room.get(userId);
    if (!entry) continue;
    room.delete(userId);
    if (room.size === 0) voiceChannels.delete(channelId);
    const channel = await store.getChannel(channelId);
    if (channel) {
      io.to(`voice:${channelId}`).emit('voice:peer-left', {
        userId,
        socketId: entry.socketId,
      });
      emitOccupants(channelId, channel.server_id);
    }
    return entry;
  }
  return null;
}

/* ---------------------------------- auth ---------------------------------- */

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = await store.getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,24}$/;

app.post('/api/register', async (req, res, next) => {
  try {
    if (!rateLimit(`register:${req.ip}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many sign-ups from this address — try again later' });
    }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
      return res.status(400).json({ error: 'Username must be 2-24 characters (letters, numbers, . _ -)' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const name = username.trim();
    if (await store.getUserByUsername(name)) {
      return res.status(409).json({ error: 'That username is taken' });
    }
    const { salt, hash } = await createPasswordHash(password);
    let user;
    try {
      user = await store.createUser({ username: name, salt, hash });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That username is taken' });
      throw err;
    }
    const token = await store.createSession(user.id);
    res.json({ token, user: store.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    const ipAllowed = rateLimit(`login-ip:${req.ip}`, 60, 15 * 60 * 1000);
    const nameKey = typeof username === 'string' ? `login-user:${username.trim().toLowerCase()}` : null;
    const userAllowed = !nameKey || rateLimit(nameKey, 15, 15 * 60 * 1000);
    if (!ipAllowed || !userAllowed) {
      return res.status(429).json({ error: 'Too many login attempts — wait a few minutes' });
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await store.getUserByUsername(username.trim());
    if (!user || !(await verifyPassword(password, user.salt, user.hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = await store.createSession(user.id);
    res.json({ token, user: store.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', authRequired, async (req, res, next) => {
  try {
    await store.deleteSession(req.token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: store.publicUser(req.user) });
});

app.get('/api/ice', authRequired, (req, res) => {
  const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  res.json({ iceServers });
});

/* --------------------------------- servers -------------------------------- */

app.get('/api/servers', authRequired, async (req, res, next) => {
  try {
    res.json({ servers: await store.listServersForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/servers', authRequired, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 32) {
      return res.status(400).json({ error: 'Server name must be 2-32 characters' });
    }
    const row = await store.createServer(name, req.user.id);
    await joinUserToServerRooms(req.user.id);
    broadcastToServer(row.id, 'server:joined', {
      server: { id: row.id, name: row.name, ownerId: row.owner_id, inviteCode: row.invite_code },
    });
    res.json({ server: await serverDetail(row, req.user.id) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/servers/:id', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerForUser(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Server not found' });
    res.json({ server: await serverDetail(row, req.user.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/servers/:id/channels', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerForUser(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Server not found' });
    const type = req.body?.type === 'voice' ? 'voice' : 'text';
    const name = store.slugifyChannel(req.body?.name ?? '');
    if (!name) return res.status(400).json({ error: 'Channel name is required' });
    const channel = await store.createServerChannel(row.id, name, type);
    const shaped = channelShape(channel);
    io.to(`server:${row.id}`).emit('channel:created', { channel: shaped });
    res.json({ channel: shaped });
  } catch (err) {
    next(err);
  }
});

app.post('/api/invites/:code/join', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerByInvite(String(req.params.code).trim().toLowerCase());
    if (!row) return res.status(404).json({ error: 'Invalid invite code' });
    const alreadyMember = await store.isMember(row.id, req.user.id);
    await store.addMember(row.id, req.user.id);
    await joinUserToServerRooms(req.user.id);
    if (!alreadyMember) {
      broadcastToServer(row.id, 'member:joined', {
        serverId: row.id,
        member: {
          id: req.user.id,
          username: req.user.username,
          color: req.user.color,
          online: true,
          isOwner: req.user.id === row.owner_id,
        },
      });
      io.to(`user:${req.user.id}`).emit('server:joined', {
        server: { id: row.id, name: row.name, ownerId: row.owner_id, inviteCode: row.invite_code },
      });
    }
    res.json({ server: await serverDetail(row, req.user.id) });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- messages -------------------------------- */

app.get('/api/channels/:id/messages', authRequired, async (req, res, next) => {
  try {
    const channel = await store.getChannelForUser(Number(req.params.id), req.user.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.type !== 'text') return res.status(400).json({ error: 'Not a text channel' });
    const before = Number(req.query.before) || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const messages = await store.listMessages(channel.id, before, limit);
    res.json({ messages, hasMore: messages.length === limit });
  } catch (err) {
    next(err);
  }
});

app.get('/api/channels/:id/threads/:messageId', authRequired, async (req, res, next) => {
  try {
    const channel = await store.getChannelForUser(Number(req.params.id), req.user.id);
    if (!channel || channel.type !== 'text') return res.status(404).json({ error: 'Channel not found' });
    const root = await store.getMessageRow(Number(req.params.messageId));
    if (!root || root.channel_id !== channel.id || root.thread_id !== null) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json({
      parent: await store.getMessage(root.id),
      replies: await store.listThreadReplies(channel.id, root.id),
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------- files --------------------------------- */

function safeFileName(raw) {
  let name = String(raw || 'file');
  try {
    name = decodeURIComponent(name);
  } catch {}
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
  return name || 'file';
}

app.post('/api/channels/:id/files', authRequired, async (req, res, next) => {
  try {
    const channel = await store.getChannelForUser(Number(req.params.id), req.user.id);
    if (!channel || channel.type !== 'text') return res.status(404).json({ error: 'Channel not found' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Empty file' });
    }
    if (req.body.length > UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: `File is larger than ${UPLOAD_LIMIT_MB} MB` });
    }
    const name = safeFileName(req.headers['x-file-name']);
    const mime = String(req.headers['x-file-type'] || 'application/octet-stream').slice(0, 120);
    const ext = (name.match(/\.([a-zA-Z0-9]{1,10})$/) || [])[1];
    const storedName = randomBytes(12).toString('hex') + (ext ? `.${ext.toLowerCase()}` : '');
    let ref;
    try {
      ref = await saveUpload(req.body, storedName, mime);
    } catch (err) {
      console.error('upload', err);
      return res.status(500).json({ error: 'Could not store the file' });
    }
    const row = await store.createPendingAttachment({
      channelId: channel.id,
      userId: req.user.id,
      name,
      mime,
      size: req.body.length,
      storedName: ref,
    });
    res.json({ attachment: { id: row.id, name: row.name, mime: row.mime, size: row.size } });
  } catch (err) {
    next(err);
  }
});

app.get('/api/files/:id', async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '');
    const user = await store.getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const attachment = await store.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ error: 'File not found' });
    if (!(await store.getChannelForUser(attachment.channel_id, user.id))) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (attachment.message_id === null && attachment.uploaded_by !== user.id) {
      return res.status(404).json({ error: 'File not found' });
    }
    const inline =
      req.query.inline &&
      (attachment.mime.startsWith('image/') ||
        attachment.mime.startsWith('audio/') ||
        attachment.mime.startsWith('video/') ||
        attachment.mime === 'application/pdf' ||
        looksTextual(attachment));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      inline
        ? 'inline'
        : `attachment; filename="${attachment.stored_name}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    );
    await streamUpload(attachment.stored_name, res);
  } catch (err) {
    next(err);
  }
});

const TEXT_FILE_RE = /\.(md|txt|log|js|mjs|cjs|ts|json|css|html|htm|xml|csv|py|c|h|cpp|hpp|java|kt|go|rs|rb|php|sql|yml|yaml|sh|ini|toml)$/i;
const looksTextual = (attachment) =>
  attachment.mime.startsWith('text/') ||
  /(^|\/)(json|javascript|xml|x-sh|sql|yaml)/.test(attachment.mime) ||
  TEXT_FILE_RE.test(attachment.name);

app.post('/api/files/:id/open', authRequired, async (req, res, next) => {
  try {
    const attachment = await store.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ error: 'File not found' });
    const channel = await store.getChannelForUser(attachment.channel_id, req.user.id);
    if (!channel) return res.status(404).json({ error: 'File not found' });
    if (attachment.message_id === null && attachment.uploaded_by !== req.user.id) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!looksTextual(attachment)) {
      return res.status(400).json({ error: 'Only text files can be opened in the editor' });
    }
    let content;
    try {
      content = await readUploadText(attachment.stored_name);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
    if (content.length > DOC_MAX_CHARS) {
      return res.status(400).json({ error: 'File is too large for the editor' });
    }
    let doc = await store.getDocByName(channel.server_id, attachment.name);
    if (!doc) doc = await store.createDoc(channel.server_id, req.user.id, attachment.name, content);
    io.to(`server:${channel.server_id}`).emit('doc:created', {
      doc: { id: doc.id, name: doc.name, updatedAt: doc.updated_at, updatedBy: null },
    });
    res.json({ doc: { id: doc.id, name: doc.name, content: doc.content, updatedAt: doc.updated_at } });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- project docs ----------------------------- */

app.get('/api/servers/:id/docs', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerForUser(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Server not found' });
    res.json({ docs: await store.listDocs(row.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/servers/:id/docs', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerForUser(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Server not found' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!name || name.length > 64) {
      return res.status(400).json({ error: 'File name must be 1-64 characters' });
    }
    if (content.length > DOC_MAX_CHARS) {
      return res.status(400).json({ error: 'File content is too large' });
    }
    const doc = await store.createDoc(row.id, req.user.id, name, content);
    io.to(`server:${row.id}`).emit('doc:created', {
      doc: { id: doc.id, name: doc.name, updatedAt: doc.updated_at, updatedBy: { id: req.user.id, username: req.user.username } },
    });
    res.json({ doc: { id: doc.id, name: doc.name, content: doc.content, updatedAt: doc.updated_at } });
  } catch (err) {
    next(err);
  }
});

app.get('/api/docs/:id', authRequired, async (req, res, next) => {
  try {
    const doc = await store.getDocForUser(Number(req.params.id), req.user.id);
    if (!doc) return res.status(404).json({ error: 'File not found' });
    res.json({
      doc: { id: doc.id, name: doc.name, content: doc.content, updatedAt: doc.updated_at, serverId: doc.server_id },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/servers/:id/merges', authRequired, async (req, res, next) => {
  try {
    const row = await store.getServerForUser(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Server not found' });
    const status = req.query.status === 'all' ? 'all' : 'pending';
    res.json({ merges: await store.listMergeRequests(row.id, status) });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- sockets -------------------------------- */

io.use((socket, next) => {
  store
    .getUserByToken(socket.handshake.auth?.token)
    .then((user) => {
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    })
    .catch(next);
});

io.on('connection', async (socket) => {
  const user = socket.data.user;

  let set = userSockets.get(user.id);
  if (!set) {
    set = new Set();
    userSockets.set(user.id, set);
  }
  set.add(socket.id);

  socket.join(`user:${user.id}`);
  for (const serverId of await store.listServerIdsForUser(user.id)) {
    socket.join(`server:${serverId}`);
  }

  if (set.size === 1) {
    await broadcastToUserServers(user.id, 'presence:update', { userId: user.id, online: true });
  }

  const requireChannel = (channelId) =>
    store.getChannelForUser(Number(channelId), user.id);

  const socketBuckets = new Map();
  const allow = (key, max, windowMs) => {
    const now = Date.now();
    let bucket = socketBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      socketBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= max;
  };

  socket.on('message:send', async (payload, ack) => {
    try {
      if (!allow('message', 10, 5000)) {
        return ack?.({ ok: false, error: 'You are sending messages too quickly' });
      }
      const channel = await requireChannel(payload?.channelId);
      if (!channel || channel.type !== 'text') {
        return ack?.({ ok: false, error: 'Channel not found' });
      }
      const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
      if (content.length > 2000) {
        return ack?.({ ok: false, error: 'Message must be 1-2000 characters' });
      }

      let root = null;
      const threadId = payload?.threadId ? Number(payload.threadId) : null;
      if (threadId) {
        root = await store.getMessageRow(threadId);
        if (!root || root.channel_id !== channel.id || root.thread_id !== null) {
          return ack?.({ ok: false, error: 'Thread not found' });
        }
      }

      const attachmentIds = Array.isArray(payload?.attachmentIds)
        ? [...new Set(payload.attachmentIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0).slice(0, 10)
        : [];
      if (!content && !attachmentIds.length) {
        return ack?.({ ok: false, error: 'Message must be 1-2000 characters' });
      }

      const created = await store.createMessage(channel.id, user.id, content, threadId);
      if (attachmentIds.length && !(await store.bindAttachments(attachmentIds, created.id, channel.id, user.id))) {
        await store.deleteMessage(created.id);
        return ack?.({ ok: false, error: 'Files expired or already sent — attach them again' });
      }
      const message = await store.getMessage(created.id);
      broadcastToServer(channel.server_id, 'message:new', { message, channelId: channel.id });

      if (root) {
        const parent = await store.getMessage(root.id);
        if (parent) {
          broadcastToServer(channel.server_id, 'thread:reply', {
            channelId: channel.id,
            rootId: root.id,
            message,
            parent,
          });
        }
      }
      ack?.({ ok: true, id: message.id, message });
    } catch (err) {
      console.error('message:send', err);
      ack?.({ ok: false, error: 'Could not send message' });
    }
  });

  socket.on('message:edit', async (payload, ack) => {
    try {
      const row = await store.getMessageRow(Number(payload?.messageId));
      if (!row || row.user_id !== user.id) {
        return ack?.({ ok: false, error: 'You can only edit your own messages' });
      }
      const channel = await requireChannel(row.channel_id);
      if (!channel) return ack?.({ ok: false, error: 'Channel not found' });
      const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
      if (!content || content.length > 2000) {
        return ack?.({ ok: false, error: 'Message must be 1-2000 characters' });
      }
      const message = await store.editMessage(row.id, content);
      broadcastToServer(channel.server_id, 'message:updated', { message, channelId: channel.id });
      ack?.({ ok: true });
    } catch (err) {
      console.error('message:edit', err);
      ack?.({ ok: false, error: 'Could not edit message' });
    }
  });

  socket.on('message:delete', async (payload, ack) => {
    try {
      const row = await store.getMessageRow(Number(payload?.messageId));
      if (!row || row.user_id !== user.id) {
        return ack?.({ ok: false, error: 'You can only delete your own messages' });
      }
      const channel = await requireChannel(row.channel_id);
      if (!channel) return ack?.({ ok: false, error: 'Channel not found' });
      const threadId = row.thread_id;
      await store.deleteMessage(row.id);
      broadcastToServer(channel.server_id, 'message:deleted', {
        id: row.id,
        channelId: row.channel_id,
        threadId,
      });
      if (threadId) {
        const parent = await store.getMessage(threadId);
        if (parent) {
          broadcastToServer(channel.server_id, 'message:updated', {
            message: parent,
            channelId: channel.id,
          });
        }
      }
      ack?.({ ok: true });
    } catch (err) {
      console.error('message:delete', err);
      ack?.({ ok: false, error: 'Could not delete message' });
    }
  });

  socket.on('typing', async (payload) => {
    try {
      if (!allow('typing', 1, 1500)) return;
      const channel = await requireChannel(payload?.channelId);
      if (!channel || channel.type !== 'text') return;
      socket.to(`server:${channel.server_id}`).emit('typing', {
        channelId: channel.id,
        userId: user.id,
        username: user.username,
      });
    } catch (err) {
      console.error('typing', err);
    }
  });

  /* ------------------------------ project docs ------------------------------ */

  const docIds = new Set();

  socket.on('docs:join', async (payload, ack) => {
    try {
      const doc = await store.getDocForUser(Number(payload?.docId), user.id);
      if (!doc) return ack?.({ ok: false, error: 'File not found' });
      const state = docState(doc);
      socket.join(`doc:${doc.id}`);
      docIds.add(doc.id);
      addDocViewer(doc.id, user.id);
      await emitDocPresence(doc.id);
      ack?.({
        ok: true,
        doc: {
          id: doc.id,
          name: doc.name,
          serverId: doc.server_id,
          mode: doc.mode === 'live' ? 'live' : 'review',
          createdBy: doc.created_by ?? null,
          rev: state.rev,
          content: state.content,
        },
      });
    } catch (err) {
      console.error('docs:join', err);
      ack?.({ ok: false, error: 'Could not open the file' });
    }
  });

  socket.on('docs:mode', async (payload, ack) => {
    try {
      const doc = await store.getDocForUser(Number(payload?.docId), user.id);
      if (!doc) return ack?.({ ok: false, error: 'File not found' });
      if (doc.created_by !== user.id) {
        return ack?.({ ok: false, error: 'Only the file owner can change its mode' });
      }
      const mode = payload?.mode === 'live' ? 'live' : 'review';
      await store.setDocMode(doc.id, mode);
      const by = { id: user.id, username: user.username, color: user.color };
      io.to(`doc:${doc.id}`).emit('doc:mode', { docId: doc.id, mode, by });
      broadcastToServer(doc.server_id, 'doc:mode-changed', { docId: doc.id, mode, by });
      ack?.({ ok: true, mode });
    } catch (err) {
      console.error('docs:mode', err);
      ack?.({ ok: false, error: 'Could not change the mode' });
    }
  });

  socket.on('docs:leave', (payload) => {
    const docId = Number(payload?.docId);
    if (!docId || !docIds.has(docId)) return;
    docIds.delete(docId);
    socket.leave(`doc:${docId}`);
    removeDocViewer(docId, user.id);
    emitDocPresence(docId);
  });

  socket.on('docs:edit', async (payload, ack) => {
    try {
      const doc = await store.getDocForUser(Number(payload?.docId), user.id);
      if (!doc) return ack?.({ ok: false, error: 'File not found' });
      if (doc.mode !== 'live') {
        return ack?.({ ok: false, error: 'This file is in review mode — propose a merge instead' });
      }
      const state = docState(doc);
      const ops = Array.isArray(payload?.ops) ? payload.ops : [];
      if (!ops.length) return ack?.({ ok: true, rev: state.rev });

      const next = applyTextOps(state.content, ops);
      if (next === null) return ack?.({ ok: false, error: 'File is too large' });
      if (next === state.content) return ack?.({ ok: true, rev: state.rev, noop: true });

      state.content = next;
      state.rev = Math.max(Date.now(), state.rev + 1);
      state.userId = user.id;
      scheduleDocSave(doc.id);

      socket.to(`doc:${doc.id}`).emit('doc:update', {
        docId: doc.id,
        ops,
        rev: state.rev,
        userId: user.id,
        username: user.username,
        color: user.color,
      });
      ack?.({ ok: true, rev: state.rev });
    } catch (err) {
      console.error('docs:edit', err);
      ack?.({ ok: false, error: 'Could not apply the edit' });
    }
  });

  socket.on('docs:propose', async (payload, ack) => {
    try {
      if (!allow('propose', 6, 60_000)) {
        return ack?.({ ok: false, error: 'Too many merge requests — wait a minute' });
      }
      const doc = await store.getDocForUser(Number(payload?.docId), user.id);
      if (!doc) return ack?.({ ok: false, error: 'File not found' });
      if (doc.mode === 'live') {
        return ack?.({ ok: false, error: 'This file is live — edits apply instantly' });
      }
      const content = typeof payload?.content === 'string' ? payload.content : '';
      if (!content.trim()) return ack?.({ ok: false, error: 'There are no changes to merge' });
      if (content.length > DOC_MAX_CHARS) return ack?.({ ok: false, error: 'File is too large' });

      const members = await store.listChannelMembers(doc.server_id);
      const voters = members.filter((m) => m.id !== user.id && online(m.id)).map((m) => m.id);
      const requestId = await store.createMergeRequest({
        docId: doc.id,
        serverId: doc.server_id,
        userId: user.id,
        content,
        voters,
      });
      let request = await store.getMergeRequest(requestId);

      const channels = (await store.listChannels(doc.server_id)).filter((c) => c.type === 'text');
      const preferred = channels.find((c) => c.id === Number(payload?.channelId)) ?? channels[0];
      if (preferred) {
        const created = await store.createMessage(
          preferred.id,
          user.id,
          `${user.username} wants to merge changes into "${doc.name}".`,
        );
        await store.setMessageMerge(created.id, request.id);
        const message = await store.getMessage(created.id);
        broadcastToServer(doc.server_id, 'message:new', { message, channelId: preferred.id });
      }

      if (!voters.length) {
        request = await store.resolveMergeRequest(request.id, 'approved');
        await applyMerge(request);
      }
      broadcastToServer(doc.server_id, 'merge:new', { merge: request });
      ack?.({ ok: true, merge: request });
    } catch (err) {
      console.error('docs:propose', err);
      ack?.({ ok: false, error: 'Could not open the merge request' });
    }
  });

  socket.on('docs:vote', async (payload, ack) => {
    try {
      const request = await store.getMergeRequest(Number(payload?.mergeId));
      if (!request || request.status !== 'pending') {
        return ack?.({ ok: false, error: 'This merge is already closed' });
      }
      if (!(await store.getDocForUser(request.docId, user.id))) {
        return ack?.({ ok: false, error: 'File not found' });
      }
      if (!(await store.isMergeVoter(request.id, user.id))) {
        return ack?.({ ok: false, error: 'You are not a reviewer for this merge' });
      }
      const vote = payload?.vote === 'reject' ? 'reject' : payload?.vote === 'approve' ? 'approve' : null;
      if (!vote) return ack?.({ ok: false, error: 'Invalid vote' });
      await store.recordMergeVote(request.id, user.id, vote);
      const merged = await evaluateMerge(request.id);
      ack?.({ ok: true, merge: merged });
    } catch (err) {
      console.error('docs:vote', err);
      ack?.({ ok: false, error: 'Could not record the vote' });
    }
  });

  socket.on('docs:decide', async (payload, ack) => {
    try {
      const request = await store.getMergeRequest(Number(payload?.mergeId));
      if (!request) return ack?.({ ok: false, error: 'Merge not found' });
      const row = await store.getServerById(request.serverId);
      if (!row || row.owner_id !== user.id) {
        return ack?.({ ok: false, error: 'Only the server owner can decide' });
      }
      if (request.status !== 'pending') {
        return ack?.({ ok: false, error: 'This merge is already closed' });
      }
      const approve = Boolean(payload?.approve);
      const resolved = await store.resolveMergeRequest(request.id, approve ? 'approved' : 'rejected');
      if (approve) await applyMerge(resolved);
      broadcastToServer(resolved.serverId, 'merge:updated', { merge: resolved });
      ack?.({ ok: true, merge: resolved });
    } catch (err) {
      console.error('docs:decide', err);
      ack?.({ ok: false, error: 'Could not resolve the merge' });
    }
  });

  /* ---------------------------------- voice --------------------------------- */

  socket.on('voice:join', async (payload, ack) => {
    try {
      const channel = await requireChannel(payload?.channelId);
      if (!channel || channel.type !== 'voice') {
        return ack?.({ ok: false, error: 'Voice channel not found' });
      }

      await removeVoiceUser(user.id);

      const entry = {
        socketId: socket.id,
        userId: user.id,
        username: user.username,
        color: user.color,
        muted: Boolean(payload?.muted),
        camera: Boolean(payload?.camera),
        sharing: false,
      };
      let room = voiceChannels.get(channel.id);
      if (!room) {
        room = new Map();
        voiceChannels.set(channel.id, room);
      }
      const peers = [...room.values()].map((e) => ({ ...e }));
      room.set(user.id, entry);
      socket.join(`voice:${channel.id}`);

      ack?.({ ok: true, peers, occupants: voiceOccupants(channel.id) });
      socket.to(`voice:${channel.id}`).emit('voice:peer-joined', { peer: entry });
      emitOccupants(channel.id, channel.server_id);
    } catch (err) {
      console.error('voice:join', err);
      ack?.({ ok: false, error: 'Could not join the call' });
    }
  });

  socket.on('voice:leave', async () => {
    let channelId = null;
    for (const [id, room] of voiceChannels) {
      const e = room.get(user.id);
      if (e && e.socketId === socket.id) {
        channelId = id;
        break;
      }
    }
    await removeVoiceUser(user.id);
    if (channelId) socket.leave(`voice:${channelId}`);
  });

  socket.on('voice:state', async (payload) => {
    try {
      let entry = null;
      let channelId = null;
      for (const [id, room] of voiceChannels) {
        const e = room.get(user.id);
        if (e && e.socketId === socket.id) {
          entry = e;
          channelId = id;
          break;
        }
      }
      if (!entry) return;
      entry.muted = Boolean(payload?.muted);
      entry.camera = Boolean(payload?.camera);
      entry.sharing = Boolean(payload?.sharing);
      socket.to(`voice:${channelId}`).emit('voice:peer-state', {
        channelId,
        userId: user.id,
        muted: entry.muted,
        camera: entry.camera,
        sharing: entry.sharing,
      });
      const channel = await store.getChannel(channelId);
      if (channel) emitOccupants(channelId, channel.server_id);
    } catch (err) {
      console.error('voice:state', err);
    }
  });

  socket.on('voice:signal', (payload) => {
    const targetSocketId = payload?.to;
    if (typeof targetSocketId !== 'string') return;
    const target = io.sockets.sockets.get(targetSocketId);
    if (!target?.data?.user) return;

    let myChannel = null;
    for (const [channelId, room] of voiceChannels) {
      const e = room.get(user.id);
      if (e && e.socketId === socket.id) {
        myChannel = channelId;
        break;
      }
    }
    if (!myChannel) return;
    const theirs = voiceChannels.get(myChannel)?.get(target.data.user.id);
    if (!theirs || theirs.socketId !== targetSocketId) return;

    io.to(targetSocketId).emit('voice:signal', {
      from: socket.id,
      userId: user.id,
      username: user.username,
      color: user.color,
      data: payload.data,
    });
  });

  socket.on('disconnect', async () => {
    try {
      await removeVoiceUser(user.id);
      for (const docId of docIds) {
        removeDocViewer(docId, user.id);
        await emitDocPresence(docId);
      }
      docIds.clear();
      const sockets = userSockets.get(user.id);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(user.id);
        await broadcastToUserServers(user.id, 'presence:update', { userId: user.id, online: false });
      }
    } catch (err) {
      console.error('disconnect', err);
    }
  });
});

/* --------------------------------- health --------------------------------- */

const healthCheck = async (req, res) => {
  try {
    await store.ping();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database unavailable' });
  }
};

app.get('/healthz', healthCheck);
app.get('/api/healthz', healthCheck);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: `File is larger than ${UPLOAD_LIMIT_MB} MB` });
  }
  console.error('request error', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* --------------------------------- startup -------------------------------- */

await store.initDb();

if (!SERVERLESS) {
  store.sweepExpiredSessions().catch((err) => console.error('session sweep', err.message));
  setInterval(() => {
    store.sweepExpiredSessions().catch((err) => console.error('session sweep', err.message));
  }, 60 * 60 * 1000).unref();

  server.listen(PORT, HOST, () => {
    console.log(`Chatterbox running at http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    io.close();
    server.close(async () => {
      try {
        await store.closeDb();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app, server, io };
export default server;
