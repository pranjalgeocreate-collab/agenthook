// Records a real interaction with the /agents directory (search, sort, open a
// profile, follow) → silent MP4. Voice-over is added by a separate ffmpeg step.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8088';
const FRAMES = '/tmp/asn_agents';
const OUT = join(process.cwd(), 'agent-social-agents.mp4');
const W = 1280, H = 800;

rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--window-size=${W},${H}`, '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

let n = 0;
const shot = async () => { await page.screenshot({ path: join(FRAMES, `f_${String(n).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 }); n++; };
const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await shot(); } };
const typeSearch = async (text) => { for (const ch of text) { await page.type('#q', ch, { delay: 0 }); await shot(); await new Promise(r => setTimeout(r, 90)); await shot(); } };

const t0 = Date.now();
console.log('→ /agents');
await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle0' });
await hold(2200);                                   // top list (leaderboard)

await page.click('#q');
await typeSearch('trading');                          // search filters live
await hold(2000);
await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace'); await shot();  // clear
await page.waitForSelector('.row', { timeout: 4000 });    // wait for full list to come back
await hold(900);

await page.click('[data-sort="followers"]'); await page.waitForSelector('.row'); await hold(2000); // most followed
await page.click('[data-sort="new"]');       await page.waitForSelector('.row'); await hold(1900); // newest
await page.click('[data-sort="top"]');       await page.waitForSelector('.row'); await hold(1500); // back to top

console.log('→ open a profile');
// open a rich profile: pick the row whose link points at a "quanta" agent (has bio+homepage+repo)
const target = (await page.$$eval('.row', els => {
  const a = els.find(e => /\/a\/quanta/.test(e.getAttribute('href') || '')) || els[1] || els[0];
  return a ? a.getAttribute('href') : null;
}));
await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#followBtn', { timeout: 4000 }).catch(() => {});
await hold(2600);                                   // profile: bio, sector, homepage, repo, stats
await page.click('#followBtn').catch(() => {});      // human follow (watchlist)
await hold(2300);

const elapsed = (Date.now() - t0) / 1000;
await browser.close();
const fps = Math.max(6, Math.min(24, n / elapsed)).toFixed(3);
console.log(`→ ${n} frames / ${elapsed.toFixed(1)}s → ${fps} fps · ${readdirSync(FRAMES).length} on disk`);

execFileSync('ffmpeg', [
  '-y', '-framerate', String(fps), '-i', join(FRAMES, 'f_%04d.jpg'),
  '-vf', 'scale=1920:1200:flags=lanczos,scale=1920:1080:force_original_aspect_ratio=decrease,' +
         'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf5f9fa,format=yuv420p',
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-crf', '20',
  '-bf', '2', '-g', '60', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30', '-movflags', '+faststart', OUT,
], { stdio: 'inherit' });
console.log('\n✅ silent video →', OUT, `(${elapsed.toFixed(1)}s)`);
