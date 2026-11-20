import {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Footer, PageNumber,
  BorderStyle, ExternalHyperlink, TabStopType, Table, TableRow, TableCell, WidthType,
} from 'docx';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

mkdirSync('deliverables', { recursive: true });

const FONT = 'Times New Roman';
const NAVY = '0B3A53';
const INK = '000000';

async function img(path, widthInches) {
  const meta = await sharp(path).metadata();
  const width = Math.round(widthInches * 96);
  const height = Math.round(width * (meta.height / meta.width));
  return new ImageRun({
    type: 'png',
    data: readFileSync(path),
    transformation: { width, height },
  });
}

const p = (text, opts = {}) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 160, line: 276 },
  ...opts,
  children: [new TextRun({ text, font: FONT, size: 24, ...(opts.run || {}) })],
});

const rich = (runs, opts = {}) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 160, line: 276 },
  ...opts,
  children: runs.map((r) => new TextRun({ font: FONT, size: 24, ...r })),
});

const h1 = (text, { pageBreak = true, spaceBefore = 0 } = {}) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: spaceBefore, after: 320, line: 276 },
  pageBreakBefore: pageBreak,
  children: [new TextRun({ text, font: FONT, size: 32, bold: true, underline: {} })],
});

const h2 = (text, spaceBefore = 280) => new Paragraph({
  spacing: { before: spaceBefore, after: 140, line: 276 },
  keepNext: true,
  children: [new TextRun({ text, font: FONT, size: 24, bold: true, underline: {} })],
});

const plain = (text, opts = {}) => new Paragraph({
  spacing: { after: 0, line: 276 },
  ...opts,
  children: [new TextRun({ text, font: FONT, size: 24 })],
});

const label = (text) => new Paragraph({
  spacing: { before: 140, after: 60, line: 276 },
  keepNext: true,
  children: [new TextRun({ text, font: FONT, size: 24, bold: true })],
});

const bullet = (prefixRuns) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 100, line: 276 },
  indent: { left: 720, hanging: 260 },
  children: [
    new TextRun({ text: '•\t', font: FONT, size: 24 }),
    ...prefixRuns.map((r) => new TextRun({ font: FONT, size: 24, ...r })),
  ],
  tabStops: [{ type: TabStopType.LEFT, position: 720 }],
});

const numbered = (n, runs, { level = 1 } = {}) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 100, line: 276 },
  indent: { left: level === 1 ? 720 : 1440, hanging: 360 },
  children: [
    new TextRun({ text: `${n}.\t`, font: FONT, size: 24 }),
    ...runs.map((r) => new TextRun({ font: FONT, size: 24, ...r })),
  ],
  tabStops: [{ type: TabStopType.LEFT, position: level === 1 ? 720 : 1440 }],
});

const figure = async (path, caption, width = 4.8) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 80 },
    keepNext: true,
    children: [await img(path, width)],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 220, line: 240 },
    children: [new TextRun({ text: caption, font: FONT, size: 19, italics: true })],
  }),
];

const link = (label, url) => new ExternalHyperlink({
  link: url,
  children: [new TextRun({ text: label, font: FONT, size: 22, color: '1F5FAF', underline: {} })],
});

const refEntry = (num, name, text, url) => [
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 80, after: 30, line: 264 },
    indent: { left: 360, hanging: 360 },
    children: [
      new TextRun({ text: `${num}.\t`, font: FONT, size: 22 }),
      new TextRun({ text: name, font: FONT, size: 22, bold: true }),
      new TextRun({ text: ` — ${text}`, font: FONT, size: 22 }),
    ],
    tabStops: [{ type: TabStopType.LEFT, position: 360 }],
  }),
  ...(url ? [new Paragraph({
    spacing: { after: 80, line: 240 },
    indent: { left: 360 },
    children: [link(url, url)],
  })] : []),
];

const coverLine = (text, { bold = false, size = 24, before = 0, after = 0 } = {}) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before, after, line: 300 },
  children: [new TextRun({ text, font: FONT, size, bold })],
});

const tocMain = (text) => new Paragraph({
  spacing: { before: 140, after: 0, line: 300 },
  indent: { left: 720 },
  children: [new TextRun({ text, font: FONT, size: 23 })],
});

const tocSub = (text) => new Paragraph({
  spacing: { after: 0, line: 300 },
  indent: { left: 1440 },
  children: [new TextRun({ text, font: FONT, size: 23 })],
});

/* --------------------------------- content -------------------------------- */

const children = [];

// Cover
children.push(
  coverLine('CHATTERBOX', { bold: true, size: 48, before: 1000 }),
  coverLine('(A Real-Time Community Platform for Chat, Calls and Collaborative Files)', { size: 26, before: 80 }),
  coverLine('Synopsis for Project (ICS-654)', { size: 28, before: 900 }),
  coverLine('Bachelor of Technology', { bold: true, size: 26, before: 700 }),
  coverLine('in', { size: 24, before: 60 }),
  coverLine('Computer Science and Engineering', { bold: true, size: 26, before: 60 }),
  coverLine('Submitted by', { size: 24, before: 800 }),
  coverLine('2300520400012', { bold: true, size: 26, before: 260 }),
  coverLine('Anchal Patel (branch change)', { bold: true, size: 26, before: 60 }),
  coverLine('Under the guidance of', { size: 24, before: 800 }),
  coverLine('Dr. Pawan Kumar Tiwari', { bold: true, size: 26, before: 120 }),
  coverLine('Mr.Akash', { bold: true, size: 26, before: 60 }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 500, after: 300 },
    children: [await img('shots/iet-logo.png', 1.45)],
  }),
  coverLine('Department of Computer Science and Engineering', { size: 24, before: 300 }),
  coverLine('INSTITUTE OF ENGINEERING AND TECHNOLOGY', { size: 24 }),
  coverLine('Dr. A.P.J. Abdul Kalam Technical University Uttar Pradesh', { size: 24 }),
  coverLine('2025-2026', { bold: true, size: 24, before: 60 }),
);

// Acknowledgement
children.push(
  h1('Acknowledgement'),
  p('I express my sincere gratitude to the Almighty for the strength to complete this work, and to my project supervisor for continuous guidance, valuable suggestions and encouragement throughout the development of this project. The supervision shaped the technical direction of the work and improved the quality of every part of the system.'),
  p('I am also grateful to the faculty of the Department of Computer Science & Engineering for a supportive academic environment and the resources that helped me build it, and to my parents, family and friends for their constant motivation and support.'),
);

// Abstract
children.push(
  h1('Abstract'),
  rich([
    { text: 'Chatterbox', bold: true },
    { text: ' is a browser-based real-time communication platform that brings text, voice, video and collaborative file work into one lightweight workspace. A user can create an account, build a community server, invite others with a short code, and organise discussion into text and voice channels. Messages arrive instantly, threads keep side discussions attached, files can be attached to any message, presence and typing indicators show who is online, and a voice view places each participant in a live tile that can be replaced by a shared screen.' },
  ]),
  p('The platform runs on one Node.js service: an Express REST API for persistent data, a Socket.IO gateway for live events, and a PostgreSQL database with foreign keys and transactional integrity. Accounts use scrypt hashing, opaque bearer tokens and membership checks on every request and event. Audio and video travel directly between browsers over WebRTC, with the server acting only as a signalling relay. The same codebase runs on a Node host or as a single Vercel function, where Socket.IO uses the WebSocket transport and a PostgreSQL adapter shares events between instances. A shared workspace adds per-server project files in an integrated code editor; each file is either live, where edits stream immediately, or in review, where a contributor proposes a merge that other online members approve after inspecting a colour-coded line diff.'),
);

// Table of contents
children.push(
  h1('TABLE OF CONTENTS'),
  tocMain('1.  Introduction'),
  tocSub('1.1 Overview  ·  1.2 Objectives  ·  1.3 Scope'),
  tocSub('1.4 Methodology  ·  1.5 Contribution'),
  tocMain('2.  Related Works'),
  tocSub('2.1 Evolution of Real-Time Communication'),
  tocSub('2.2 Gaps and the Chatterbox Approach'),
  tocSub('2.3 Comparison with Existing Platforms'),
  tocMain('3.  Existing / Proposed Methodology'),
  tocSub('3.1 Technologies  ·  3.2 Limitations  ·  3.3 Proposed Method'),
  tocSub('3.4 System Architecture'),
  tocSub('3.5 Workflow  ·  3.6 Advantages'),
  tocMain('4.  Expected Results'),
  tocSub('4.1 Workspace, Messaging and Awareness'),
  tocSub('4.2 Voice, Video and Screen Sharing'),
  tocSub('4.3 Accounts, Security and Footprint'),
  tocSub('4.4 Project Workspace and Editor'),
  tocSub('4.5 Review-First Merging with Colour-Coded Diff'),
  tocSub('4.6 Threads, Attachments and Verification'),
  tocMain('5.  Conclusion'),
  tocSub('5.1 Future Scope  ·  5.2 Scope for Improvement'),
  tocMain('6.  References'),
);

// 1 Introduction
children.push(
  h1('1. Introduction'),
  h2('1.1 Overview of Real-Time Communication Platforms', 0),
  p('Online communities increasingly expect conversation, live calls and shared documents in the same place. Established platforms prove the interaction model — a server rail, channel list, message history, member panel and voice rooms — but they separate chat from media or require a hosted subscription. Small communities such as a student club therefore end up with three logins, three bills and three places to look for one discussion.'),
  h2('1.2 Purpose and Objectives of the Report'),
  bullet([{ text: 'Examine the motivation and the problem that led to Chatterbox.' }]),
  bullet([{ text: 'Analyse the conceptual and technical framework of the platform.' }]),
  bullet([{ text: 'Identify the challenges of WebSocket-based messaging and WebRTC-based media.' }]),
  bullet([{ text: 'Assess usability, security and social impact, and recommend future growth.' }]),
  h2('1.3 Scope of the Project'),
  bullet([{ text: 'Technical design integrating a REST API, a WebSocket event layer, a relational database and peer-to-peer media.' }]),
  bullet([{ text: 'Modules for accounts, sessions, servers and invites, text and voice channels, messaging, threads, attachments and calls with screen sharing.' }]),
  bullet([{ text: 'A shared workspace of project files with a syntax-highlighted editor and review-first merging backed by a coloured diff.' }]),
  bullet([{ text: 'A security model of scrypt hashing, opaque tokens and membership checks at every boundary, verified through multi-browser testing.' }]),
  h2('1.4 Research Methodology'),
  p('Primary data comes from hands-on prototyping, multi-browser usability tests and observations of message delivery and call setup, together with informal feedback from peers in the Department of Computer Science & Engineering at IET Lucknow. Secondary data covers official platform documentation, networking standards, security guidance and published analyses of existing products. Qualitative findings (interaction behaviour, clarity, engagement) are combined with quantitative observations (response latency, join time, database size, memory footprint).'),
  h2('1.5 Contribution of the Project'),
  p('Chatterbox contributes an integrated real-time stack in which one Node service handles authentication, persistent data, live events and media signalling, so text and calls share a single membership model. It adds a secure-by-default account design — scrypt hashing, opaque session tokens, and authorisation on every request and event — together with a plain, responsive interface built from native ES modules with no build step.'),
  p('Its most distinctive contribution is a review-first collaboration model for shared files. Each file carries its own mode: live files stream edits between members, while review files accept proposals that other online members approve or decline after inspecting a colour-coded line diff. Because the file creator alone changes the mode, a small permission rule makes collaborative editing predictable and auditable without a complex role system.'),
);

// 2 Related works
const cell = (text, { head = false, center = false } = {}) => new TableCell({
  shading: head ? { fill: '0B3A53' } : undefined,
  margins: { top: 70, bottom: 70, left: 110, right: 110 },
  children: [new Paragraph({
    alignment: center || head ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 0, line: 240 },
    children: [new TextRun({ text, font: FONT, size: 20, bold: head, color: head ? 'FFFFFF' : '000000' })],
  })],
});

const cmpRows = [
  ['Self-hostable, no per-seat fee for small groups', '✓', '—', '—', '✓'],
  ['Text and voice in one browser app, no install', '✓', '✓', '✓', '✓'],
  ['Presence, typing and threads', '✓', '✓', '✓', '✓'],
  ['Project workspace with an integrated code editor', '✓', '—', '—', '—'],
  ['Colour-coded diff before approving a merge', '✓', '—', '—', '—'],
  ['Single service and one PostgreSQL database', '✓', '—', '—', '—'],
  ['Open, auditable codebase', '✓', '—', '—', '✓'],
];

children.push(
  h1('2. Related Works'),
  h2('2.1 Evolution of Real-Time Communication', 0),
  p('Internet Relay Chat established channels as shared rooms with persistent connections and presence awareness. Voice over IP systems then added real-time audio but depended on separate clients, carefully configured servers and codec trade-offs that decide whether speech stays intelligible on weak links. Team chat platforms combined channels, searchable history and member lists into a workspace, and later added integrated voice. Browser-based media, standardised through WebRTC, finally removed the plugin: getUserMedia captures media, SDP offers and answers negotiate a session, ICE discovers a path, and DTLS-SRTP encrypts it by default.'),
  h2('2.2 Gaps and the Chatterbox Approach'),
  numbered(1, [{ text: 'Fragmentation between text and voice', bold: true }, { text: ' still forces separate applications and identities.' }]),
  numbered(2, [{ text: 'Dependence on hosted providers', bold: true }, { text: ' brings per-seat pricing and sends community data off-site.' }]),
  numbered(3, [{ text: 'Heavy clients and build tooling', bold: true }, { text: ' make a small deployment hard to audit or run on modest hardware.' }]),
  numbered(4, [{ text: 'Weak awareness and review features', bold: true }, { text: ' leave simple tools without typing, occupancy counts or controlled editing.' }]),
  p('Chatterbox closes these gaps by treating the community, the conversation and the call as one model: a server owns its members and channels, a message and a voice room both belong to a channel, and presence, typing and voice occupancy derive from the same socket connections that carry messages. The workspace extends the same membership rule to shared files.'),
  h2('2.3 Comparison with Existing Platforms'),
  p('The comparison below refers to the default consumer offering of each product, since enterprise and self-hosted editions vary.'),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'A9CBDD' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'A9CBDD' },
      left: { style: BorderStyle.SINGLE, size: 6, color: 'A9CBDD' },
      right: { style: BorderStyle.SINGLE, size: 6, color: 'A9CBDD' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CFE3EE' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CFE3EE' },
    },
    rows: [
      new TableRow({ tableHeader: true, children: ['Feature', 'Chatterbox', 'Discord', 'Slack', 'Element'].map((t) => cell(t, { head: true })) }),
      ...cmpRows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { center: i > 0 })) })),
    ],
  }),
  p('Chatterbox does not aim to match these products feature for feature. Its advantage is the combination of a unified text and media experience with a small, transparent, self-hosted implementation that a small team can run, read and extend.'),
);

// 3 Methodology
children.push(
  h1('3. Existing / Proposed Methodology'),
  h2('3.1 Background of the Technologies Used', 0),
  bullet([{ text: 'HTML5, CSS and ES Modules: ', bold: true }, { text: 'static client files with no bundler or UI framework.' }]),
  bullet([{ text: 'Socket.IO 4: ', bold: true }, { text: 'authenticated WebSocket connections, rooms, acknowledgements and reconnection.' }]),
  bullet([{ text: 'Node.js and Express 4: ', bold: true }, { text: 'the API, static assets and authentication middleware.' }]),
  bullet([{ text: 'PostgreSQL 18 (pg): ', bold: true }, { text: 'eleven tables with foreign keys, indices and ACID transactions.' }]),
  bullet([{ text: 'Vercel Functions and Blob: ', bold: true }, { text: 'an optional serverless entry for REST and WebSocket traffic, with object storage for uploads.' }]),
  bullet([{ text: 'scrypt and random tokens: ', bold: true }, { text: 'password hashing and opaque Bearer sessions.' }]),
  bullet([{ text: 'WebRTC with STUN: ', bold: true }, { text: 'peer-to-peer audio, video and screen tracks with DTLS-SRTP.' }]),
  h2('3.2 Existing Methods for Communication and Their Limitations'),
  bullet([{ text: 'IRC and simple chat: ', bold: true }, { text: 'no live voice, limited history and dated interfaces.' }]),
  bullet([{ text: 'Self-hosted voice servers: ', bold: true }, { text: 'separate installation, manual ports and no integrated communities.' }]),
  bullet([{ text: 'Hosted team chat: ', bold: true }, { text: 'per-seat pricing, off-site data and large clients with limited self-hosting.' }]),
  bullet([{ text: 'Video conferencing services: ', bold: true }, { text: 'separate rooms, outside terms and little control over the data model.' }]),
  h2('3.3 Proposed Methodology for Chatterbox'),
  label('i). Accounts and sessions.'),
  p('Registration hashes the password with scrypt and a unique salt. Sessions are 32-byte opaque tokens stored in the database and sent as Bearer credentials; they expire after 30 days and are revoked server-side on logout. The Socket.IO handshake authenticates with the same token, so live events cannot bypass login.'),
  label('ii). Servers, invites and membership.'),
  p('A server has an owner, an automatic general text channel and a voice channel, and an eight-character invite code. A membership table is consulted for every channel, message, file and voice action, and new members and channels propagate live to everyone connected to that server.'),
  label('iii). Messaging, threads and attachments.'),
  p('Messages are stored before they are broadcast, so later readers see the same order as live participants; the client loads the latest 50 and pages older ones with a cursor. Any message can root a thread, which keeps follow-up discussion out of the main channel. Files are uploaded through the composer, stored under a random name, recorded in the attachments table and served only to authenticated members.'),
  label('iv). Presence, typing and awareness.'),
  p('The server maps users to their active sockets and broadcasts presence transitions when the first connects or the last disconnects. Typing events are throttled and cleared by a timer. Unread markers, channel occupancy and the member panel are all derived from this awareness layer rather than polling.'),
  label('v). Voice, video and screen sharing.'),
  p('Joining a voice channel is an acknowledged event that returns the current occupants. Existing participants create the offer for each newcomer, who answers; ICE candidates queue until a remote description is set. A denied camera or microphone degrades to audio-only or listen-only. Screen sharing replaces the local camera track on every peer connection, including late joiners, with no additional infrastructure.'),
  label('vi). Workspace and review-first merging.'),
  p('Each server owns project files. Opening one joins a file room and enables an editor with syntax highlighting for JavaScript, C++, Java, Python and plain text. Live files exchange operations over the socket; review files keep drafts local until the member proposes a merge. Other online members become the voters; approving applies the content for everyone, declining closes the request, and the owner may merge immediately. Before voting, a client-side longest-common-subsequence diff colours added lines green and removed lines red. Only the creator can switch a file between modes, and the server rejects edits to review files and proposals on live files, so the rule is enforced at the boundary.'),
  h2('3.4 System Architecture (Schematic)'),
  rich([
    { text: 'User → Browser Client → Express REST API + Socket.IO Gateway → PostgreSQL → Broadcast to Server Rooms → WebRTC Peer Connection → Interface Update', bold: true },
  ], { alignment: AlignmentType.CENTER, spacing: { before: 100, after: 160, line: 276 } }),
  numbered(1, [{ text: 'Presentation layer. ', bold: true }, { text: 'One page renders the server rail, channel sidebar, message list, member panel and voice tiles, collapsing gracefully on narrow screens.' }]),
  numbered(2, [{ text: 'Application layer. ', bold: true }, { text: 'REST routes handle authentication and persistent queries; Socket.IO handles messaging, typing, presence, voice membership and signalling.' }]),
  numbered(3, [{ text: 'Data layer. ', bold: true }, { text: 'Users, sessions, servers, members, channels, messages, attachments, docs and merge tables live in a PostgreSQL database with foreign keys and transactional updates.' }]),
  numbered(4, [{ text: 'Media layer. ', bold: true }, { text: 'The server relays SDP and ICE; audio, video and screens remain direct, encrypted between browsers.' }]),
  ...(await figure('shots/diagrams/system-architecture.png', 'Figure 3.1  Layered architecture: one Node service for requests, events and signalling; media flows browser to browser.', 4.9)),
  p('The schema contains eleven tables. Users hold credentials and profile colour; sessions map tokens to users; servers record ownership and invite codes; server_members is the join table behind every authorisation check; channels store text and voice types with an ordering position; messages hold content, author, timestamp, an optional thread reference and an edit time; attachments link uploads to their message. The workspace adds docs for name, content, mode and creator; merge_requests for proposed content and status; and merge_voters plus merge_votes for the members who decide and the votes they cast. Presence, typing and voice occupancy stay in memory because they describe live connections rather than durable facts.'),
  ...(await figure('shots/diagrams/data-model.png', 'Figure 3.2  Relational data model: tables connected by foreign keys, plus in-memory maps for live state.', 4.9)),
  p('Deployment is a configuration of the same service rather than a second implementation. Locally, Node serves REST and WebSocket traffic from one process with uploads on disk. On Vercel, the server is exported as a single function: REST calls, health checks and the WebSocket upgrade share that entry, Socket.IO runs in WebSocket-only mode with a PostgreSQL adapter so rooms span instances, and uploads move to Vercel Blob when a store token is configured. Environment variables supply the database URL, TLS mode and optional TURN credentials, so no secret is committed to the repository.'),
  h2('3.5 Workflow of the Proposed System'),
  numbered(1, [{ text: 'Log in. ', bold: true }, { text: 'The server verifies the scrypt hash and issues an opaque session token.' }]),
  numbered(2, [{ text: 'Create or join a server. ', bold: true }, { text: 'A short invite code admits the member and updates everyone live.' }]),
  numbered(3, [{ text: 'Talk. ', bold: true }, { text: 'Opening a channel fetches history; sending stores and broadcasts; threads and attachments stay attached to their message.' }]),
  numbered(4, [{ text: 'Call. ', bold: true }, { text: 'Joining voice returns the occupants; offers, answers and candidates connect each pair; screen sharing replaces the camera track.' }]),
  numbered(5, [{ text: 'Work on a file. ', bold: true }, { text: 'Opening a project file joins its room; a live file streams edits, a review file keeps them local.' }]),
  numbered(6, [{ text: 'Review and merge. ', bold: true }, { text: 'Reviewers inspect the coloured diff, vote, and approval applies the proposal; the creator alone changes the mode.' }]),
  h2('3.6 Advantages of Proposed Methodology'),
  bullet([{ text: 'Unified model: ', bold: true }, { text: 'text, voice and files share one account, one membership and one interface.' }]),
  bullet([{ text: 'Portable and dependency-light: ', bold: true }, { text: 'one Node service and one PostgreSQL database serve the platform, on a host or on Vercel.' }]),
  bullet([{ text: 'Security at every boundary: ', bold: true }, { text: 'scrypt hashing, opaque tokens and membership checks on each request and event.' }]),
  bullet([{ text: 'Low latency: ', bold: true }, { text: 'socket rooms deliver changes only to the members who need them.' }]),
  bullet([{ text: 'Graceful degradation: ', bold: true }, { text: 'audio-only fallback, listen-only mode and automatic rejoin on reconnect.' }]),
  bullet([{ text: 'Review-first collaboration: ', bold: true }, { text: 'each file carries its own mode, and a coloured diff informs every merge decision.' }]),
);

// 4 Expected results
children.push(
  h1('4. Expected Results'),
  p('Based on the implemented architecture and tested behaviour, Chatterbox is expected to take a small community from a first conversation to a live call and a reviewed file without leaving the browser.'),
  h2('4.1 Workspace, Messaging and Awareness', 120),
  p('A single platform replaces the chat application, the voice server and the video tool: one account, one member list and one interface. Messages appear for other members within a fraction of a second without a refresh, with day dividers, author grouping within five minutes and compact editing. Expected outcomes include:'),
  bullet([{ text: 'Instant delivery to every member of the server, with edits and deletes reflected live.' }]),
  bullet([{ text: 'Paginated history that loads older messages on demand.' }]),
  bullet([{ text: 'Unread dots, a document-title counter and channel occupancy counts.' }]),
  bullet([{ text: 'Presence grouping, typing notices that expire automatically, and thread replies that stay in context.' }]),
  h2('4.2 Voice, Video and Screen Sharing'),
  p('Joining a voice channel is as simple as clicking its name. Each participant appears in a tile with connection status, and mute and camera controls are available in the call view and the sidebar dock. Imperfect conditions are anticipated: a denied camera yields an audio-only participant, a denied microphone a listen-only participant, and a reconnect returns the user to the same channel. Screen sharing replaces the local video on every peer, including late joiners, so the call continues while presenting.'),
  h2('4.3 Accounts, Security and Footprint'),
  p('Each user has a secure, personalised profile with safe login and logout, server-side session revocation and a stable avatar colour derived from the username. Membership is verified on every channel and event, so a user cannot read or join a server they have not joined. On the server side, PostgreSQL with indexed queries, prepared statements and pooled connections keeps history fast as the database grows, presence avoids unnecessary writes, and broadcasts stay within the affected server.'),
  h2('4.4 Project Workspace and Editor'),
  p('Every server provides a workspace of project files beside its conversation, each listed with a live or review badge. Opening a file loads a line-number gutter, a transparent text layer and a syntax-highlighted overlay, so C++, JavaScript, Java and Python read clearly without any build step. Files autosave with a short debounce, a language selector remembers manual choices, and a presence row shows who has the file open.'),
  ...(await figure('shots/project-editor.png', 'Figure 4.1  Project workspace: a live C++ file with syntax highlighting, line numbers, language selection and the live/review switch.', 4.6)),
  h2('4.5 Review-First Merging with Colour-Coded Diff'),
  p('Review mode turns collaboration into an explicit decision. A member edits locally, proposes a merge, and the other members who are online become its voters. Before voting, any reviewer expands a line diff computed in the browser: unchanged context is muted, added lines are green with a plus sign, removed lines are red with a minus sign, and a compact count summarises the change.'),
  bullet([{ text: 'Approve applies the proposal for everyone; Decline closes it without touching the file.' }]),
  bullet([{ text: 'The owner may merge immediately and is the only member who can switch the mode.' }]),
  bullet([{ text: 'The server rejects edits to review files and proposals on live files.' }]),
  bullet([{ text: 'The merge card appears in the channel and the file panel, with voter chips that update live.' }]),
  ...(await figure('shots/merge-diff.png', 'Figure 4.2  A pending merge expanded in colour: additions in green, deletions in red, with an addition and deletion summary before voting.', 4.6)),
  h2('4.6 Threads, Attachments and Verification'),
  p('Threads keep follow-up discussion attached to its context while the main channel holds its reading flow. Attachments are stored under a random name, checked for membership on download and opened directly in the editor when they are text-like. Two independent browser sessions confirmed the expected behaviour end to end: instant messaging and live edits, typing and presence, two-way video, screen sharing, threaded replies, attachment delivery and two-user merge approval backed by the diff preview. PostgreSQL persistence, the Vercel entry point and the WebSocket-only handshake were verified separately before documentation.'),
  ...(await figure('shots/threads.png', 'Figure 4.3  Threaded replies: the parent stays in the channel while the thread panel keeps the side discussion in context.', 4.4)),
  p('In essence, Chatterbox becomes a shared workspace for conversation and community: a low-cost alternative to hosted platforms and a clear reference for how REST, WebSocket events, relational storage and peer-to-peer media work together.'),
);

// 5 Conclusion
children.push(
  h1('5. Conclusion'),
  p('Chatterbox shows how open web technologies can solve the everyday problem of keeping a small community connected. Built with Express, Socket.IO, PostgreSQL and WebRTC, it creates one interactive system in which text, threads, shared files and live calls belong to the same experience. Each phase — requirement analysis, database design, interface construction, signalling, collaborative editing, testing and documentation — shaped the final prototype, and the work became a hands-on study of stateful interfaces, relational modelling, authorised APIs, the WebRTC offer/answer flow and a diff-driven merge workflow.'),
  p('The project also shows the value of keeping systems small. Because each layer has a narrow responsibility, behaviour such as presence, reconnection and merge approval can be reasoned about and tested directly, and the whole platform can be backed up from one managed database.'),
  h2('5.1 Future Scope'),
  numbered(1, [{ text: 'TURN relay and larger calls', bold: true }, { text: ' for peers behind restrictive NATs, and an SFU mode beyond the small mesh.' }]),
  numbered(2, [{ text: 'Recording and live streaming', bold: true }, { text: ' built on the existing screen-share path.' }]),
  numbered(3, [{ text: 'Roles, moderation and audit logs', bold: true }, { text: ' for community administration.' }]),
  numbered(4, [{ text: 'Mobile and desktop clients', bold: true }, { text: ' through a progressive web app and native shells with notifications.' }]),
  h2('5.2 Scope for Improvement'),
  bullet([{ text: 'Message search, storage quotas and attachment previews.' }]),
  bullet([{ text: 'Automated tests for API, socket, sequential-edit and merge-approval flows, plus rate limiting on login and invites.' }]),
  bullet([{ text: 'Accessibility improvements and container or serverless deployment (Docker, Vercel) with backups and migrations.' }]),
);

// 6 References
children.push(
  h1('6. References'),
  h2('6.1 Standards and Platform Documentation', 0),
  ...refEntry(1, 'MDN Web Docs — WebRTC API', 'getUserMedia, RTCPeerConnection, offers, answers and ICE candidates.', 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API'),
  ...refEntry(2, 'Socket.IO Documentation', 'Rooms, acknowledgements, authentication middleware and reconnection.', 'https://socket.io/docs/v4/'),
  ...refEntry(3, 'Express', 'Minimal web framework used for the REST API and static files.', 'https://expressjs.com/'),
  ...refEntry(4, 'PostgreSQL Documentation — Transactions', 'ACID guarantees and isolation levels used by the project database.', 'https://www.postgresql.org/docs/current/transaction-iso.html'),
  ...refEntry(5, 'node-postgres (pg)', 'Connection pooling, parameterized queries and TLS for PostgreSQL.', 'https://node-postgres.com/'),
  ...refEntry(6, 'Vercel — WebSockets on Functions', 'Pinned connections, WebSocket-only transport and function duration limits used by the deployed gateway.', 'https://vercel.com/docs/functions/websockets'),
  h2('6.2 Research and Best Practices'),
  ...refEntry(1, 'W3C — WebRTC: Real-Time Communication in Browsers', 'W3C Recommendation, January 2021.', 'https://www.w3.org/TR/webrtc/'),
  ...refEntry(2, 'OWASP — Password Storage Cheat Sheet', 'Salting and memory-hard password hashing, including scrypt parameters.', 'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html'),
  ...refEntry(3, 'RFC 8825 — Overview: Real-Time Protocols for Browser-Based Applications', 'Architectural overview of WebRTC protocols and security.', 'https://www.rfc-editor.org/rfc/rfc8825'),
  ...refEntry(4, 'MDN — Establishing a Peer Connection', 'Sequencing of offers, answers and ICE candidates.', 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity'),
  ...refEntry(5, 'Myers, E. W. — An O(ND) Difference Algorithm and Its Variations', 'Algorithmica, 1986. Foundation for the line diff used by the merge preview.', null),
  h2('6.3 Products and Project Sources'),
  ...refEntry(1, 'Discord — Product Documentation', 'Servers, channels, voice rooms and presence that informed the interaction model.', 'https://support.discord.com/'),
  ...refEntry(2, 'Slack — Product Documentation', 'Workspace and channel structure, search and notification patterns.', 'https://slack.com/help'),
  ...refEntry(3, 'Chatterbox Source and Project Synopsis Format', 'Server, client and workspace code; Department of CSE, IET Lucknow (ICS-654).', null),
);

// Document
const doc = new Document({
  creator: 'Chatterbox Project',
  title: 'Chatterbox — Project Synopsis',
  description: 'Synopsis for Project (ICS-654)',
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24, color: INK },
        paragraph: { spacing: { line: 276 } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })],
        })],
      }),
    },
    children,
  }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('deliverables/Chatterbox_Project_Synopsis.docx', buffer);
console.log('report written', buffer.length, 'bytes');
