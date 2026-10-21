/* Applies the product name from config.js to static pages. */
(function () {
  var c = window.APP_CONFIG; if (!c) return;
  document.querySelectorAll('[data-app-name]').forEach(function (e) { e.textContent = c.name; });
  document.querySelectorAll('[data-company]').forEach(function (e) { e.textContent = c.company; });
  document.title = document.title.replace('LevelPenny', c.name);
  // Prices and offer text come from js/plans.js (the one price source) when the page loads it.
  var P = window.JobPlans; if (!P) return;
  document.querySelectorAll('[data-price]').forEach(function (e) { var t = P.priceFor(e.getAttribute('data-price')); if (t) e.textContent = t; });
  document.querySelectorAll('[data-plan-text]').forEach(function (e) { var t = P.textFor(e.getAttribute('data-plan-text')); if (t) e.textContent = t; });
})();
