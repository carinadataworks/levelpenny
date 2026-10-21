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
    // Founding-list signup destination: FormSubmit AJAX endpoint for LevelPenny's own inbox (same
    // pattern as SkuClinic). FormSubmit needs a one-time activation: the first real submission from
    // the public site sends a confirmation email to levelpennyapp@gmail.com that must be clicked.
    // Set to '' to close signups: the Plans page then shows "Signups open soon" and sends/stores nothing.
    SIGNUP_ENDPOINT: 'https://formsubmit.co/ajax/levelpennyapp@gmail.com'
  };
  if (typeof module === 'object' && module.exports) module.exports = APP_CONFIG;
  else root.APP_CONFIG = APP_CONFIG;
})(this);
