const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function applyOps(text, ops) {
  let out = text;
  for (const op of ops) {
    if (!op) continue;
    const at = Math.max(0, Math.min(out.length, Number(op.at) || 0));
    const remove = Math.max(0, Math.min(out.length - at, Number(op.remove) || 0));
    const insert = typeof op.insert === 'string' ? op.insert : '';
    out = out.slice(0, at) + insert + out.slice(at + remove);
  }
  return out;
}

export function diffOps(oldText, newText) {
  if (oldText === newText) return [];
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  return [{ at: start, remove: endOld - start, insert: newText.slice(start, endNew) }];
}

function initials(name) {
  return String(name).trim().slice(0, 2).toUpperCase();
}

/* ------------------------------ code editor ------------------------------- */

const LANGUAGES = new Set(['plain', 'javascript', 'cpp', 'java', 'python']);

const LANG_BY_EXT = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  java: 'java',
  py: 'python',
};

const CODE_KEYWORDS = {
  javascript: new Set(
    'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield delete void import export from default static get set null true false undefined NaN'.split(
      ' ',
    ),
  ),
  cpp: new Set(
    'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend goto if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(
      ' ',
    ),
  ),
  java: new Set(
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false null var record sealed permits'.split(
      ' ',
    ),
  ),
  python: new Set(
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda not or pass raise return try while with yield True False None self'.split(
      ' ',
    ),
  ),
};

const CODE_TYPES = {
  javascript: new Set('String Number Boolean Object Array Promise Map Set JSON Math Date Error RegExp console document window'.split(' ')),
  cpp: new Set('std string vector map set unordered_map pair size_t int32_t uint32_t int64_t uint64_t cout cin endl printf scanf include define'.split(' ')),
  java: new Set('String Integer Long Double Float Boolean Character Object List ArrayList Map HashMap Set HashSet System Math Exception RuntimeException Thread'.split(' ')),
  python: new Set('str int float bool list dict set tuple Exception ValueError TypeError print len range enumerate zip open'.split(' ')),
};

const HIGHLIGHT = {
  javascript: {
    re: /(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|(?<num>\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)|(?<id>[A-Za-z_$][\w$]*)/g,
    keywords: CODE_KEYWORDS.javascript,
    types: CODE_TYPES.javascript,
  },
  cpp: {
    re: /(?<pre>^[ \t]*#[^\n]*)|(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')|(?<num>\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[fFuUlL]*\b)|(?<id>[A-Za-z_]\w*)/gm,
    keywords: CODE_KEYWORDS.cpp,
    types: CODE_TYPES.cpp,
  },
  java: {
    re: /(?<pre>@[A-Za-z_]\w*)|(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')|(?<num>\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)[fFdDlL]*\b)|(?<id>[A-Za-z_]\w*)/g,
    keywords: CODE_KEYWORDS.java,
    types: CODE_TYPES.java,
  },
  python: {
    re: /(?<com>#[^\n]*)|(?<str>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')|(?<num>\b\d+(?:\.\d+)?\b)|(?<id>[A-Za-z_]\w*)/g,
    keywords: CODE_KEYWORDS.python,
    types: CODE_TYPES.python,
  },
};

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
}

function tokenSpan(kind, value) {
  return `<span class="tok-${kind}">${escapeHtml(value)}</span>`;
}

function highlightSource(text, language) {
  const def = HIGHLIGHT[language];
  if (!def) return escapeHtml(text);
  let out = '';
  let last = 0;
  const re = def.re;
  re.lastIndex = 0;
  let match = re.exec(text);
  while (match) {
    if (match.index > last) out += escapeHtml(text.slice(last, match.index));
    const groups = match.groups || {};
    const value = match[0];
    if (groups.com) out += tokenSpan('com', value);
    else if (groups.str) out += tokenSpan('str', value);
    else if (groups.num) out += tokenSpan('num', value);
    else if (groups.pre) out += tokenSpan('pre', value);
    else if (groups.id) {
      if (def.keywords.has(value)) out += tokenSpan('key', value);
      else if (def.types.has(value) || /^[A-Z]/.test(value)) out += tokenSpan('type', value);
      else if (/^\s*\(/.test(text.slice(match.index + value.length))) out += tokenSpan('fn', value);
      else out += escapeHtml(value);
    } else {
      out += escapeHtml(value);
    }
    last = match.index + value.length;
    match = re.exec(text);
  }
  return out + escapeHtml(text.slice(last));
}

function inferLanguage(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return LANG_BY_EXT[ext] || 'plain';
}

/* --------------------------------- diff ----------------------------------- */

export function diffLines(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const rows = [];
  for (let i = 0; i < start; i++) rows.push({ type: 'same', text: a[i], oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n * m <= 250000) {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        rows.push({ type: 'same', text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        rows.push({ type: 'del', text: midA[i], oldNo: start + i + 1, newNo: null });
        i++;
      } else {
        rows.push({ type: 'add', text: midB[j], oldNo: null, newNo: start + j + 1 });
        j++;
      }
    }
    while (i < n) {
      rows.push({ type: 'del', text: midA[i], oldNo: start + i + 1, newNo: null });
      i++;
    }
    while (j < m) {
      rows.push({ type: 'add', text: midB[j], oldNo: null, newNo: start + j + 1 });
      j++;
    }
  } else {
    for (let i = 0; i < n; i++) rows.push({ type: 'del', text: midA[i], oldNo: start + i + 1, newNo: null });
    for (let j = 0; j < m; j++) rows.push({ type: 'add', text: midB[j], oldNo: null, newNo: start + j + 1 });
  }

  for (let k = 0; k < a.length - endA; k++) {
    rows.push({ type: 'same', text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return rows;
}

export function renderDiff(oldText, newText, { maxLines = 600 } = {}) {
  const rows = diffLines(oldText, newText);
  const box = el('div', 'diff-view');
  let adds = 0;
  let dels = 0;
  for (const row of rows) {
    if (row.type === 'add') adds++;
    else if (row.type === 'del') dels++;
  }
  const summary = el('div', 'diff-summary');
  summary.append(el('span', 'diff-plus', `+${adds}`), el('span', 'diff-minus', `-${dels}`));
  box.append(summary);

  if (!adds && !dels) {
    box.append(el('div', 'diff-more', 'No changes — this proposal matches the current file.'));
    return box;
  }

  const body = el('div', 'diff-body');
  for (const row of rows.slice(0, maxLines)) {
    const line = el('div', `diff-line ${row.type}`);
    line.append(
      el('span', 'diff-num', row.type === 'add' ? String(row.newNo) : String(row.oldNo ?? '')),
      el('span', 'diff-sign', row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '),
      el('span', 'diff-text', row.text === '' ? ' ' : row.text),
    );
    body.append(line);
  }
  if (rows.length > maxLines) {
    body.append(el('div', 'diff-more', `… ${rows.length - maxLines} more lines`));
  }
  box.append(body);
  return box;
}

export class Project {
  constructor({ socket, merges, toast, getUser, getServer, getServerId, getChannelId, onShow, onHide }) {
    this.socket = socket;
    this.merges = merges;
    this.toast = toast;
    this.getUser = getUser;
    this.getServer = getServer;
    this.getServerId = getServerId;
    this.getChannelId = getChannelId;
    this.onShow = onShow;
    this.onHide = onHide;

    this.serverId = null;
    this.docs = [];
    this.expandedMerges = new Set();
    this.activeId = null;
    this.mode = 'review';
    this.docOwner = false;
    this.language = 'plain';
    this.hlFrame = 0;
    this.serverText = '';
    this.rev = 0;
    this.viewers = [];
    this.sendTimer = null;
    this.visible = false;

    this.titleEl = $('project-title');
    this.presenceEl = $('project-presence');
    this.listEl = $('project-doc-list');
    this.editorEl = $('editor-textarea');
    this.highlightEl = $('editor-highlight');
    this.gutterEl = $('editor-gutter');
    this.langEl = $('editor-language');
    this.statusEl = $('editor-status');
    this.dirtyEl = $('editor-dirty');
    this.proposeBtn = $('btn-propose');
    this.mergesEl = $('project-merges');
    this.modeLive = $('mode-live');
    this.modeReview = $('mode-review');

    this.modeLive.addEventListener('click', () => this.setMode('live'));
    this.modeReview.addEventListener('click', () => this.setMode('review'));
    $('btn-add-doc').addEventListener('click', () => this.createDoc());
    $('btn-new-doc').addEventListener('click', () => this.createDoc());
    this.proposeBtn.addEventListener('click', () => this.proposeMerge());
    this.editorEl.addEventListener('input', () => this.onInput());
    this.editorEl.addEventListener('scroll', () => this.syncScroll());
    this.langEl.addEventListener('change', () => this.setLanguage(this.langEl.value));

    this.newFileDialog = $('dlg-new-file');
    this.newFileForm = $('form-new-file');
    this.newFileName = $('new-file-name');
    this.newFileResolve = null;
    this.newFileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = this.newFileName.value.trim();
      if (!name) return this.newFileName.focus();
      this.newFileDialog.close();
      this.newFileResolve?.(name);
    });
    this.newFileDialog.addEventListener('close', () => {
      this.newFileResolve?.(null);
      this.newFileResolve = null;
    });

    this.bindSocket();
    this.renderModes();
  }

  bindSocket() {
    const socket = this.socket;

    socket.on('doc:created', () => {
      if (this.serverId) this.loadDocs();
    });

    socket.on('doc:update', ({ docId, ops }) => {
      if (docId !== this.activeId) return;
      this.serverText = applyOps(this.serverText, ops);
      if (this.mode === 'live') {
        this.applyRemoteToEditor(this.serverText);
        this.updateStatus();
      } else {
        this.updateDirty();
      }
    });

    socket.on('doc:merged', ({ docId, content, by }) => {
      if (docId !== this.activeId) return;
      const old = this.serverText;
      this.serverText = content;
      this.updateDirty();
      if (this.mode === 'live' || this.editorEl.value === old) {
        this.applyRemoteToEditor(content);
      }
      if (by && by.id !== this.getUser().id) {
        this.toast(`${by.username} merged changes into ${this.activeName()}`);
      }
    });

    socket.on('doc:presence', ({ docId, users }) => {
      if (docId !== this.activeId) return;
      this.viewers = users;
      this.renderPresence();
    });

    socket.on('doc:mode', ({ docId, mode, by }) => {
      const local = this.docs.find((d) => d.id === docId);
      if (local) local.mode = mode;
      this.renderList();
      if (docId !== this.activeId) return;
      const previous = this.mode;
      this.mode = mode === 'live' ? 'live' : 'review';
      if (this.mode === 'live') this.applyRemoteToEditor(this.serverText);
      this.renderModes();
      this.updateDirty();
      if (by && by.id !== this.getUser().id) {
        this.toast(`${by.username} set ${this.activeName()} to ${this.mode} mode`);
      } else if (previous !== this.mode) {
        this.toast(
          this.mode === 'live'
            ? 'This file is live — edits stream instantly'
            : 'This file is in review — changes need approval',
        );
      }
    });

    socket.on('doc:mode-changed', ({ docId, mode }) => {
      const local = this.docs.find((d) => d.id === docId);
      if (!local) return;
      local.mode = mode;
      this.renderList();
    });
  }

  activeName() {
    return this.docs.find((d) => d.id === this.activeId)?.name ?? 'the file';
  }

  setServer(serverId) {
    if (this.serverId === serverId) return;
    this.setVisible(false);
    this.leaveActive();
    this.serverId = serverId;
    this.docs = [];
    this.activeId = null;
    this.serverText = '';
    this.renderList();
    this.renderEditorEmpty();
    if (serverId) this.loadDocs();
  }

  setVisible(visible) {
    this.visible = visible;
  }

  async loadDocs() {
    if (!this.serverId) return;
    try {
      const { docs } = await fetch(`/api/servers/${this.serverId}/docs`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cord_token')}` },
      }).then((r) => r.json());
      this.docs = docs;
      this.renderList();
    } catch {
      this.docs = [];
      this.renderList();
    }
  }

  renderList() {
    this.listEl.replaceChildren();
    if (!this.docs.length) {
      this.listEl.append(el('li', 'project-empty', 'No files yet. Create one with +.'));
      return;
    }
    for (const doc of this.docs) {
      const li = el('li');
      const button = el('button', `channel-row${doc.id === this.activeId ? ' active' : ''}`);
      button.type = 'button';
      const live = doc.mode === 'live';
      button.append(el('span', 'channel-icon', '▤'), el('span', 'channel-label', doc.name));
      const badge = el('span', `doc-mode ${live ? 'live' : 'review'}`, live ? 'LIVE' : 'REVIEW');
      badge.title = live ? 'Live edits' : 'Changes need approval';
      button.append(badge);
      button.addEventListener('click', () => this.openDoc(doc.id));
      li.append(button);
      this.listEl.append(li);
    }
  }

  renderEditorEmpty() {
    this.titleEl.textContent = 'Project files';
    this.editorEl.value = '';
    this.editorEl.disabled = true;
    this.langEl.disabled = true;
    this.langEl.value = 'plain';
    this.language = 'plain';
    this.renderHighlight();
    this.statusEl.textContent = 'Select a file to start editing, or create one.';
    this.dirtyEl.textContent = '';
    this.mode = 'review';
    this.docOwner = false;
    this.renderModes();
    this.presenceEl.replaceChildren();
    this.mergesEl.replaceChildren();
  }

  async createDoc() {
    if (!this.serverId || this.newFileDialog.open) return;
    this.newFileName.value = '';
    this.newFileDialog.showModal();
    this.newFileName.focus();
    const name = await new Promise((resolve) => {
      this.newFileResolve = resolve;
    });
    if (!name) return;
    try {
      const res = await fetch(`/api/servers/${this.serverId}/docs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cord_token')}`,
        },
        body: JSON.stringify({ name, content: '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the file');
      await this.loadDocs();
      await this.openDoc(data.doc.id);
    } catch (err) {
      this.toast(err.message);
    }
  }

  async openDoc(docId) {
    if (!this.serverId) return;
    this.leaveActive();
    this.onShow?.();
    this.visible = true;
    this.activeId = docId;
    this.renderList();

    await new Promise((resolve) => {
      this.socket.emit('docs:join', { docId }, (res) => {
        if (!res?.ok) {
          this.toast(res?.error || 'Could not open the file');
          this.activeId = null;
          this.renderList();
          this.renderEditorEmpty();
          return resolve();
        }
        this.serverText = res.doc.content;
        this.rev = res.doc.rev;
        this.editorEl.value = res.doc.content;
        this.editorEl.disabled = false;
        this.langEl.disabled = false;
        const saved = localStorage.getItem(`cord_lang_${res.doc.id}`);
        this.language = LANGUAGES.has(saved) ? saved : inferLanguage(res.doc.name);
        this.langEl.value = this.language;
        this.titleEl.textContent = res.doc.name;
        this.mode = res.doc.mode === 'live' ? 'live' : 'review';
        this.docOwner = res.doc.createdBy != null && res.doc.createdBy === this.getUser().id;
        this.renderModes();
        this.updateStatus();
        this.updateDirty();
        this.renderHighlight();
        this.renderMerges();
        this.renderPresence();
        this.editorEl.focus();
        resolve();
      });
    });
  }

  leaveActive() {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.activeId) this.socket.emit('docs:leave', { docId: this.activeId });
    this.activeId = null;
    this.viewers = [];
    this.mergesEl.replaceChildren();
  }

  leave() {
    this.leaveActive();
    this.visible = false;
    this.onHide?.();
  }

  renderModes() {
    const canSwitch = Boolean(this.activeId) && this.docOwner;
    this.modeLive.classList.toggle('active', this.mode === 'live');
    this.modeReview.classList.toggle('active', this.mode === 'review');
    this.modeLive.disabled = !canSwitch;
    this.modeReview.disabled = !canSwitch;
    this.modeLive.title = canSwitch
      ? "Make this file live — edits appear on everyone's screen instantly"
      : 'Only the file owner can change its mode';
    this.modeReview.title = canSwitch
      ? 'Require an approved merge before changes are applied'
      : 'Only the file owner can change its mode';
    this.proposeBtn.hidden = this.mode !== 'review' || !this.activeId;
    this.updateStatus();
  }

  setMode(mode) {
    if (!this.activeId) {
      this.toast('Open a file first');
      return;
    }
    if (!this.docOwner) {
      this.toast('Only the file owner can change its mode');
      return;
    }
    if (mode === this.mode) return;
    if (mode === 'live' && this.editorEl.value !== this.serverText) {
      if (!window.confirm('Switch this file to live editing and discard unmerged changes?')) return;
      this.applyRemoteToEditor(this.serverText);
    }
    this.socket.emit('docs:mode', { docId: this.activeId, mode }, (res) => {
      if (!res?.ok) this.toast(res?.error || 'Could not change the mode');
    });
  }

  updateStatus() {
    if (!this.activeId) return;
    if (this.mode === 'live') {
      const others = Math.max(0, this.viewers.length - 1);
      this.statusEl.textContent = others
        ? `Live — edits stream to ${others} other viewer${others > 1 ? 's' : ''}`
        : 'Live — edits stream to everyone with this file open';
    } else {
      this.statusEl.textContent = 'Review — your edits stay local until the merge is approved';
    }
  }

  updateDirty() {
    if (!this.activeId) {
      this.dirtyEl.textContent = '';
      return;
    }
    if (this.mode === 'live') {
      this.dirtyEl.textContent = `${this.editorEl.value.length} chars`;
    } else {
      const changed = this.editorEl.value !== this.serverText;
      this.dirtyEl.textContent = changed ? 'Unmerged edits' : 'No local changes';
      this.dirtyEl.classList.toggle('warn', changed);
    }
    this.proposeBtn.disabled = this.mode !== 'review' || this.editorEl.value === this.serverText;
    this.renderMerges();
  }

  applyRemoteToEditor(text) {
    const ta = this.editorEl;
    if (ta.value === text) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = text;
    try {
      ta.setSelectionRange(Math.min(text.length, start), Math.min(text.length, end));
    } catch {}
    this.updateDirty();
    this.scheduleHighlight();
  }

  scheduleHighlight() {
    if (this.hlFrame) return;
    this.hlFrame = requestAnimationFrame(() => {
      this.hlFrame = 0;
      this.renderHighlight();
    });
  }

  renderHighlight() {
    if (!this.activeId) {
      this.highlightEl.textContent = '';
      this.gutterEl.textContent = '';
      return;
    }
    const text = this.editorEl.value;
    const body = text.length > 120000 ? escapeHtml(text) : highlightSource(text, this.language);
    this.highlightEl.innerHTML = `${body}\n`;
    let lines = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    let numbers = '';
    for (let i = 1; i <= lines; i++) numbers += `${i}\n`;
    this.gutterEl.textContent = numbers;
    this.syncScroll();
  }

  syncScroll() {
    this.highlightEl.scrollTop = this.editorEl.scrollTop;
    this.highlightEl.scrollLeft = this.editorEl.scrollLeft;
    this.gutterEl.scrollTop = this.editorEl.scrollTop;
  }

  setLanguage(language) {
    if (!LANGUAGES.has(language)) language = 'plain';
    this.language = language;
    this.langEl.value = language;
    if (this.activeId) localStorage.setItem(`cord_lang_${this.activeId}`, language);
    this.scheduleHighlight();
  }

  onInput() {
    this.updateDirty();
    this.scheduleHighlight();
    if (this.mode !== 'live' || !this.activeId) return;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.flushLive(), 180);
  }

  flushLive() {
    this.sendTimer = null;
    if (!this.activeId || this.mode !== 'live') return;
    const next = this.editorEl.value;
    const ops = diffOps(this.serverText, next);
    if (!ops.length) return;
    this.serverText = next;
    const docId = this.activeId;
    this.socket.emit('docs:edit', { docId, ops }, (res) => {
      if (res?.ok) {
        this.rev = res.rev;
        return;
      }
      this.toast(res?.error || 'Could not sync changes');
      this.reloadActive();
    });
  }

  async reloadActive() {
    if (!this.activeId) return;
    const id = this.activeId;
    try {
      const res = await fetch(`/api/docs/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cord_token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the file');
      this.serverText = data.doc.content;
      this.applyRemoteToEditor(data.doc.content);
    } catch (err) {
      this.toast(err.message);
    }
  }

  proposeMerge() {
    if (!this.activeId || this.mode !== 'review') return;
    if (this.editorEl.value === this.serverText) {
      this.toast('There are no changes to merge');
      return;
    }
    this.socket.emit(
      'docs:propose',
      {
        docId: this.activeId,
        channelId: this.getChannelId?.() ?? null,
        content: this.editorEl.value,
      },
      (res) => {
        if (!res?.ok) {
          this.toast(res?.error || 'Could not open the merge');
          return;
        }
        if (res.merge.status === 'approved') {
          this.toast('No other reviewers online — changes applied');
        } else {
          this.toast('Merge proposed — waiting for the server members');
        }
        this.renderMerges();
      },
    );
  }

  vote(mergeId, vote) {
    this.socket.emit('docs:vote', { mergeId, vote }, (res) => {
      if (!res?.ok) this.toast(res?.error || 'Vote failed');
      this.renderMerges();
    });
  }

  decide(mergeId, approve) {
    this.socket.emit('docs:decide', { mergeId, approve }, (res) => {
      if (!res?.ok) this.toast(res?.error || 'Could not decide the merge');
      this.renderMerges();
    });
  }

  renderPresence() {
    this.presenceEl.replaceChildren();
    for (const user of this.viewers) {
      const node = el('span', 'presence-avatar', initials(user.username));
      node.style.background = user.color;
      node.title = user.username;
      this.presenceEl.append(node);
    }
    this.updateStatus();
  }

  pendingMerges() {
    if (!this.activeId) return [];
    return [...this.merges.values()]
      .filter((m) => m.docId === this.activeId && m.status === 'pending')
      .sort((a, b) => a.id - b.id);
  }

  renderMerges() {
    if (!this.activeId) {
      this.mergesEl.replaceChildren();
      return;
    }
    const pending = this.pendingMerges();
    const ids = new Set(pending.map((m) => m.id));
    for (const id of this.expandedMerges) if (!ids.has(id)) this.expandedMerges.delete(id);
    this.mergesEl.replaceChildren();
    if (!pending.length) return;
    this.mergesEl.append(el('div', 'project-merges-title', 'Pending merges'));
    const me = this.getUser();
    for (const merge of pending) {
      const row = el('div', 'project-merge-row');
      const meta = el('div', 'project-merge-meta');
      meta.append(
        el('strong', '', merge.proposer.username),
        el('span', 'muted', ` wants to merge ${merge.content.length} chars`),
      );
      row.append(meta);

      const votes = el('div', 'project-merge-votes');
      const approveCount = merge.votes.filter((v) => v.vote === 'approve').length;
      votes.append(el('span', 'muted', `${approveCount}/${merge.voters.length} approved`));
      for (const voter of merge.voters) {
        const vote = merge.votes.find((v) => v.userId === voter);
        const chip = el('span', `vote-chip ${vote ? vote.vote : 'pending'}`);
        chip.textContent = vote ? (vote.vote === 'approve' ? '✓' : '✕') : '…';
        chip.title = vote ? `${vote.username} ${vote.vote}d` : 'waiting for a vote';
        votes.append(chip);
      }
      row.append(votes);

      const actions = el('div', 'project-merge-actions');
      const expanded = this.expandedMerges.has(merge.id);
      const diffBtn = el('button', 'btn small ghost', expanded ? 'Hide changes' : 'View changes');
      diffBtn.type = 'button';
      diffBtn.addEventListener('click', () => {
        if (expanded) this.expandedMerges.delete(merge.id);
        else this.expandedMerges.add(merge.id);
        this.renderMerges();
      });
      actions.append(diffBtn);

      const isVoter = merge.voters.includes(me.id);
      const myVote = merge.votes.find((v) => v.userId === me.id);
      if (isVoter && !myVote) {
        const ok = el('button', 'btn small', 'Approve');
        ok.type = 'button';
        ok.addEventListener('click', () => this.vote(merge.id, 'approve'));
        const no = el('button', 'btn small danger', 'Decline');
        no.type = 'button';
        no.addEventListener('click', () => this.vote(merge.id, 'reject'));
        actions.append(ok, no);
      }
      if (this.getServer?.()?.ownerId === me.id) {
        const mergeNow = el('button', 'btn small primary', 'Merge now');
        mergeNow.type = 'button';
        mergeNow.title = 'Owner override — apply without waiting';
        mergeNow.addEventListener('click', () => this.decide(merge.id, true));
        const close = el('button', 'btn small', 'Close');
        close.type = 'button';
        close.addEventListener('click', () => this.decide(merge.id, false));
        actions.append(mergeNow, close);
      }
      row.append(actions);

      const wrap = el('div', 'project-merge');
      wrap.append(row);
      if (expanded) wrap.append(renderDiff(this.serverText, merge.content));
      this.mergesEl.append(wrap);
    }
  }
}
