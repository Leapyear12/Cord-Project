import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

mkdirSync('shots/diagrams', { recursive: true });

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif; color: #0b3a53; }
  .canvas { position: relative; padding: 0; }
  .head { font-weight: 700; letter-spacing: .04em; }
  .box { position: absolute; border-radius: 10px; display: flex; flex-direction: column;
         align-items: center; justify-content: center; text-align: center; }
  .title { font-weight: 700; letter-spacing: .02em; }
  .sub { font-size: 12px; color: #43677a; }
  .chip { display: inline-block; border-radius: 999px; padding: 3px 10px; font-size: 11px;
          font-weight: 600; margin: 2px; }
  .arrow { position: absolute; background: #8fb6c9; }
  .arrow-label { position: absolute; font-size: 11px; color: #51788c; background: #fff; padding: 0 4px; }
  .diamond { position: absolute; width: 0; height: 0; }
  .side { position: absolute; width: 0; height: 0;
          border-left: 90px solid transparent; border-right: 90px solid transparent;
          border-bottom: 90px solid #cfe4f0; }
`;

function page(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
    <body><div class="canvas">${html}</div></body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});

async function shot(name, width, height, html, scale = 2) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: scale });
  await p.setContent(page(html), { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 250));
  await p.screenshot({ path: `shots/diagrams/${name}.png` });
  await p.close();
  console.log('diagram', name);
}

/* 1. System architecture — layered */
await shot('system-architecture', 1248, 808, `
  <div style="position:absolute;left:0;top:0;width:1200px;height:760px;">
    <div style="position:absolute;left:48px;top:38px;font-size:30px;font-weight:700;letter-spacing:.04em;">SYSTEM ARCHITECTURE</div>
    <div style="position:absolute;left:50px;top:80px;font-size:14px;color:#5b7f92;">Chatterbox — real-time community platform</div>
  </div>

  <!-- Client -->
  <div class="box" style="left:48px;top:128px;width:1104px;height:128px;background:#eaf4fa;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:18px;">CLIENT LAYER · Browser (HTML + CSS + ES Modules)</div>
    <div style="margin-top:10px;">
      <span class="chip" style="background:#fff;border:1px solid #b9d7e8;">Auth &amp; Server Rail</span>
      <span class="chip" style="background:#fff;border:1px solid #b9d7e8;">Text Channels &amp; Messages</span>
      <span class="chip" style="background:#fff;border:1px solid #b9d7e8;">Voice / Video Tiles</span>
      <span class="chip" style="background:#fff;border:1px solid #b9d7e8;">Presence &amp; Typing</span>
    </div>
  </div>

  <!-- Arrow 1 -->
  <div class="arrow" style="left:600px;top:262px;width:3px;height:34px;"></div>
  <div class="arrow-label" style="left:614px;top:267px;">HTTPS / REST · JSON</div>
  <div class="arrow" style="left:566px;top:262px;width:3px;height:34px;"></div>
  <div class="arrow-label" style="left:432px;top:267px;">Socket.IO events · WSS</div>

  <!-- Application -->
  <div class="box" style="left:48px;top:302px;width:1104px;height:150px;background:#f7fbfd;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:18px;">APPLICATION LAYER · Node.js server</div>
    <div style="display:flex;gap:14px;margin-top:14px;">
      <div class="box" style="position:relative;width:330px;height:82px;background:#dcecf3;border:1.5px solid #a9cbdd;">
        <div class="title">Express REST API</div>
        <div class="sub">auth · servers · channels · messages · files · docs · merges</div>
      </div>
      <div class="box" style="position:relative;width:330px;height:82px;background:#dcecf3;border:1.5px solid #a9cbdd;">
        <div class="title">Socket.IO Gateway</div>
        <div class="sub">rooms · broadcast · typing · presence · signals</div>
      </div>
      <div class="box" style="position:relative;width:330px;height:82px;background:#dcecf3;border:1.5px solid #a9cbdd;">
        <div class="title">Auth &amp; Sessions</div>
        <div class="sub">scrypt hashing · opaque Bearer tokens</div>
      </div>
    </div>
  </div>

  <!-- Arrow 2 -->
  <div class="arrow" style="left:600px;top:458px;width:3px;height:34px;"></div>
  <div class="arrow-label" style="left:614px;top:463px;">parameterized SQL · transactions</div>

  <!-- Data -->
  <div class="box" style="left:48px;top:498px;width:1104px;height:110px;background:#eaf4fa;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:18px;">DATA LAYER · PostgreSQL database</div>
    <div class="sub" style="font-size:13px;margin-top:6px;">users · sessions · servers · members · channels · messages · attachments</div>
    <div class="sub" style="font-size:13px;margin-top:2px;">docs · merge_requests · merge_voters · merge_votes</div>
    <div class="sub" style="margin-top:4px;">foreign keys · ACID transactions · indices on channel and member lookups</div>
  </div>

  <!-- Media -->
  <div class="box" style="left:48px;top:634px;width:1104px;height:96px;background:#0b3a53;color:#fff;border:2px solid #0b3a53;">
    <div class="title" style="font-size:18px;">MEDIA LAYER · WebRTC mesh (browser to browser)</div>
    <div class="sub" style="color:#bcd9e8;margin-top:6px;font-size:13px;">STUN discovery · SDP offer / answer · ICE candidates · DTLS-SRTP media · no media server required</div>
  </div>
`);

/* 2. Technical architecture — request and realtime flows */
await shot('technical-architecture', 1148, 768, `
  <div style="position:absolute;left:40px;top:32px;font-size:26px;font-weight:700;letter-spacing:.04em;">TECHNICAL ARCHITECTURE</div>

  <!-- Client column -->
  <div class="box" style="left:40px;top:108px;width:230px;height:190px;background:#eaf4fa;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:15px;">Browser Client</div>
    <div class="sub" style="margin-top:8px;line-height:1.8;">app.js · UI state<br/>voice.js · WebRTC<br/>socket.io client</div>
  </div>
  <div class="box" style="left:40px;top:330px;width:230px;height:140px;background:#f7fbfd;border:2px dashed #a9cbdd;">
    <div class="title" style="font-size:15px;">Second Browser</div>
    <div class="sub" style="margin-top:8px;">peers in the same voice channel</div>
  </div>

  <!-- Server -->
  <div class="box" style="left:430px;top:92px;width:280px;height:238px;background:#0b3a53;color:#fff;border:2px solid #0b3a53;">
    <div class="title" style="font-size:17px;">Chatterbox Server</div>
    <div class="sub" style="color:#bcd9e8;margin-top:10px;line-height:1.9;">Express middleware → REST routes<br/>Socket.IO namespaces &amp; rooms<br/>authorization on every request<br/>in-memory presence and voice maps</div>
  </div>

  <!-- DB -->
  <div class="box" style="left:860px;top:108px;width:200px;height:120px;background:#eaf4fa;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:15px;">PostgreSQL</div>
    <div class="sub" style="margin-top:6px;">managed database</div>
  </div>
  <div class="box" style="left:860px;top:260px;width:200px;height:110px;background:#f7fbfd;border:2px solid #b9d7e8;">
    <div class="title" style="font-size:15px;">STUN</div>
    <div class="sub" style="margin-top:6px;font-size:11px;">stun.l.google.com<br/>used by browsers during ICE</div>
  </div>

  <!-- Arrows horizontal -->
  <div class="arrow" style="left:272px;top:150px;width:154px;height:3px;"></div>
  <div class="arrow-label" style="left:280px;top:128px;">REST /api · Bearer</div>
  <div class="arrow" style="left:272px;top:196px;width:154px;height:3px;"></div>
  <div class="arrow-label" style="left:280px;top:202px;">Socket.IO events</div>
  <div class="arrow" style="left:712px;top:160px;width:144px;height:3px;"></div>
  <div class="arrow-label" style="left:734px;top:138px;">SQL</div>

  <!-- WebRTC link -->
  <div class="box" style="left:110px;top:510px;width:600px;height:92px;background:#dcecf3;border:2px solid #a9cbdd;">
    <div class="title" style="font-size:16px;">WebRTC peer connection (audio + video)</div>
    <div class="sub" style="margin-top:6px;">offer / answer relayed by the server through voice:signal · mesh topology, one connection per pair</div>
  </div>

  <div class="sub" style="position:absolute;left:110px;top:626px;font-size:13px;color:#51788c;">
    Presence is derived from the socket registry. Messages are persisted before they are broadcast; media never passes through the server.
  </div>
`);

/* 3. Workflow */
await shot('workflow', 1288, 400, `
  <div style="position:absolute;left:0;top:0;font-size:22px;font-weight:700;">WORKFLOW OF THE PROPOSED SYSTEM</div>
  ${[
    ['1', 'Register or log in', 'scrypt check → session token'],
    ['2', 'Create or join a server', 'invite code · 8 hex chars'],
    ['3', 'Open a text channel', 'REST fetch · 50 messages'],
    ['4', 'Send a message', 'persist → broadcast to members'],
    ['5', 'Join a voice channel', 'Socket.IO ack · peer list'],
    ['6', 'Connect media', 'SDP offer / answer + ICE'],
  ].map(([n, t, s], i) => `
    <div class="box" style="left:${i * 204}px;top:56px;width:180px;height:170px;background:${i === 3 ? '#0b3a53' : '#eaf4fa'};border:2px solid ${i === 3 ? '#0b3a53' : '#b9d7e8'};color:${i === 3 ? '#fff' : '#0b3a53'};">
      <div style="width:34px;height:34px;border-radius:50%;background:${i === 3 ? '#bcd9e8' : '#0b3a53'};color:${i === 3 ? '#0b3a53' : '#fff'};display:flex;align-items:center;justify-content:center;font-weight:700;">${n}</div>
      <div class="title" style="margin-top:10px;font-size:14px;">${t}</div>
      <div class="sub" style="margin-top:8px;font-size:11px;color:${i === 3 ? '#bcd9e8' : '#51788c'};">${s}</div>
    </div>
    ${i < 5 ? `<div style="position:absolute;left:${i * 204 + 182}px;top:132px;font-size:18px;color:#8fb6c9;">→</div>` : ''}
  `).join('')}
`);

/* 4. Data model (ERD) */
const table = (name, x, y, cols, w = 250) => `
  <div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;border:1.5px solid #a9cbdd;border-radius:8px;overflow:hidden;background:#fff;">
    <div style="background:#0b3a53;color:#fff;padding:6px 10px;font-weight:700;font-size:13px;">${name}</div>
    ${cols.map((c) => `<div style="padding:3px 10px;font-size:11.5px;border-top:1px solid #eef5f9;">${c}</div>`).join('')}
  </div>`;

await shot('data-model', 1250, 750, `
  <div style="position:absolute;left:0;top:0;font-size:20px;font-weight:700;">RELATIONAL DATA MODEL</div>
  ${table('users', 10, 48, ['id · INTEGER PK', 'username · UNIQUE', 'salt, hash', 'color, created_at'])}
  ${table('servers', 330, 48, ['id · INTEGER PK', 'name, owner_id → users', 'invite_code · UNIQUE'])}
  ${table('channels', 660, 48, ['id · INTEGER PK', 'server_id → servers.id', 'name, type (text | voice)', 'position'])}
  ${table('attachments', 960, 48, ['id · INTEGER PK', 'message_id → messages.id', 'channel_id, uploaded_by', 'name, mime, size, stored_name'])}
  ${table('sessions', 10, 200, ['token · TEXT PK', 'user_id → users.id', 'created_at'])}
  ${table('server_members', 330, 200, ['server_id → servers.id', 'user_id → users.id', 'joined_at', 'PK (server_id, user_id)'])}
  ${table('messages', 660, 200, ['id · INTEGER PK', 'channel_id → channels.id', 'user_id → users.id', 'content · 1–2000 chars', 'thread_id → messages.id', 'created_at, edited_at'])}
  ${table('docs', 960, 200, ['id · INTEGER PK', 'server_id → servers.id', 'name, content', 'mode (live | review)', 'created_by → users.id', 'updated_at, updated_by'])}
  ${table('merge_requests', 330, 400, ['id · INTEGER PK', 'doc_id → docs.id', 'content (proposal)', 'status, created_at', 'resolved_at'])}
  ${table('Presence &amp; voice (in memory)', 960, 420, ['userSockets: Map&lt;userId, Set&lt;socketId&gt;&gt;', 'voiceChannels: Map&lt;channelId, occupants&gt;', 'docCache: Map&lt;docId, content | rev&gt;', 'rebuilt from socket connect / disconnect'], 250)}
  ${table('merge_voters', 330, 560, ['request_id → merge_requests.id', 'user_id → users.id', 'PK (request_id, user_id)'], 250)}
  ${table('merge_votes', 660, 560, ['request_id → merge_requests.id', 'user_id → users.id', 'vote (approve | reject)', 'created_at'], 250)}
  <div style="position:absolute;left:10px;top:712px;font-size:12px;color:#51788c;">Foreign keys enforce that every session, server, channel, message, file, document and merge belongs to an existing parent row.</div>
`);

/* 5. Benefits mindmap for PPT slide 5 */
await shot('benefits-map', 898, 470, `
  <style>
    .leaf { position:absolute; width:118px; height:58px; border-radius:8px; display:flex; align-items:center;
            justify-content:center; font-weight:700; font-size:15px; color:#0b3a53; }
    .stem { position:absolute; background:#a9cbdd; }
  </style>
  <div class="box" style="left:300px;top:16px;width:250px;height:64px;background:#0b3a53;color:#fff;">
    <div class="title" style="font-size:17px;">Benefits of Chatterbox</div>
  </div>
  <div class="stem" style="left:424px;top:80px;width:3px;height:56px;"></div>
  <div class="stem" style="left:128px;top:136px;width:594px;height:3px;"></div>
  ${[
    ['Real-time chat', 70, '#dcecf3'],
    ['Voice &amp; video', 218, '#c9e0ec'],
    ['Presence', 366, '#dcecf3'],
    ['Low cost', 514, '#c9e0ec'],
    ['Simple UX', 662, '#dcecf3'],
  ].map(([t, x, c]) => `
    <div class="stem" style="left:${x + 59}px;top:136px;width:3px;height:34px;"></div>
    <div class="leaf" style="left:${x}px;top:170px;background:${c};border:1.5px solid #a9cbdd;">${t}</div>
  `).join('')}
  <div class="sub" style="position:absolute;left:82px;top:262px;width:730px;text-align:center;font-size:13px;line-height:1.7;">
    One shared workspace for conversation, community and live calls —<br/>
    no app installs, no per-seat licences, no external chat or media service.
  </div>
`);

await browser.close();
console.log('diagrams done');
