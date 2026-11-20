import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4599';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.waitForSelector('#auth-form');
await page.evaluate(() => {
  document.getElementById('auth-username').value = 'anchal';
  document.getElementById('auth-username').dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('auth-password').value = 'cord1234';
  document.getElementById('auth-password').dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('auth-form').requestSubmit();
});
await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
await page.waitForSelector('#rail-servers .rail-btn[title="Chatterbox HQ"]', { timeout: 15000 });
await page.click('#rail-servers .rail-btn[title="Chatterbox HQ"]');
await page.waitForSelector('#text-channels .channel-row', { timeout: 15000 });
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = [...document.querySelectorAll('#text-channels .channel-row')].find((r) => r.textContent.includes('general'));
  row?.click();
  await wait(1200);
  const box = document.getElementById('messages');
  if (box) box.scrollTop = box.scrollHeight;
  await wait(400);
});
await sleep(600);
await page.screenshot({ path: 'shots/files.png' });
console.log('files shot');

await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('open-project')?.click();
  await wait(600);
  const row = [...document.querySelectorAll('#project-doc-list .channel-row')].find((r) => r.textContent.includes('project-plan.md'));
  row?.click();
  await wait(1200);
});
await sleep(2600);
await page.screenshot({ path: 'shots/project-review.png' });
console.log('review shot');

await browser.close();
console.log('done');
