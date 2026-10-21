/*
 * Spacing e2e: runs tests/spacing.js in Chromium and WebKit at 1920×1080, 1366×768, 1440×900, 1280×720
 * and phone 390×844 across every view and state (walkthrough, calculator, menu, reverse, loss, toast,
 * saved jobs, estimate and invoice editor, print previews, templates, profile, plans, guide, legal).
 * Fails on any violation. Screenshots of every state go to $SPACING_SHOTS (default: OS temp dir).
 */
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os');
const pw = require('playwright-core');
const { start } = require('./serve.js');
const { spacing } = require('./spacing.js');

const SIZES = [[1920, 1080], [1366, 768], [1440, 900], [1280, 720], [390, 844]]
  .filter(([w]) => !process.env.SP_SIZES || process.env.SP_SIZES.split(',').includes(String(w)));
const BROWSERS = (process.env.SP_BROWSERS || 'chromium,webkit').split(',');
const OUT = process.env.SPACING_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'jpc-spacing-'));
fs.mkdirSync(OUT, { recursive: true });
const INIT = () => { window.__printed = null; window.print = () => { window.__printed = document.body.getAttribute('data-print'); }; };
const all = []; let states = 0;

(async () => {
  const server = await start(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Spacing check against ${BASE}\n`);
  for (const bn of BROWSERS) {
    const browser = await pw[bn].launch();
    for (const [w, h] of SIZES) {
      const tag = `${bn}-${w}x${h}`;
      const phone = w < 600;
      const opts = phone ? (bn === 'webkit' ? { ...pw.devices['iPhone 13'], viewport: { width: w, height: h } } : { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }) : { viewport: { width: w, height: h } };
      const ctx = await browser.newContext(opts);
      await ctx.addInitScript(INIT);
      const p = await ctx.newPage();
      const found = [];
      const click = async s => { if (phone) await p.tap(s); else await p.click(s); };
      const at = async (state, root, noShot) => {
        states++;
        const v = await spacing(p, root);
        v.forEach(x => found.push(`${state}: ${x}`));
        if (!noShot) await p.screenshot({ path: path.join(OUT, `${tag}-${state}.png`), fullPage: !phone && state !== 'tour-1' && !state.startsWith('tour') });
      };
      const view = async v => { await p.evaluate(v2 => { location.hash = v2; }, v); await p.waitForSelector(`section[data-view="${v}"]:not([hidden])`); await p.evaluate(() => window.scrollTo(0, 0)); };
      const waitToast = () => p.evaluate(() => { document.getElementById('toast').hidden = true; }); // toast was checked in its own state
      try {
        await p.goto(BASE);
        await p.waitForSelector('#tour:not([hidden])');
        await at('tour-1');
        await click('#agreeTerms'); await at('tour-1-agreed', null, true);
        await click('#tourNext'); await p.waitForTimeout(400); await at('tour-2');
        await click('#tourNext'); await p.waitForTimeout(400); await at('tour-3');
        await click('#tourNext');
        await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
        await at('calculator');
        await click('#burdenBox summary'); await p.selectOption('#c-type-1', 'sub'); await at('labor-burden', null, true);
        await p.selectOption('#c-type-1', 'employee'); await click('#burdenBox summary');
        await click('#moreBtn'); await at('more-menu', null, true); await p.keyboard.press('Escape');
        if (await p.isVisible('#moreMenu')) await click('#moreBtn');
        await click('#modeReverse'); await at('find-my-price');
        await click('#modeProfit');
        const old = await p.inputValue('#price');
        await p.fill('#price', '900'); await at('loss');
        await p.fill('#price', old);
        await click('#saveJob'); await p.waitForSelector('#toast:not([hidden])'); await at('toast', null, true); await waitToast();
        await click('#dupJob'); await waitToast();
        await view('jobs'); await at('saved-jobs');
        await view('profile');
        await p.fill('#pfName', 'Ridgeline Carpentry LLC'); await p.fill('#pfPayLink', 'https://buy.stripe.com/test_ridgeline');
        await p.fill('#pfLicense', 'NC-GC-12345'); await p.press('#pfPayLink', 'Tab');
        await at('profile');
        await view('calculator'); await click('#modeReverse'); await click('#quoteEstimate');
        await p.waitForSelector('section[data-view="documents"]:not([hidden])'); await waitToast(); await p.evaluate(() => window.scrollTo(0, 0));
        await at('estimate-editor');
        await click('#printDoc');
        await p.emulateMedia({ media: 'print' }); await at('print-estimate', '#printRoot', true); await p.emulateMedia({ media: null });
        await p.evaluate(() => document.body.removeAttribute('data-print'));
        await click('#convertDoc'); await waitToast(); await p.fill('#docPaid', '1000'); await p.evaluate(() => window.scrollTo(0, 0));
        await at('invoice-editor');
        await click('#printDoc');
        await p.emulateMedia({ media: 'print' }); await at('print-invoice', '#printRoot', true); await p.emulateMedia({ media: null });
        await p.evaluate(() => document.body.removeAttribute('data-print'));
        await view('calculator'); await click('#modeProfit'); await click('#moreBtn'); await click('[data-action="print-jobsheet"]');
        await p.emulateMedia({ media: 'print' }); await at('print-jobsheet', '#printRoot', true); await p.emulateMedia({ media: null });
        await p.evaluate(() => document.body.removeAttribute('data-print'));
        await view('blueprints'); await at('templates');
        await view('plans'); await at('plans');
        for (const pg of ['guide', 'terms', 'privacy']) { await p.goto(BASE + pg + '.html'); await at(pg); }
      } catch (e) { found.push('CRASH: ' + e.message.split('\n')[0]); }
      console.log(`  ${found.length ? '✗' : '✓'} ${tag}: ${found.length} spacing violation(s)`);
      const uniq = {};
      found.forEach(x => { const k = x.replace(/^[^:]+: /, ''); (uniq[k] = uniq[k] || []).push(x.split(':')[0]); });
      Object.keys(uniq).slice(0, 60).forEach(k => console.log(`      ${k}   [${uniq[k].length}× ${[...new Set(uniq[k])].slice(0, 4).join(', ')}]`));
      all.push(...found.map(x => tag + ' ' + x));
      await ctx.close();
    }
    await browser.close();
  }
  server.close();
  console.log(`\n${states} page states checked; ${all.length} spacing violations. State screenshots: ${OUT}`);
  process.exit(all.length ? 1 : 0);
})().catch(e => { console.error('Spacing e2e crashed:', e); process.exit(1); });
