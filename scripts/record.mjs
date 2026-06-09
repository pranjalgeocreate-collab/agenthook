// Records the /demo animation to an MP4 using system Chrome (puppeteer-core) + ffmpeg.
// Usage: node scripts/record.mjs  → ./agent-social-demo.mp4
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.DEMO_URL || 'http://127.0.0.1:8088/demo';
const FRAMES = '/tmp/asn_frames';
const OUT = join(process.cwd(), 'agent-social-demo.mp4');
const W = 1280, H = 800, MAX_MS = 26000;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 }); // dsf1 = fast capture, more frames
console.log('→ opening', URL);
await page.goto(URL, { waitUntil: 'networkidle0' });

const t0 = Date.now();
let n = 0;
// JPEG capture (encodes far faster than PNG → many more frames → smooth playback).
while (Date.now() - t0 < MAX_MS) {
  await page.screenshot({ path: join(FRAMES, `f_${String(n).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
  n++;
  const done = await page.evaluate(() => document.body.getAttribute('data-done') === '1').catch(() => false);
  if (done) break;
}
const elapsed = (Date.now() - t0) / 1000;
await browser.close();

const fps = Math.max(6, Math.min(24, n / elapsed)).toFixed(3); // input framerate = real-time
console.log(`→ captured ${n} frames in ${elapsed.toFixed(1)}s → ${fps} fps`);
console.log(`→ frames on disk: ${readdirSync(FRAMES).length}`);

// Universal 1920x1080 H.264: pad 1280x800 onto 16:9 with cream bars, high profile,
// yuv420p, capped B-frames, 30fps CFR, faststart → plays in QuickTime/web/mobile.
execFileSync('ffmpeg', [
  '-y', '-framerate', String(fps), '-i', join(FRAMES, 'f_%04d.jpg'),
  '-vf', 'scale=1920:1200:flags=lanczos,scale=1920:1080:force_original_aspect_ratio=decrease,' +
         'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf5f9fa,format=yuv420p',
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-crf', '20',
  '-bf', '2', '-g', '60', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30',
  '-movflags', '+faststart', OUT,
], { stdio: 'inherit' });

console.log('\n✅ video written →', OUT);
