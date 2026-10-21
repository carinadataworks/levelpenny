/* JobCsv — CSV export builders (pure). Amounts are plain decimals so spreadsheets can do math on them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.JobCsv = factory(root.JobCalc);
})(this, function (C) {
  'use strict';
  function cell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    // Neutralise spreadsheet formula injection from user-entered text.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function row(arr) { return arr.map(cell).join(','); }
  function d(c) { return c === null || c === undefined ? '' : (c / 100).toFixed(2); }
  function p(r) { return r === null || r === undefined ? '' : (r * 100).toFixed(2); }

  function jobToCsv(job, r, appName) {
    var L = [];
    L.push(row([appName || 'LevelPenny', 'Job export']));
    L.push(row(['Job', job.name || 'Untitled job']));
    L.push(row(['Customer', (job.customer && job.customer.name) || job.client || '']));
    L.push('');
    L.push(row(['Section', 'Item', 'Qty / hours', 'Unit cost / rate', 'Amount']));
    L.push(row(['Revenue', 'Price charged', '', '', d(r.priceCents)]));
    if (job.materialsMode === 'total') L.push(row(['Materials', 'Materials (total)', '', '', d(r.direct.materials)]));
    else r.direct.materialsLines.forEach(function (m) { L.push(row(['Materials', m.name, m.qty, d(m.unitCents), d(m.cents)])); });
    r.direct.crewLines.forEach(function (c) {
      L.push(row(['Labor', c.name + (c.type === 'sub' ? ' (1099)' : ''), c.hours, d(c.wageCents), d(c.burdenCents ? c.wagesCents : c.cents)]));
      if (c.burdenCents) L.push(row(['Labor burden', c.name + ' — payroll tax, comp, benefits' + (c.perDiemCents ? ', per diem' : ''), c.hours, d(c.loadedHourlyCents), d(c.burdenCents)]));
    });
    L.push(row(['Owner time', 'Owner hours (not a cost)', r.ownerHours, '', '']));
    L.push(row(['Shipping & travel', 'Shipping / delivery', '', '', d(r.direct.shippingFlat)]));
    L.push(row(['Shipping & travel', 'Mileage', C.num(job.miles), d(C.toCents(job.mileRate)), d(r.direct.mileage)]));
    r.direct.otherLines.forEach(function (o) { L.push(row([C.OTHER_CATEGORIES[o.category], o.name, '', '', d(o.cents)])); });
    L.push(row(['Card fees', r.feePct + '% + ' + d(r.feeFixedCents) + ' x ' + r.feePayments, '', '', d(r.feesCents)]));
    L.push(row(['Overhead', 'Overhead allocation', '', '', d(r.overheadCents)]));
    L.push('');
    L.push(row(['Result', 'Value']));
    [['Total costs', d(r.totalCostsCents)], ['Gross profit', d(r.grossProfitCents)], ['Profit before tax', d(r.profitBeforeTaxCents)],
      ['Tax set-aside (' + r.taxPct + '%)', d(r.taxSetAsideCents)], ['Net profit', d(r.netProfitCents)], ['Net margin %', p(r.netMargin)],
      ['Markup %', p(r.markup)], ['Total hours', r.totalHours], ['Profit per hour (all hours)', d(r.profitPerHourAllCents)],
      ['Profit per owner hour', d(r.profitPerHourOwnerCents)], ['Billed rate per hour', d(r.billedRateCents)], ['Break-even price', d(r.breakEvenCents)]
    ].forEach(function (x) { L.push(row(x)); });
    return L.join('\r\n') + '\r\n';
  }

  function jobsToCsv(list) {
    var L = [row(['Job', 'Customer', 'Price', 'Total costs', 'Gross profit', 'Tax set-aside', 'Net profit', 'Net margin %', 'Markup %', 'Total hours', 'Owner hours', 'Profit per hour (all)', 'Profit per owner hour', 'Break-even price', 'Last updated'])];
    list.forEach(function (it) {
      var j = it.job, r = it.result;
      L.push(row([j.name || 'Untitled job', (j.customer && j.customer.name) || j.client || '', d(r.priceCents), d(r.totalCostsCents), d(r.grossProfitCents), d(r.taxSetAsideCents),
        d(r.netProfitCents), p(r.netMargin), p(r.markup), r.totalHours, r.ownerHours, d(r.profitPerHourAllCents), d(r.profitPerHourOwnerCents), d(r.breakEvenCents), j.updatedAt || '']));
    });
    return L.join('\r\n') + '\r\n';
  }
  var WORKSHEET = [["Section", "Field", "Qty / hours", "Unit cost / rate", "Value", "Notes"], ["Job", "Job name", "", "", "", ""], ["Job", "Customer name", "", "", "", ""], ["Job", "Job site address", "", "", "", ""], ["Price", "Price you charge the customer", "", "", "", "Before any sales tax you collect"], ["Materials", "Material line 1", "", "", "", "Qty x unit cost"], ["Materials", "Material line 2", "", "", "", ""], ["Materials", "Material line 3", "", "", "", ""], ["Materials", "Material line 4", "", "", "", ""], ["Materials", "Material line 5", "", "", "", ""], ["Materials", "Material line 6", "", "", "", ""], ["Labor", "Crew member 1 (wage x hours)", "", "", "", "Include payroll tax / workers' comp in the wage if you want them counted"], ["Labor", "Crew member 2 (wage x hours)", "", "", "", ""], ["Labor", "Crew member 3 (wage x hours)", "", "", "", ""], ["Owner time", "Your hours on this job", "", "", "", "Quoting, buying, driving, working, invoicing. Not a cost."], ["Shipping & travel", "Shipping / delivery fees", "", "", "", ""], ["Shipping & travel", "Miles driven (all trips) x cost per mile", "", "0.70", "", "Fuel + wear; IRS standard rate is a fair default"], ["Card fees", "Fee percent", "", "", "", "Stripe 2.9 / Square 2.6"], ["Card fees", "Fixed fee per payment", "", "", "", "Stripe 0.30 / Square 0.15"], ["Card fees", "Number of payments", "", "", "", "e.g. 2 for deposit + final"], ["Equipment / rental", "Equipment or rental", "", "", "", ""], ["Permits & fees", "Permit", "", "", "", ""], ["Subcontractors", "Subcontractor", "", "", "", ""], ["Other", "Other cost", "", "", "", ""], ["Overhead", "Overhead (% of price or flat $)", "", "", "", "Insurance, truck, phone, software, rent"], ["Tax", "Income tax set-aside % of profit", "", "", "", "Only applies when the job makes a profit"], ["Results", "Total costs", "", "", "", "Direct costs + card fees + overhead"], ["Results", "Net profit", "", "", "", "Price - total costs - tax set-aside"], ["Results", "Total hours (crew + yours)", "", "", "", ""], ["Results", "Profit per hour", "", "", "", "Net profit / total hours"]];
  function worksheetCsv(appName) {
    var L = [row([(appName || 'LevelPenny') + ' - blank job worksheet']), row(['Fill in the Value column (and Qty / Unit cost where shown). Blank = 0. Then enter the numbers in the app, or total them here.'])];
    WORKSHEET.forEach(function (r) { L.push(row(r)); });
    return L.join('\r\n') + '\r\n';
  }
  return { jobToCsv: jobToCsv, jobsToCsv: jobsToCsv, worksheetCsv: worksheetCsv, cell: cell };
});
