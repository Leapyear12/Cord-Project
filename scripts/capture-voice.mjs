import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4599';
const PASS = 'cord1234';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

async function newUserContext(username) {
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
  await sleep(400);
  return page;
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
  const camBtn = await page.$('#voice-cam');
  if (camBtn) {
    const label = await camBtn.evaluate((el) => el.textContent);
    if (label === 'Camera off') await camBtn.click();
  }
}

const aarav = await newUserContext('aarav');
await joinLounge(aarav);
await sleep(1500);

const meera = await newUserContext('meera');
await joinLounge(meera);

await meera.waitForFunction(
  () => document.querySelectorAll('#voice-tiles .voice-tile').length >= 2,
  { timeout: 20000 },
);
await sleep(5000);
await meera.screenshot({ path: `${OUT}/voice.png` });
await aarav.screenshot({ path: `${OUT}/voice-aarav.png` });
console.log('voice screenshots done');
await browser.close();
