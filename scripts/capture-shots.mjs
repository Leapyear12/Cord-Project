import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:4599';
const PASS = 'cord1234';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const mediaArgs = (feed) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${path.resolve('shots/feeds', feed + '.y4m')}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

async function launch(feed) {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: mediaArgs(feed) });
}

async function login(browser, username) {
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
  }, username, PASS);
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForSelector('#rail-servers .rail-btn[title="Chatterbox HQ"]', { timeout: 15000 });
  await page.click('#rail-servers .rail-btn[title="Chatterbox HQ"]');
  await page.waitForSelector('.msg', { timeout: 15000 });
  await sleep(500);
  return page;
}

async function openTextChannel(page, name) {
  const rows = await page.$$('#text-channels .channel-row');
  for (const b of rows) {
    const text = await b.evaluate((el) => el.textContent);
    if (text.includes(name)) {
      await b.click();
      break;
    }
  }
  await sleep(700);
}

async function joinLounge(page) {
  const buttons = await page.$$('#voice-channels .channel-row');
  for (const b of buttons) {
    const text = await b.evaluate((el) => el.textContent);
    if (text.includes('Lounge')) {
      await b.click();
      break;
    }
  }
  await page.waitForSelector('#voice-view:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const t = document.getElementById('voice-status')?.textContent || '';
      return t && !t.startsWith('Connecting');
    },
    { timeout: 20000 },
  );
  await sleep(600);
}

const browserA = await launch('aarav');
const aarav = await login(browserA, 'aarav');
const kabir = await login(browserA, 'kabir');
const ishita = await login(browserA, 'ishita');

const browserM = await launch('meera');
const meera = await login(browserM, 'meera');
await sleep(800);

await meera.screenshot({ path: `${OUT}/chat-general.png` });

await meera.click('#btn-invite');
await meera.waitForSelector('dialog[open]', { timeout: 5000 });
await sleep(400);
await meera.screenshot({ path: `${OUT}/invite.png` });
await meera.evaluate(() => document.getElementById('dlg-invite').close());

await openTextChannel(meera, 'design');
await meera.screenshot({ path: `${OUT}/chat-design.png` });

await joinLounge(aarav);
await sleep(1200);
await joinLounge(meera);
await meera.waitForFunction(
  () => document.querySelectorAll('#voice-tiles .voice-tile').length >= 2,
  { timeout: 20000 },
);
await sleep(2500);
await meera.screenshot({ path: `${OUT}/voice.png` });
await aarav.screenshot({ path: `${OUT}/voice-aarav.png` });

console.log('all screenshots done');
await browserA.close();
await browserM.close();
