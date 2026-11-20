import puppeteer from 'puppeteer-core';
import path from 'node:path';

const BASE = 'http://localhost:4599';
const OUT = 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const CPP = `// algorithms.cpp — Chatterbox demo file
#include <bits/stdc++.h>
using namespace std;

struct Member {
    string name;
    int messages;
};

// Prefix sums of message counts across a community
vector<long long> buildPrefix(const vector<Member>& members) {
    vector<long long> prefix(members.size() + 1, 0);
    for (size_t i = 0; i < members.size(); i++) {
        prefix[i + 1] = prefix[i] + members[i].messages;
    }
    return prefix;
}

int main() {
    vector<Member> team = {
        {"anchal", 128}, {"meera", 96}, {"kabir", 74}, {"ishita", 61},
    };
    auto prefix = buildPrefix(team);
    // Range query: messages contributed by members 1..2 (zero-based)
    cout << prefix[3] - prefix[1] << " messages\\n";
    sort(team.begin(), team.end(), [](const Member& a, const Member& b) {
        return a.messages > b.messages;
    });
    for (const auto& m : team) cout << m.name << ": " << m.messages << "\\n";
    return 0;
}
`;

const PLAN = `# Project plan — Chatterbox

The team is preparing the ICS-654 review of the Chatterbox platform.

## Milestones

- [x] Authentication, sessions and profiles
- [x] Servers, invite codes and channels
- [x] Realtime messaging, presence and typing
- [x] Voice and video rooms with screen sharing
- [x] Threads and file attachments
- [ ] Final report and presentation

## Open questions

How should large files be previewed inside the workspace?
Which languages deserve first-class highlighting next?
`;

const fakeDisplay = () => {
  const media = navigator.mediaDevices;
  if (!media) return;
  media.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let tick = 0;
    setInterval(() => {
      tick += 1;
      const g = ctx.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, '#0d2b3e');
      g.addColorStop(1, '#16324f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#e8e9ec';
      ctx.font = 'bold 44px Segoe UI';
      ctx.fillText('Chatterbox — live project review', 90, 250);
      ctx.fillStyle = '#9fc4e8';
      ctx.font = '26px Consolas';
      ctx.fillText('auto prefix = buildPrefix(team);', 90, 330);
      ctx.fillText('cout << prefix[3] - prefix[1];', 90, 376);
      ctx.fillStyle = '#6ecf92';
      ctx.fillRect(90, 640 - (tick % 40), 1100, 5);
    }, 120);
    return canvas.captureStream(12);
  };
};

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture=' + path.resolve('shots/feeds/aarav.y4m'),
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

async function openApp(browser, username) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(fakeDisplay);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#auth-form');
  await page.evaluate((u, p) => {
    document.getElementById('auth-username').value = u;
    document.getElementById('auth-username').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('auth-password').value = p;
    document.getElementById('auth-password').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('auth-form').requestSubmit();
  }, username, 'cord1234');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForSelector('#rail-servers .rail-btn[title="Chatterbox HQ"]', { timeout: 15000 });
  await page.click('#rail-servers .rail-btn[title="Chatterbox HQ"]');
  await page.waitForSelector('#text-channels .channel-row', { timeout: 15000 });
  await sleep(800);
  return { page, context };
}

async function token(page) {
  return page.evaluate(() => localStorage.getItem('cord_token'));
}

async function createDoc(page, name, content) {
  const t = await token(page);
  const res = await fetch(`${BASE}/api/servers/3/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ name, content }),
  });
  return res.json();
}

async function openDoc(page, name) {
  await page.evaluate(async (docName) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('open-project')?.click();
    for (let i = 0; i < 30 && document.getElementById('project-view')?.hidden; i++) await wait(150);
    for (let attempt = 0; attempt < 30; attempt++) {
      const row = [...document.querySelectorAll('#project-doc-list .channel-row')].find((r) => r.textContent.includes(docName));
      if (row) { row.click(); return; }
      await wait(200);
    }
  }, name);
  await sleep(1200);
}

const browser = await launch();
const anchal = await openApp(browser, 'anchal');
const page = anchal.page;

// --- seed workspace files ---------------------------------------------------
await createDoc(page, 'algorithms.cpp', CPP);
await createDoc(page, 'project-plan.md', PLAN);
await sleep(800);

// --- threads ----------------------------------------------------------------
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = [...document.querySelectorAll('#text-channels .channel-row')].find((r) => r.textContent.includes('general'));
  row?.click();
  await wait(900);
  const messages = [...document.querySelectorAll('#messages .msg')];
  const target = messages[messages.length - 1] || messages[0];
  const threadBtn = target?.querySelector('.msg-actions button[data-action="thread"]');
  threadBtn?.click();
  await wait(700);
});
const reply = async (text) => {
  await page.evaluate(async (t) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const input = document.getElementById('thread-input');
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('thread-composer').requestSubmit();
    await wait(900);
  }, text);
};
await reply('Moved the thread discussion here so #general stays readable.');
await reply('Agreed — I will collect the open questions and bring them to the review.');
await sleep(600);
await page.screenshot({ path: `${OUT}/threads.png` });
console.log('threads shot');

// --- attachments ------------------------------------------------------------
await page.evaluate(() => document.getElementById('thread-close')?.click());
await sleep(400);
const fileInput = await page.$('#file-input');
await fileInput.uploadFile(path.resolve('shots/feeds/release-notes.md'));
await sleep(2500);
await page.evaluate(() => {
  const box = document.getElementById('messages');
  if (box) box.scrollTop = box.scrollHeight;
});
await page.screenshot({ path: `${OUT}/files.png` });
console.log('files shot');

// --- project editor (live C++) ---------------------------------------------
await openDoc(page, 'algorithms.cpp');
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lang = document.getElementById('editor-language');
  lang.value = 'cpp';
  lang.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('mode-live')?.click();
  await wait(1200);
});
await page.screenshot({ path: `${OUT}/project-editor.png` });
console.log('editor shot');

// --- review file ------------------------------------------------------------
await openDoc(page, 'project-plan.md');
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lang = document.getElementById('editor-language');
  lang.value = 'plain';
  lang.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(400);
});
await page.screenshot({ path: `${OUT}/project-review.png` });
console.log('review shot');

// --- second user proposes a merge on the review file -----------------------
const meera = await openApp(browser, 'meera');
const mp = meera.page;
await openDoc(mp, 'project-plan.md');
await mp.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const area = document.getElementById('editor-textarea');
  let text = area.value;
  text = text.replace('- [ ] Final report and presentation', '- [x] Final report and presentation');
  text = text.replace(
    'How should large files be previewed inside the workspace?',
    'How should large files be previewed inside the workspace?\nShould diffs highlight changed words or whole lines only?',
  );
  text += '\n## Reviewer note\n\nReady for the ICS-654 review once the deck is finalised.\n';
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(500);
  document.getElementById('btn-propose')?.click();
  await wait(1500);
});
await sleep(1200);

// --- owner expands the diff -------------------------------------------------
await openDoc(page, 'project-plan.md');
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30 && !document.querySelector('#project-merges .project-merge'); i++) await wait(300);
  const btn = [...document.querySelectorAll('#project-merges button')].find((b) => b.textContent === 'View changes');
  btn?.click();
  await wait(700);
});
await page.screenshot({ path: `${OUT}/merge-diff.png` });
console.log('diff shot');

// --- screen sharing ---------------------------------------------------------
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('project-close')?.click();
  await wait(500);
  const row = [...document.querySelectorAll('#voice-channels .channel-row')].find((r) => r.textContent.includes('Lounge'));
  row?.click();
  await wait(2500);
  document.getElementById('voice-screen')?.click();
  await wait(2500);
});
await page.screenshot({ path: `${OUT}/screenshare.png` });
console.log('screenshare shot');

// --- cleanup: decline the test merge ---------------------------------------
try {
  await page.evaluate(() => {
    const decline = [...document.querySelectorAll('#project-merges button')].find((b) => b.textContent === 'Decline');
    decline?.click();
  });
} catch {}

await browser.close();
console.log('done');
