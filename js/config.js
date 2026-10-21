/*
 * Product configuration — the ONE place to rename the product.
 * Change APP_CONFIG.name and every page title, header, print summary,
 * CSV export and guide picks it up.
 */
(function (root) {
  'use strict';
  var APP_CONFIG = {
    name: 'LevelPenny',                     // product name (a Carina Dataworks product) — rename here only
    company: 'Carina Dataworks',
    tagline: 'Know what you really make per hour — after every cost.',
    locale: 'en-US',
    currency: 'USD',
    storagePrefix: 'jpc',                  // localStorage key prefix (keep stable across renames)
    version: '1.0.0',
    contactEmail: 'levelpennyapp@gmail.com',
    // Fallback founding-list signup destination (used only when SIGNUP_SCRIPT_URL below is ''):
    // FormSubmit AJAX endpoint for LevelPenny's own inbox. FormSubmit needs a one-time activation and
    // Gmail flags its mail as spam, so the live site uses the Apps Script below instead.
    // Set both to '' to close signups: the Plans page then shows "Signups open soon" and sends/stores nothing.
    SIGNUP_ENDPOINT: 'https://formsubmit.co/ajax/levelpennyapp@gmail.com',
    // Google Apps Script web app (/exec URL) deployed from levelpennyapp@gmail.com (see signup-backend/README.md).
    // When set (live) it replaces FormSubmit: each signup adds a row to the "LevelPenny signups" Sheet and the
    // script emails the inbox from itself (not flagged as spam). Set to '' to fall back to SIGNUP_ENDPOINT above.
    SIGNUP_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwvUUlnjZXPZZvl1VRDrjn2iprJ5-0X0YezuSq_bqbaPcrkRLgqzABeg0lIwDgmx4uhIQ/exec'
  };
  if (typeof module === 'object' && module.exports) module.exports = APP_CONFIG;
  else root.APP_CONFIG = APP_CONFIG;
})(this);
