/*
 * Founding-list signup through a Google Apps Script web app (APP_CONFIG.SIGNUP_SCRIPT_URL set).
 * js/config.js is served with SIGNUP_SCRIPT_URL pointed at a fake /exec URL. That URL (and the
 * script.googleusercontent.com redirect Apps Script really answers with) is mocked inside the
 * browser; netguard aborts everything else and fakes FormSubmit, so nothing leaves the box.
 * Run: node tests/e2e-script-signup.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const { start } = require('./serve.js');
const { guardBrowser } = require('./netguard.js');

const ROOT = path.resolve(__dirname, '..');
const EXEC = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';
const ECHO = 'https://script.googleusercontent.com/macros/echo?user_content_key=test';
let fails = 0;
const ok = (name, v) => { console.log((v ? '  ✓ ' : '  ✗ ') + name); if (!v) fails++; };

(async () => {
  const server = await start(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const blocked = [], formSubmit = [];
  const browser = guardBrowser(await chromium.launch(), BASE, blocked, 'script-signup', formSubmit);
  const config = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/SIGNUP_SCRIPT_URL: '[^']*'/, `SIGNUP_SCRIPT_URL: '${EXEC}'`);
  ok('js/config.js has a SIGNUP_SCRIPT_URL to set', config.includes(EXEC));

  async function open(mode) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const posts = [];
    await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.route(EXEC, r => {
      const q = r.request(); posts.push({ method: q.method(), type: q.headers()['content-type'], body: q.postData() });
      return mode === 'down' ? r.abort('connectionrefused') : r.fulfill({ status: 302, headers: { Location: ECHO } });
    });
    await ctx.route(ECHO, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE); await page.check('#agreeTerms'); await page.click('#tourSkip'); await page.click('[data-view-link="plans"]');
    return { ctx, page, posts, errors };
  }
  const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());

  let t = await open('up');
  const idle = await text(t.page, '#signupIdle');
  ok('idle note says where it goes, not FormSubmit: ' + idle, idle.startsWith('Sent to levelpennyapp@gmail.com'));
  await t.page.selectOption('#suPlan', 'business-yearly');
  await t.page.fill('#suEmail', 'dana@ridgeline.example'); await t.page.fill('#suNote', '3-person deck crew');
  await t.page.click('#signupSubmit');
  await t.page.waitForFunction(() => /\b(ok|bad)\b/.test(document.querySelector('#signupMsg').className));
  ok('success message shows', (await t.page.getAttribute('#signupMsg', 'class')).includes('ok') && (await text(t.page, '#signupMsg')).includes('Business yearly ($169/yr)'));
  ok('one POST to the script URL', t.posts.length === 1 && t.posts[0].method === 'POST');
  ok('form-encoded body', /application\/x-www-form-urlencoded/.test(t.posts[0] && t.posts[0].type));
  const got = JSON.stringify(Object.fromEntries(new URLSearchParams(t.posts[0] ? t.posts[0].body : '')));
  const want = JSON.stringify({ form: 'signup', email: 'dana@ridgeline.example', Plan: 'Business yearly', Price: '$169/yr', Offer: '40% off for life (founding member)', App: 'LevelPenny', Note: '3-person deck crew', website: '' });
  ok('right fields posted: ' + got, got === want);
  ok('FormSubmit not used', formSubmit.length === 0);
  ok('form cleared after success', (await t.page.inputValue('#suEmail')) === '');
  // honeypot filled: nothing sent
  await t.page.fill('#suEmail', 'bot@spam.example'); await t.page.$eval('#suWebsite', e => { e.value = 'spam'; });
  await t.page.click('#signupSubmit'); await t.page.waitForTimeout(300);
  ok('honeypot blocks the send', t.posts.length === 1);
  ok('honeypot hidden from users and screen readers, not focusable', await t.page.$eval('#suWebsite', e => e.tabIndex === -1 && !!e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().right < 0));
  ok('no page errors: ' + t.errors.join(' | '), t.errors.length === 0);
  await t.ctx.close();

  t = await open('down');
  await t.page.fill('#suEmail', 'lee@example.com'); await t.page.click('#signupSubmit');
  await t.page.waitForFunction(() => /\b(ok|bad)\b/.test(document.querySelector('#signupMsg').className));
  ok('network error shows the failure message', (await t.page.getAttribute('#signupMsg', 'class')).includes('bad') && (await text(t.page, '#signupMsg')).includes('didn’t go through'));
  ok('typed email kept after failure', (await t.page.inputValue('#suEmail')) === 'lee@example.com');
  ok('button re-enabled', !(await t.page.isDisabled('#signupSubmit')));
  await t.ctx.close();

  ok('no other outside request: ' + blocked.join(', '), blocked.length === 0);
  await browser.close(); server.close();
  if (fails) { console.error(fails + ' failed'); process.exit(1); }
  console.log('script signup e2e passed');
})().catch(e => { console.error(e); process.exit(1); });
