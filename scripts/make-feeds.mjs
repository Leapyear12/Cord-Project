import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('shots/feeds', { recursive: true });

const feeds = {
  aarav: `
    radial-gradient(circle at 28% 32%, rgba(255, 196, 120, 0.85) 0%, rgba(255, 170, 90, 0.25) 12%, transparent 34%),
    radial-gradient(circle at 74% 22%, rgba(255, 210, 150, 0.35) 0%, transparent 22%),
    radial-gradient(circle at 62% 78%, rgba(120, 70, 40, 0.5) 0%, transparent 45%),
    linear-gradient(160deg, #2b1d16 0%, #1a1210 45%, #0f0b0a 100%)`,
  meera: `
    radial-gradient(circle at 30% 26%, rgba(160, 220, 255, 0.75) 0%, rgba(120, 190, 240, 0.22) 13%, transparent 36%),
    radial-gradient(circle at 78% 70%, rgba(90, 130, 220, 0.45) 0%, transparent 42%),
    radial-gradient(circle at 60% 12%, rgba(200, 235, 255, 0.28) 0%, transparent 24%),
    linear-gradient(155deg, #122030 0%, #0c1520 50%, #070b10 100%)`,
};

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});

for (const [name, bg] of Object.entries(feeds)) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  await page.setContent(`
    <style>
      html,body { margin:0; height:100%; overflow:hidden; }
      body { background: ${bg}; background-blend-mode: screen, screen, screen, normal; }
      .grain { position:absolute; inset:0; opacity:.16; mix-blend-mode:overlay;
        background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px); }
      .vignette { position:absolute; inset:0;
        background: radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,.55) 100%); }
      .soft { position:absolute; border-radius:50%; filter: blur(14px); }
      .a { width:110px; height:110px; left:44%; top:58%; background: rgba(255,220,180,.09); }
      .b { width:70px; height:70px; left:12%; top:70%; background: rgba(255,255,255,.06); }
    </style>
    <div class="grain"></div><div class="soft a"></div><div class="soft b"></div><div class="vignette"></div>
  `);
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(`shots/feeds/${name}.png`, png);
  await page.close();

  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = 640, H = 360;
  const cw = W / 2, ch = H / 2;
  const y = Buffer.alloc(W * H);
  const u = Buffer.alloc(cw * ch);
  const v = Buffer.alloc(cw * ch);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      y[py * W + px] = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));
    }
  }
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      let rSum = 0, gSum = 0, bSum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((py * 2 + dy) * W + px * 2 + dx) * 3;
          rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
        }
      }
      const r = rSum / 4, g = gSum / 4, b = bSum / 4;
      u[py * cw + px] = Math.max(0, Math.min(255, -0.169 * r - 0.331 * g + 0.5 * b + 128));
      v[py * cw + px] = Math.max(0, Math.min(255, 0.5 * r - 0.419 * g - 0.081 * b + 128));
    }
  }
  const header = Buffer.from('YUV4MPEG2 W640 H360 F30:1 Ip A1:1 C420jpeg XYSCSS=420JPEG\n');
  const chunks = [header];
  for (let f = 0; f < 4; f++) {
    chunks.push(Buffer.from('FRAME\n'), y, u, v);
  }
  writeFileSync(`shots/feeds/${name}.y4m`, Buffer.concat(chunks));
  console.log('wrote', name, 'y4m');
}

await browser.close();
