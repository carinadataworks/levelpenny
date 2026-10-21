# LevelPenny — by Carina Dataworks

> **LevelPenny, a Carina Dataworks product** (named Oct 21, 2026; plain wordmark, no logo art). The product name lives in **one place**: `js/config.js` → `APP_CONFIG.name`.
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

**Plans & founding list** — real plan cards with a Monthly / Yearly toggle, all rendered from `js/plans.js`
(see "Plans and pricing" below). Each paid option has a *Join founding list* button that opens the signup form
(email + plan + optional note). **Planned pricing, not billed yet — no payments anywhere.**

**Accessibility & mobile** — every control labelled, keyboard-operable tabs and menu, visible focus, 44px tap targets,
AA contrast (axe-core clean of serious/critical issues), sticky mobile results bar, no horizontal scrolling at 390px.

## Plans and pricing (planned, not billed yet)

All prices, plan names, the Free limit, the founding offer and each plan's feature list live in **one file:
`js/plans.js`**. The Plans page, the upgrade prompt and the signup form render from it; `terms.html` and
`guide.html` fill `[data-price]` / `[data-plan-text]` spans from it; `tests/pricing.test.js` fails if the approved
price set changes, an old placeholder comes back, any page or this README shows a price not in that file, or a plan
lists a feature the app doesn't have.

| Plan | Price | Includes (all built today) |
|---|---|---|
| Free | $0 | Full calculator incl. Find my price; up to 3 saved jobs; templates, field guide, worksheet |
| Pro | $9/mo or $79/yr | Everything in Free; unlimited saved jobs; branded estimates & invoices (logo, numbering, tax, deposit, balance, signature); internal job sheet; backup/restore and CSV export |
| Business | $19/mo or $169/yr | Everything in Pro; crew labor rates with labor burden; profile defaults; overhead; compare saved jobs by profit/hr, net, margin; CSV of all jobs for the bookkeeper |

*Founding members: 40% off for life on Pro and Business while the subscription stays active. First 200 paid accounts.*

**Not built, so not part of any plan (don't promise):** cloud sync, online payments / emailing / e-signature,
multiple tax rates or tax templates, team seats, a Business trial. While pricing is being tested, everything that is
built works on Free except the saved-jobs limit (no other paywalls, so no current flow breaks).

**Free limit (3 saved jobs).** Saving a 4th *new* job, duplicating, or "Save a copy as my template" shows an upgrade
prompt instead; the job stays in the calculator (autosaved draft). Updating an already-saved job always works.
Over the limit already (e.g. a restored backup)? Nothing is deleted; those jobs can be opened, edited and deleted.
Saved jobs shows "N of 3 free saved jobs used".

**Dev unlock (testing only).** On `localhost`, `127.0.0.1` or `file://` only: open `index.html?dev-unlock=pro`
(or `business`) to lift the saved-jobs cap in that browser; `?dev-unlock=off` or the *Turn off dev unlock* button on
Plans removes it. It's a localStorage flag (`jpc.devplan.v1`), not a subscription, and is ignored on any hosted copy.

**Founding-list signup destination.** One value: `js/config.js` → `APP_CONFIG.SIGNUP_ENDPOINT` =
`https://formsubmit.co/ajax/levelpennyapp@gmail.com` (LevelPenny's own inbox; same FormSubmit AJAX pattern as
SkuClinic). The form POSTs JSON (`Accept: application/json`) with `email`, `_replyto`, `_subject` ("LevelPenny
founding-list signup"), `_honey`, `_captcha: "false"`, `_template: "table"`, `Plan`, `Price`, `Offer`, `App` and
`Note` (if typed); a filled honeypot field sends nothing; `{success:"false"}` shows an error and keeps the input.
Nothing is stored on the device. **FormSubmit needs a one-time activation:** the first real submission from the
public site emails levelpennyapp@gmail.com a confirmation link that must be clicked before signups are delivered.
Set the value to `''` to close signups: the form then shows *"Signups open soon"* and sends/stores nothing.
Contact email (terms, privacy, field guide): `APP_CONFIG.contactEmail` = levelpennyapp@gmail.com.

**Tests never touch the network.** `tests/netguard.js` aborts every browser request that isn't the local test
server and answers `formsubmit.co` locally (logged, asserted); any attempted internet request fails the run.

## Formulas

```
direct costs   = materials + crew labor + shipping + mileage + equipment + permits + subcontractors + other
crew labor     = per person: wage × hours, plus for employees (not 1099 subs) the labor burden:
                 wage × hours × (payroll tax% + unemployment% + workers' comp% + benefits%) + benefits $/hr × hours + per diem
loaded cost/hr = that person's labor cost ÷ hours
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

**Labor burden (employee cost).** Each crew member is *Employee (W-2)* or *1099 / subcontractor*. Employees get the
job's burden rates (FICA-style payroll tax, unemployment, workers' comp, insurance/benefits as % and/or $/hr) plus an
optional per-diem / travel pay; subs get none. New jobs and templates start from the Business profile defaults
(7.65% + 3% + 5%, labelled as editable examples with a check-with-your-accountant, not-tax-advice note). The loaded
cost/hr shows under each wage. Burden is in total costs, profit, profit/hour, break-even, Find my price, *Show the math*,
the job sheet and CSV — never on estimates or invoices (unit and e2e leak checks include burden words and amounts).
Jobs saved before this feature have no burden until you click *Use my Business profile defaults*.

Owner time is deliberately *not* a cost: the owner's pay is the profit, which is what profit-per-hour measures.

## Tests

```bash
npm install          # dev deps: playwright-core, axe-core
npm test             # unit tests (node:test): calc.test.js (every calculation hand-checked) + pricing.test.js (price set guard)
npm run test:e2e     # tests/e2e.js (Chromium flow) + tests/e2e-wide.js (wide screens + Safari) + tests/e2e-spacing.js
```

The e2e tests need a Chromium and a WebKit that match `playwright-core` (`npx playwright-core install chromium webkit`,
plus `npx playwright-core install-deps webkit` on Linux) and
`pdfinfo`/`pdftoppm` (poppler) for page counts and print screenshots.

What the e2e test does, like a contractor: first-run tour + terms; checks the example's numbers; enters a fence job from
scratch and checks every result against hand math; bad input; saves, reloads; a loss; Find my price (margin and $/hr,
impossible target, keyboard tabs); business profile with logo upload and pay link; quote → branded estimate; prints the
estimate, invoice and job sheet to Letter PDFs; converts estimate → invoice, records payment, PAID stamp; CSV exports and
worksheet; templates, duplicate, delete + undo; backup → restore on a fresh browser; axe-core on every view and page;
mobile 390×844; renaming via config; opening from `file://`; and fails on any console error/warning, page error or failed request.

`tests/e2e-wide.js` opens the app in **Chromium and WebKit (Safari's engine)** at every target desktop size —
16:9 1920×1080, 1600×900, 1366×768, 1280×720 and MacBook 16:10 1440×900, 1512×982, 1728×1117 — and checks that inputs
and results sit side by side (results ≥ 430px, inputs ≥ 640px), the top bar is one row, net profit is visible without
scrolling, no visible text is cut off, estimate editor and preview sit side by side, and no view scrolls sideways.
It also checks WebKit print media (estimate and invoice fit one Letter page; Playwright can only make PDFs in Chromium,
so WebKit is measured at the 7.5×10in printable area) and runs an iPhone 13 (WebKit, 390×844) pass over every screen.

### Spacing check
`tests/e2e-spacing.js` runs `tests/spacing.js` in Chromium and WebKit at 1920×1080, 1366×768, 1440×900, 1280×720 and
390×844 over every view and state (walkthrough steps, calculator, menu, Find my price, loss, toast, saved jobs, profile,
estimate and invoice editors, estimate/invoice/job-sheet print previews, templates, plans, guide, terms, privacy). Any
two visible cards, panels, boxes, button groups, tables, toasts or modals that overlap or sit closer than 12px (8px if
either is a small inline button) fail the test. Spacing uses one scale: `--sp-1..5` = 4, 8, 12, 16, 24px.
`SP_BROWSERS=webkit SP_SIZES=1440` narrows a run; `SPACING_SHOTS=dir` keeps a screenshot of every state.

### Desktop layout
Desktop is the primary target. From 1200px wide: one-row top bar; hero and the two mode cards side by side; inputs left,
results pinned right. From 1540px: inputs split into two columns (price, materials, labor | travel, fees, other,
overhead). Line-item rows use container queries, so they go to one row when their column is wide enough and stack
otherwise, and long names are never cut off. Short laptop screens (height 820px or less) hide the hero subtitle. Phones
(< 560px) and print use the same layout as before.

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
js/config.js          product name & settings  ← rename here; SIGNUP_ENDPOINT (empty)
js/plans.js           plans, prices, Free limit, founding offer ← the ONE price source
js/calc.js            calculation engine (pure, cents)
js/docs.js            estimates, invoices, job sheet rendering (pure)
js/store.js           localStorage + backup/restore (pure helpers)
js/csv.js             CSV export + blank worksheet
js/templates.js       ready-made job blueprints
js/app.js             UI controller
js/vendor/qrcode.js   QR generator (qrcode-generator 1.4.4, MIT, Kazuhiko Arase)
tests/                unit tests, e2e tests (e2e.js, e2e-wide.js), static server
screens/              screenshots, sample PDFs and CSVs from the last e2e run
```

## Known limits
- Data lives in one browser on one device; no sync or accounts. Clearing site data loses it unless backed up.
- Estimates/invoices are printed or saved as PDF from the browser; no emailing, e-signature or online payment processing.
- Single currency (USD formatting via `APP_CONFIG.currency/locale`); sales tax is one rate per document.
- No CSV import of a filled worksheet (worksheet is for the field; numbers are typed into the app).
- Legal pages are drafts that must be reviewed by an attorney before charging.
