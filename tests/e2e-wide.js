/*
 * Wide-screen + Safari test: every desktop size Kyle targets (16:9 and MacBook 16:10) in
 * Chromium AND WebKit (Safari's engine), WebKit print layout, and iPhone in WebKit.
 * Run: npm run test:e2e   (runs tests/e2e.js, then this file)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const pw = require('playwright-core');
const { start } = require('./serve.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const SIZES = [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1440, 900], [1512, 982], [1728, 1117]];
const SHOT_SIZES = { chromium: ['1920x1080', '1366x768'], webkit: ['1440x900', '1728x1117'] };
const VIEWS = ['calculator', 'jobs', 'documents', 'blueprints', 'profile', 'plans'];
const INIT = () => { window.__printed = null; window.print = () => { window.__printed = document.body.getAttribute('data-print'); }; };

const results = []; const problems = [];
function check(c, m) { if (!c) throw new Error('Assertion failed: ' + m); }
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') problems.push(`[${label}] console.error: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()}: ${r.url()}`); });
}
const overflowX = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Visible text that is cut off by its own box (ignores 1px visually-hidden labels and inputs). */
const clipped = (p, scope) => p.evaluate(sel => [...document.querySelectorAll(sel + ' *')].filter(e => e.offsetParent && e.offsetWidth > 2 && e.children.length === 0
  && !/^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(e.tagName) && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible')
  .map(e => e.tagName + ':' + e.textContent.trim().slice(0, 30)), scope);
const go = async (p, v) => { await p.click(`[data-view-link="${v}"]`); await p.waitForSelector(`section[data-view="${v}"]:not([hidden])`); };

(async () => {
  const server = await start(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Wide-screen + WebKit e2e against ${BASE}\n`);

  for (const bn of ['chromium', 'webkit']) {
    const browser = await pw[bn].launch();
    for (const [w, h] of SIZES) {
      const tag = `${w}x${h}`;
      await step(`${bn} ${tag}: inputs and results side by side, nothing cut off or sideways-scrolling`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        await ctx.addInitScript(INIT);
        const p = await ctx.newPage(); watch(p, `${bn} ${tag}`);
        await p.goto(BASE);
        await p.check('#agreeTerms'); await p.click('#tourSkip');
        await p.evaluate(() => window.scrollTo(0, 0));
        const lay = await p.evaluate(() => {
          const r = s => document.querySelector(s).getBoundingClientRect();
          const f = r('#jobForm'), res = r('#results'), top = r('.topbar');
          return { formRight: f.right, resLeft: res.left, resTop: res.top, formTop: f.top, resW: res.width, formW: f.width, top: top.height };
        });
        check(lay.resLeft >= lay.formRight - 1 && Math.abs(lay.resTop - lay.formTop) < 4, `results beside inputs ${JSON.stringify(lay)}`);
        check(lay.resW >= 430 && lay.formW >= 640, `no cramped columns ${JSON.stringify(lay)}`);
        check(lay.top <= 72, 'single-row top bar, height ' + lay.top);
        const aboveFold = await p.evaluate(() => document.querySelector('#outNet').getBoundingClientRect().bottom <= window.innerHeight);
        check(aboveFold, 'net profit visible without scrolling');
        const c1 = await clipped(p, 'section[data-view="calculator"]'); check(c1.length === 0, 'clipped text: ' + c1.join(', '));
        const share = SHOT_SIZES[bn].includes(tag);
        const name = s => path.join(SHOTS, `${bn === 'webkit' ? 'webkit' : 'desktop'}-${tag}-${s}.png`);
        if (share) await p.screenshot({ path: name('calculator') });
        await p.click('#modeReverse');
        const c2 = await clipped(p, 'section[data-view="calculator"]'); check(c2.length === 0, 'reverse clipped: ' + c2.join(', '));
        if (share) await p.screenshot({ path: name('find-my-price') });
        await p.click('#quoteEstimate');
        await p.waitForSelector('section[data-view="documents"]:not([hidden])');
        const d = await p.evaluate(() => { const a = document.querySelector('.doc-editor').getBoundingClientRect(), b = document.querySelector('.preview-wrap').getBoundingClientRect(); return { a: a.right, b: b.left, at: a.top, bt: b.top }; });
        check(d.b >= d.a - 1, 'estimate editor and preview side by side');
        const c3 = await clipped(p, 'section[data-view="documents"]'); check(c3.length === 0, 'documents clipped: ' + c3.join(', '));
        await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(3700); // let the save toast fade
        if (share) await p.screenshot({ path: name('estimate') });
        for (const v of VIEWS) { await go(p, v); check(await overflowX(p) <= 0, `${v} horizontal overflow`); }
        await ctx.close();
      });
    }

    if (bn === 'webkit') {
      await step('webkit print: estimate and invoice fit one Letter page, job sheet (10-line example) fits two — same as Chromium', async () => {
        // Playwright can only make PDFs in Chromium, so for Safari we render print media at the
        // Letter printable area (7.5in × 10in at 96px/in) and measure. The example deck job has 10 cost lines,
        // so its internal job sheet runs to 2 pages in Chromium's PDF too; the fence job in e2e.js is 1 page.
        const ctx = await browser.newContext({ viewport: { width: 720, height: 960 } });
        await ctx.addInitScript(INIT);
        const p = await ctx.newPage(); watch(p, 'webkit print');
        await p.setViewportSize({ width: 1440, height: 900 });
        await p.goto(BASE);
        if (await p.isVisible('#tour')) { if (await p.isVisible('#agreeTerms')) await p.check('#agreeTerms'); await p.click('#tourSkip'); }
        const measure = async (kind, file, maxPages = 1) => {
          check(await p.evaluate(() => window.__printed) === kind, 'print() called for ' + kind);
          await p.setViewportSize({ width: 720, height: 960 });
          await p.emulateMedia({ media: 'print' });
          const m = await p.evaluate(() => ({ h: document.getElementById('printRoot').scrollHeight, w: document.documentElement.scrollWidth,
            hiddenApp: getComputedStyle(document.querySelector('main')).display === 'none', txt: document.getElementById('printRoot').innerText }));
          await p.screenshot({ path: path.join(SHOTS, file), fullPage: true });
          await p.emulateMedia({ media: null });
          await p.setViewportSize({ width: 1440, height: 900 });
          await p.evaluate(() => { document.body.removeAttribute('data-print'); window.__printed = null; });
          check(m.hiddenApp, 'app chrome hidden in print'); check(m.w <= 720, 'print width ' + m.w);
          check(m.h <= 960 * maxPages, `${kind} fits ${maxPages} page(s) (height ${m.h}px, 960px per page)`);
          return m.txt;
        };
        await p.click('#modeReverse'); await p.click('#quoteEstimate');
        await p.waitForSelector('section[data-view="documents"]:not([hidden])');
        await p.click('#printDoc');
        const est = (await measure('doc', 'webkit-print-estimate.png')).toLowerCase();
        for (const word of ['profit', 'margin', 'wage', 'overhead', 'break-even']) check(!est.includes(word), 'estimate leaks ' + word);
        await p.click('#convertDoc'); await p.click('#printDoc');
        const inv = (await measure('doc', 'webkit-print-invoice.png')).toLowerCase();
        check(inv.includes('invoice') && !inv.includes('profit'), 'invoice prints without internal numbers');
        await go(p, 'calculator'); await p.click('#modeProfit'); await p.click('#moreBtn'); await p.click('[data-action="print-jobsheet"]');
        const js = await measure('jobsheet', 'webkit-print-jobsheet.png', 2);
        check(js.includes('Not financial or tax advice.'), 'job sheet disclaimer');
        await ctx.close();
      });

      await step('iPhone (WebKit, 390×844): every screen usable, nothing cut off or sideways-scrolling', async () => {
        const dev = pw.devices['iPhone 13'];
        const ctx = await browser.newContext({ ...dev, viewport: { width: 390, height: 844 } });
        await ctx.addInitScript(INIT);
        const p = await ctx.newPage(); watch(p, 'iphone');
        await p.goto(BASE);
        await p.waitForSelector('#tour:not([hidden])');
        await p.tap('#agreeTerms'); await p.tap('#tourSkip');
        check(await overflowX(p) <= 0, 'calculator overflow');
        check(await p.isVisible('#mobileBar'), 'sticky results bar');
        check((await p.textContent('#mbNet')).trim() === '$1,296.12', 'mobile bar net');
        const c1 = await clipped(p, 'section[data-view="calculator"]'); check(c1.length === 0, 'clipped: ' + c1.join(', '));
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.screenshot({ path: path.join(SHOTS, 'webkit-iphone-calculator.png') });
        await p.tap('#modeReverse');
        check((await p.textContent('#quotePrice')).trim().startsWith('$'), 'quote on iPhone');
        await p.tap('#quoteEstimate');
        await p.waitForSelector('section[data-view="documents"]:not([hidden])');
        check(await overflowX(p) <= 0, 'documents overflow');
        await p.$eval('.preview-wrap', e => e.scrollIntoView());
        await p.waitForTimeout(3700);
        await p.screenshot({ path: path.join(SHOTS, 'webkit-iphone-estimate-preview.png') });
        for (const v of ['jobs', 'blueprints', 'profile', 'plans']) {
          await p.evaluate(v2 => { location.hash = v2; }, v);
          await p.waitForSelector(`section[data-view="${v}"]:not([hidden])`);
          check(await overflowX(p) <= 0, v + ' overflow');
        }
        await ctx.close();
      });
    }
    await browser.close();
  }

  await step('No console errors, page errors or failed requests (both browsers)', async () => {
    check(problems.length === 0, problems.join('\n'));
  });
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} wide-screen/WebKit steps passed. Screenshots in ${SHOTS}`);
  if (failed.length) { failed.forEach(f => console.log(' FAIL:', f.name, '-', f.err)); process.exit(1); }
})().catch(e => { console.error('Wide e2e crashed:', e); process.exit(1); });
