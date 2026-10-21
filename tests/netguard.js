/*
 * Network guard for browser tests: every request that is not to the local test server
 * (or file:// / data: / blob:) is aborted and recorded, so a test can never reach the internet.
 * Tests that need a fake external endpoint add their own route on the context; routes added
 * later take precedence, so those requests are fulfilled locally and never leave the box.
 */
'use strict';
function guardContext(ctx, base, blocked, label) {
  const origin = new URL(base).origin;
  return ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url === origin || /^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(`[${label || 'test'}] blocked ${route.request().method()} ${url}`);
    return route.abort('blockedbyclient');
  });
}
/**
 * The live signup endpoint is FormSubmit (js/config.js). Tests never submit for real: every
 * formsubmit.co request is answered locally like FormSubmit's AJAX API and logged in `submissions`.
 */
const FS_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept' };
function fakeFormSubmit(ctx, submissions) {
  return ctx.route(/^https:\/\/formsubmit\.co\//, route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: FS_CORS });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) { body = req.postData(); }
    submissions.push({ url: req.url(), method: req.method(), headers: req.headers(), body });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: FS_CORS, body: JSON.stringify({ success: 'true', message: 'The form was submitted successfully.' }) });
  });
}
/** Patch browser.newContext so every context it makes is guarded (and FormSubmit is faked). */
function guardBrowser(browser, base, blocked, label, submissions) {
  const orig = browser.newContext.bind(browser);
  browser.newContext = async opts => {
    const ctx = await orig(opts);
    await guardContext(ctx, base, blocked, label);
    await fakeFormSubmit(ctx, submissions || []);
    return ctx;
  };
  return browser;
}
module.exports = { guardContext, guardBrowser, fakeFormSubmit };
