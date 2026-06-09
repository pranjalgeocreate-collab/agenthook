// Renders docs/CONCEPT.md → docs/agent-social-concept.pdf
// Pipeline: marked (MD→HTML) → styled print page → Chrome (puppeteer) page.pdf().
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = process.cwd();
const md = readFileSync(join(root, 'docs/CONCEPT.md'), 'utf8');
const bodyHtml = marked.parse(md, { gfm: true, breaks: false });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  :root{--ink:#1f2328;--soft:#57606a;--line:#e4e0d6;--accent:#cc7a57;--accent-ink:#b4623f;--panel:#f7f4ee;--code:#1e1c19;}
  *{box-sizing:border-box}
  body{margin:0;color:var(--ink);font:11pt/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc{max-width:760px;margin:0 auto}
  h1{font-size:23pt;letter-spacing:-.4pt;margin:0 0 4pt;font-weight:700}
  h2{font-size:15pt;margin:22pt 0 6pt;padding-bottom:4pt;border-bottom:1.5px solid var(--accent);color:#171a1d;font-weight:700;break-after:avoid}
  h3{font-size:12.5pt;margin:14pt 0 4pt;color:var(--accent-ink);font-weight:700;break-after:avoid}
  h4{font-size:11pt;margin:10pt 0 2pt;font-weight:700}
  p,li{font-size:10.5pt}
  a{color:var(--accent-ink);text-decoration:none}
  hr{border:0;border-top:1px solid var(--line);margin:16pt 0}
  table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:9.6pt;break-inside:avoid}
  th{background:var(--panel);text-align:left;padding:6pt 8pt;border:1px solid var(--line);font-weight:700}
  td{padding:6pt 8pt;border:1px solid var(--line);vertical-align:top}
  tr:nth-child(even) td{background:#fbfaf7}
  code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px;font:9.5pt ui-monospace,Menlo,monospace}
  pre{background:var(--code);color:#ece7dd;border-radius:8px;padding:12pt 14pt;overflow:hidden;break-inside:avoid;margin:8pt 0}
  pre code{background:none;border:0;color:#ece7dd;font-size:8.4pt;line-height:1.45;padding:0;white-space:pre}
  blockquote{margin:8pt 0;padding:6pt 12pt;border-left:3px solid var(--accent);background:var(--panel);color:var(--soft);font-size:10pt}
  blockquote p{margin:0}
  .doc > h1:first-child{break-after:avoid}
  sub{color:var(--soft)}
  div[align="center"]{text-align:center}
</style></head><body><div class="doc">${bodyHtml}</div></body></html>`;

writeFileSync(join(root, 'docs/_concept.html'), html);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
const OUT = join(root, 'docs/agent-social-concept.pdf');
await page.pdf({
  path: OUT, format: 'A4', printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#999;text-align:center;">agent-social — Concept &amp; Product Brief · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
console.log('✅ PDF →', OUT);
