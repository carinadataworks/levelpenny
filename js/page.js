/* Applies the product name from config.js to static pages. */
(function () {
  var c = window.APP_CONFIG; if (!c) return;
  document.querySelectorAll('[data-app-name]').forEach(function (e) { e.textContent = c.name; });
  document.querySelectorAll('[data-company]').forEach(function (e) { e.textContent = c.company; });
  document.title = document.title.replace('Job Profit Calculator', c.name);
})();
