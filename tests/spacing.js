/*
 * Spacing check (runs inside the page). Flags every pair of visible boxes — cards, panels, sections,
 * KPI tiles, button groups, buttons, tables, toasts, modals, document blocks — that overlap or sit closer
 * than 12px (8px when either one is a small inline control such as a button, pill or segmented control).
 * Nested pairs (one inside the other) are not compared. Fixed-position layers (tour, toast, mobile bar)
 * are compared with each other, not with the page scrolling underneath them.
 */
'use strict';
const BOX = [
  '.topbar', '.site-foot', '.hero', '.modebar [role="tab"]', '.jobbar', '.card', '.sec', '.results', '.res-card',
  '.kpi-main', '.kpis > div', '.quote-out', '.value-msg', '.alert', '.alert-loss', '.warnings li', '.line', '.docline',
  '.menu-list', 'details.rebuild', '.docs-list-card', '.docs-list button', '.doc-editor', '.preview-wrap', '.paper', '.profile-hint',
  '.logo-preview', '.tpl', '.tpl-stats > div', '.plan', 'table', '.math', '.chart', '.doc-sum', '.downloads > *', '.dl-grid > *',
  '.toast', '.tour', '.tour-cred', '.tour-agree', '.tour-actions', '.mobilebar', '.cred-badge', '.disclaimer',
  '.view-actions', '.jobbar-actions', '.doc-actions', '.quote-actions', '.tpl-actions',
  // customer documents and the job sheet (screen preview and print)
  '.doc-head', '.doc-parties', '.doc-pay', '.doc-totals', '.doc-notes', '.doc-sign', '.doc-stamp', '.js-kpis .kpi', '.js-table', '.js-disclaimer',
  // guide / legal pages
  '.page-top', '.example', '.formula', '.note', '.cols > *'
];
const SMALL = ['.btn', '.icon-btn', '.pill', '.badge', '.seg', '.tour-btn', '.skip'];

function inPage(arg) {
  const { BOX, SMALL, root } = arg;
  const scope = document.querySelector(root) || document.body;
  const all = new Set();
  const isSmall = new Set();
  for (const s of BOX) scope.querySelectorAll(s).forEach(e => all.add(e));
  for (const s of SMALL) scope.querySelectorAll(s).forEach(e => { all.add(e); isSmall.add(e); });
  if (scope !== document.body && all.size === 0) return [];
  const sx = window.scrollX, sy = window.scrollY;
  const shown = e => {
    if (e.closest('[hidden], .visually-hidden')) return false;
    if (e.parentElement && e.parentElement.closest('.seg') ) return false;  // segments inside one control
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  // fixed layers, plus the sticky top bar / phone results bar, float over the page by design
  const layer = e => { for (let n = e; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || (p === 'sticky' && n.matches('.topbar, .mobilebar'))) return 'fixed'; } return 'flow'; };
  const name = e => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.');
    const t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return t ? `${s}("${t}")` : s;
  };
  const items = [...all].filter(shown).map(e => {
    const r = e.getBoundingClientRect(); const L = layer(e);
    const off = { x: sx, y: sy };
    return { e, L, small: isSmall.has(e), l: r.left + off.x, t: r.top + off.y, r: r.right + off.x, b: r.bottom + off.y };
  });
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.L !== b.L || a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const dx = Math.max(b.l - a.r, a.l - b.r), dy = Math.max(b.t - a.b, a.t - b.b);
    const min = (a.small || b.small) ? 8 : 12;
    let kind = null, gap = null;
    if (dx < -0.5 && dy < -0.5) { kind = 'overlap'; gap = Math.round(Math.max(dx, dy)); }
    else if (dx < -0.5 && dy < min - 0.5) { kind = 'vertical'; gap = Math.round(dy); }
    else if (dy < -0.5 && dx < min - 0.5) { kind = 'horizontal'; gap = Math.round(dx); }
    if (kind) out.push(`${kind} gap ${gap}px (min ${min}): ${name(a.e)} ↔ ${name(b.e)}`);
  }
  return out;
}
async function spacing(page, root) { return page.evaluate(inPage, { BOX, SMALL, root: root || 'body' }); }
module.exports = { spacing, BOX, SMALL };
