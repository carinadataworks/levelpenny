# Job Profit Calculator — by Carina Dataworks

> Working title. The product name lives in **one place**: `js/config.js` → `APP_CONFIG.name`.
> Every page title, header, footer, job sheet, CSV export, worksheet and the guide/legal pages read it from there.

A job and quote profit calculator for contractors, freelancers and small service businesses —
a sibling product to [SkuClinic](https://carinadataworks.github.io/margin-pilot/).
It answers two questions: **"What should I quote?"** and **"What do I really make per hour on this job, after everything?"**

Static site: plain HTML, CSS and JavaScript. No backend, no build step, no external fonts, scripts or trackers.
All data stays in the browser's `localStorage` on the user's device.

## Open it locally

```bash
cd /workspace/job-profit
npm start                 # serves http://127.0.0.1:8080/  (node tests/serve.js 8080)
```

Or just double-click `index.html` — it also works from `file://` (verified in the e2e test).
Any static host works later (GitHub Pages, Vercel, Cloudflare Pages): publish the folder as-is.
**Nothing has been pushed or deployed.**

## Features

**Calculator** (`index.html`, live as you type)
- Price charged; materials itemized (name × qty × unit cost) or one total; paid crew (wage × hours, any number of people);
  your own hours; shipping/delivery plus mileage × rate; card fees (% + fixed × number of payments) with Stripe 2.9% + 30¢,
  Square 2.6% + 15¢, custom or none; equipment/rental, permits, subcontractors and other cost lines; optional overhead
  (% of price or flat) and optional income-tax set-aside %.
- Outputs: total costs, gross profit, net profit, net margin, markup, **profit per hour after costs** (all hours or
  "my hours only"), billed rate (price ÷ hours), break-even price, a "where every dollar goes" chart, and a
  step-by-step "show the math" table. One-line value message: *"You really make $33.19/hr … not the $115.48/hr the price suggests."*
- **Find my price** (reverse mode, first on screen): target net margin %, profit per hour, or profit $ → the exact lowest
  price that hits it (optionally rounded up to $1/$5/$10/$25/$50/$100), with a one-click **Create estimate at this price**.
  Impossible targets explain why (e.g. fees + overhead + tax cap the possible margin).
- Validation: blanks count as 0, junk input is flagged inline and treated as 0, never NaN/Infinity, zero hours shows "—",
  losses shown in red with the reason, biggest cost and break-even price. All money math is integer cents.

**Jobs** — save any number of jobs, reload-safe autosave of the current job, compare table (sort by profit/hr, net,
margin, name; best $/hr highlighted), duplicate as a template, delete with undo, export one job or all jobs to CSV.

**Templates & guide** — 5 ready-made blueprints (deck repair, bathroom remodel, lawn care visit, handmade candle batch,
deep clean) to load or save as your own; a downloadable blank job worksheet (CSV); a one-page printable field guide
(`guide.html`) explaining every field and how profit per hour is calculated, with a worked example.

**Estimates & invoices** — customer-facing documents built from a job: auto-incrementing numbers (EST-1001, INV-1001,
prefixes and next numbers editable), date and due/valid-until date, customer and job-site info, editable line items,
markup applied to materials/costs (either "match the job price" — labor absorbs the rest — or cost + markup on every line,
itemized or 3-line summary), per-line taxable flag, discount (% or $), sales tax, deposit / payments received, balance due,
payment terms, notes, signature/acceptance block on estimates, status (estimate: draft/sent/accepted/declined;
invoice: draft/sent/paid, with a PAID stamp), **convert estimate → invoice**, duplicate, delete with undo.
Invoices print an optional **Pay online** link and QR code (from the business profile).
**Customer documents never contain internal costs, wages, margin or profit** — see "Privacy guarantee" below.

**Internal job sheet** — printable profit report with every cost line, wages, fees, overhead, tax set-aside,
net profit, margin, markup, hours, profit per hour and break-even. Marked *INTERNAL — do not send to customer*.

**Business profile** — company name, logo upload (resized, stored locally), address, phone, email, website, license #,
pay-online link (Stripe/Square/PayPal/Venmo URL; only http(s) accepted), default terms/notes, due/valid days,
default sales tax and markup. **Backup / restore**: one-click JSON backup of profile, jobs, estimates and invoices;
restore validates the file and asks before replacing data.

**Printing** — Letter size, black-and-white friendly print stylesheet; only the document prints; page-break control;
use the browser's print dialog → "Save as PDF". Ctrl/Cmd+P prints the current document or the job sheet.

**Onboarding, trust & legal** — first-run deck-repair example, 3-step walkthrough with the credibility message
("Made by professionals, for professionals.") and a required "I agree to the Terms" checkbox (stored locally with date);
credibility line in the hero; disclaimer near results and on the job sheet; `terms.html` and `privacy.html`
(Carina Dataworks, last updated date, Connecticut law, liability cap, indemnification, no-profit guarantee,
attorney-review note); subtle Terms/Privacy links in the app footer only (never on customer documents).

**Plans** — placeholder describing a future "Contractor Pro" subscription. No payments anywhere.

**Accessibility & mobile** — every control labelled, keyboard-operable tabs and menu, visible focus, 44px tap targets,
AA contrast (axe-core clean of serious/critical issues), sticky mobile results bar, no horizontal scrolling at 390px.

## Formulas

```
direct costs   = materials + crew labor + shipping + mileage + equipment + permits + subcontractors + other
card fees      = price × fee% + fixed fee × number of payments      (0 if price is 0)
overhead       = price × overhead%   or   flat amount
total costs    = direct costs + card fees + overhead
gross profit   = price − direct costs
tax set-aside  = (price − total costs) × tax%                        (only if positive)
net profit     = price − total costs − tax set-aside
net margin     = net profit ÷ price            markup = (price − total costs) ÷ total costs
profit / hour  = net profit ÷ (crew hours + owner hours)   or ÷ owner hours ("My hours only")
billed rate    = price ÷ total hours
break-even     = lowest price (to the cent) where price − total costs ≥ 0
find my price  = lowest price (to the cent) that meets the margin / hourly / profit target
```

Owner time is deliberately *not* a cost: the owner's pay is the profit, which is what profit-per-hour measures.

## Tests

```bash
npm install          # dev deps: playwright-core, axe-core
npm test             # 40 unit tests (node:test) — every calculation hand-checked
npm run test:e2e     # 23-step headless Chromium run, writes screens/
```

The e2e test needs a Chromium that matches `playwright-core` (`npx playwright-core install chromium` if missing) and
`pdfinfo`/`pdftoppm` (poppler) for page counts and print screenshots.

What the e2e test does, like a contractor: first-run tour + terms; checks the example's numbers; enters a fence job from
scratch and checks every result against hand math; bad input; saves, reloads; a loss; Find my price (margin and $/hr,
impossible target, keyboard tabs); business profile with logo upload and pay link; quote → branded estimate; prints the
estimate, invoice and job sheet to Letter PDFs; converts estimate → invoice, records payment, PAID stamp; CSV exports and
worksheet; templates, duplicate, delete + undo; backup → restore on a fresh browser; axe-core on every view and page;
mobile 390×844; renaming via config; opening from `file://`; and fails on any console error/warning, page error or failed request.

### Privacy guarantee (customer documents)
- `JobDocs.buildLinesFromJob()` is the only bridge from costs to customer prices; it outputs only
  description / qty / unit / unit price / taxable.
- `JobDocs.renderCustomerDoc(doc, profile, cfg)` never receives the job or its calculation.
- Unit test renders estimates and invoices for every template in every pricing mode and asserts no internal words
  (profit, margin, wage, overhead, markup, per hour…), no crew names, no internal notes and no internal dollar amounts appear,
  and that stored documents have no cost fields. The e2e test repeats the check on the real printed output.

## Project layout

```
index.html            app shell (all views)
guide.html            one-page printable field guide
terms.html, privacy.html
css/styles.css        app styles (navy + gold, mobile first)
css/print.css         Letter print stylesheet
css/page.css          guide / legal page styles
js/config.js          product name & settings  ← rename here
js/calc.js            calculation engine (pure, cents)
js/docs.js            estimates, invoices, job sheet rendering (pure)
js/store.js           localStorage + backup/restore (pure helpers)
js/csv.js             CSV export + blank worksheet
js/templates.js       ready-made job blueprints
js/app.js             UI controller
js/vendor/qrcode.js   QR generator (qrcode-generator 1.4.4, MIT, Kazuhiko Arase)
tests/                unit tests, e2e test, static server
screens/              screenshots, sample PDFs and CSVs from the last e2e run
```

## Known limits
- Data lives in one browser on one device; no sync or accounts. Clearing site data loses it unless backed up.
- Estimates/invoices are printed or saved as PDF from the browser; no emailing, e-signature or online payment processing.
- Single currency (USD formatting via `APP_CONFIG.currency/locale`); sales tax is one rate per document.
- No CSV import of a filled worksheet (worksheet is for the field; numbers are typed into the app).
- Legal pages are drafts that must be reviewed by an attorney before charging.
