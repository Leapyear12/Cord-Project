import puppeteer from 'puppeteer-core';
import path from 'node:path';

const BASE = 'http://localhost:4599';
const OUT = 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

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
  return page;
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

// --- attachments: upload and send ------------------------------------------
const anchal = await openApp(browser, 'anchal');
const input = await anchal.$('#file-input');
await input.uploadFile(path.resolve('shots/feeds/release-notes.md'));
await sleep(1500);
await anchal.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('composer')?.requestSubmit();
  await wait(1500);
});
await anchal.screenshot({ path: `${OUT}/files.png` });
console.log('files shot');

// --- second user proposes a merge -----------------------------------------
const meera = await openApp(browser, 'meera');
await openDoc(meera, 'project-plan.md');
await meera.evaluate(async () => {
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
await sleep(1000);

// --- owner expands the diff with room for it ------------------------------
await openDoc(anchal, 'project-plan.md');
await anchal.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30 && !document.querySelector('#project-merges .project-merge'); i++) await wait(300);
  const btn = [...document.querySelectorAll('#project-merges button')].find((b) => b.textContent === 'View changes');
  btn?.click();
  await wait(500);
  const style = document.createElement('style');
  style.textContent = '.code-editor { flex: none; height: 200px; } #project-merges { max-height: none; overflow: visible; } .diff-body { max-height: none; }';
  document.head.append(style);
  await wait(500);
});
await anchal.screenshot({ path: `${OUT}/merge-diff.png` });
console.log('diff shot');

await anchal.evaluate(() => {
  const decline = [...document.querySelectorAll('#project-merges button')].find((b) => b.textContent === 'Decline');
  decline?.click();
});

await browser.close();
console.log('done');
