/*
 * Product configuration — the ONE place to rename the product.
 * Change APP_CONFIG.name and every page title, header, print summary,
 * CSV export and guide picks it up.
 */
(function (root) {
  'use strict';
  var APP_CONFIG = {
    name: 'Job Profit Calculator',          // working title — rename here only
    company: 'Carina Dataworks',
    tagline: 'Know what you really make per hour — after every cost.',
    locale: 'en-US',
    currency: 'USD',
    storagePrefix: 'jpc',                  // localStorage key prefix (keep stable across renames)
    version: '1.0.0'
  };
  if (typeof module === 'object' && module.exports) module.exports = APP_CONFIG;
  else root.APP_CONFIG = APP_CONFIG;
})(this);
