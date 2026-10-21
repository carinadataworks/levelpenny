/* Ready-made job blueprints. Numbers are realistic 2026 US examples — edit freely. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobTemplates = factory();
})(this, function () {
  'use strict';
  var T = [
    {
      id: 'deck-repair', trade: 'Carpentry', icon: '🪚',
      blurb: 'Replace rotted boards and two joists on a 12×16 deck, then seal. Two-person crew, two days.',
      job: {
        name: 'Deck repair — 12×16 backyard deck', client: 'Jordan Ellis',
        customer: { name: 'Jordan Ellis', email: 'jordan.ellis@example.com', phone: '(555) 201-4477', address: '418 Maple Ridge Dr\nAsheville, NC 28803' },
        jobAddress: '418 Maple Ridge Dr, Asheville, NC 28803',
        notes: 'Two days on site. Deposit + final payment by card.',
        price: '4850',
        materialsMode: 'itemized',
        materials: [
          { name: 'Pressure-treated 5/4×6 decking, 12 ft', qty: '40', unitCost: '14.98' },
          { name: 'Pressure-treated 2×8 joists, 12 ft', qty: '6', unitCost: '22.47' },
          { name: 'Exterior deck screws, 5 lb box', qty: '3', unitCost: '42.97' },
          { name: 'Joist hangers & hardware', qty: '1', unitCost: '68.50' },
          { name: 'Deck stain & sealer, 1 gal', qty: '3', unitCost: '46.00' }
        ],
        materialsTotal: '',
        crew: [
          { name: 'Lead carpenter', wage: '32', hours: '16' },
          { name: 'Helper', wage: '20', hours: '16' }
        ],
        ownerHours: '10',
        shipping: '75', miles: '84', mileRate: '0.70',
        fee: { preset: 'square', pct: '2.6', fixed: '0.15', payments: '2' },
        otherCosts: [
          { category: 'equipment', name: 'Debris haul-away / dumpster', amount: '185' },
          { category: 'permits', name: 'Deck repair permit', amount: '120' },
          { category: 'other', name: 'Saw blades & consumables', amount: '40' }
        ],
        overhead: { mode: 'percent', value: '10' },
        taxPct: '25', hoursBasis: 'all'
      }
    },
    {
      id: 'bathroom-remodel', trade: 'Remodeling', icon: '🛁',
      blurb: 'Full gut of a 5×8 hall bath: tile shower, vanity, toilet, fan and lighting. Plumber and electrician subbed out.',
      job: {
        name: 'Bathroom remodel — 5×8 hall bath', client: 'Priya Natarajan',
        customer: { name: 'Priya Natarajan', email: 'priya.n@example.com', phone: '(555) 318-9020', address: '72 Oak Hollow Ln\nRaleigh, NC 27609' },
        jobAddress: '72 Oak Hollow Ln, Raleigh, NC 27609',
        notes: '3 payments: deposit, mid-point, completion.',
        price: '18500',
        materialsMode: 'itemized',
        materials: [
          { name: 'Porcelain tile, setting & grout materials', qty: '1', unitCost: '1850' },
          { name: 'Vanity with quartz top', qty: '1', unitCost: '1100' },
          { name: 'Toilet, comfort height', qty: '1', unitCost: '389' },
          { name: 'Shower valve & trim kit', qty: '1', unitCost: '465' },
          { name: 'Backer board, drywall & waterproofing', qty: '1', unitCost: '640' },
          { name: 'Vanity light & exhaust fan', qty: '1', unitCost: '310' },
          { name: 'Paint & supplies', qty: '1', unitCost: '120' }
        ],
        materialsTotal: '',
        crew: [
          { name: 'Tile setter', wage: '38', hours: '40' },
          { name: 'Carpenter', wage: '34', hours: '32' },
          { name: 'Helper', wage: '21', hours: '40' }
        ],
        ownerHours: '24',
        shipping: '0', miles: '300', mileRate: '0.70',
        fee: { preset: 'stripe', pct: '2.9', fixed: '0.30', payments: '3' },
        otherCosts: [
          { category: 'subcontractor', name: 'Licensed plumber (rough-in & trim)', amount: '1950' },
          { category: 'subcontractor', name: 'Electrician (fan & GFCI circuit)', amount: '950' },
          { category: 'permits', name: 'Building permit', amount: '350' },
          { category: 'equipment', name: 'Dumpster rental, 10 yd', amount: '450' }
        ],
        overhead: { mode: 'percent', value: '12' },
        taxPct: '25', hoursBasis: 'all'
      }
    },
    {
      id: 'lawn-care', trade: 'Landscaping', icon: '🌿',
      blurb: 'Weekly mow, trim and blow for a quarter-acre lot. One helper, about an hour and a quarter on site.',
      job: {
        name: 'Lawn care visit — ¼ acre weekly', client: 'Marcus Webb',
        customer: { name: 'Marcus Webb', email: 'mwebb@example.com', phone: '(555) 640-1123', address: '9 Birch Ct\nCary, NC 27513' },
        jobAddress: '9 Birch Ct, Cary, NC 27513',
        notes: 'Recurring weekly visit.',
        price: '85',
        materialsMode: 'total', materials: [], materialsTotal: '6.50',
        crew: [{ name: 'Crew member', wage: '18', hours: '1.25' }],
        ownerHours: '1.25',
        shipping: '', miles: '12', mileRate: '0.70',
        fee: { preset: 'square', pct: '2.6', fixed: '0.15', payments: '1' },
        otherCosts: [{ category: 'equipment', name: 'Mower & trimmer wear', amount: '4' }],
        overhead: { mode: 'percent', value: '8' },
        taxPct: '20', hoursBasis: 'all'
      }
    },
    {
      id: 'handmade-batch', trade: 'Makers', icon: '🕯️',
      blurb: 'A wholesale batch of 24 hand-poured soy candles for a local boutique, shipped in one box.',
      job: {
        name: 'Handmade batch — 24 soy candles (wholesale)', client: 'Juniper & Co. Boutique',
        customer: { name: 'Juniper & Co. Boutique', email: 'orders@juniperco.example.com', phone: '(555) 777-0142', address: '201 Main St\nBlack Mountain, NC 28711' },
        jobAddress: '',
        notes: 'Wholesale at $28/candle. Paid by card online.',
        price: '672',
        materialsMode: 'itemized',
        materials: [
          { name: 'Soy wax (lb)', qty: '18', unitCost: '3.20' },
          { name: 'Fragrance oil (oz)', qty: '22', unitCost: '1.85' },
          { name: 'Glass jars with lids', qty: '24', unitCost: '2.10' },
          { name: 'Cotton wicks', qty: '24', unitCost: '0.25' },
          { name: 'Printed labels', qty: '24', unitCost: '0.40' },
          { name: 'Gift boxes', qty: '24', unitCost: '0.95' }
        ],
        materialsTotal: '',
        crew: [],
        ownerHours: '6',
        shipping: '48.50', miles: '', mileRate: '0.70',
        fee: { preset: 'stripe', pct: '2.9', fixed: '0.30', payments: '1' },
        otherCosts: [{ category: 'other', name: 'Packing tape & filler', amount: '8' }],
        overhead: { mode: 'percent', value: '5' },
        taxPct: '20', hoursBasis: 'owner'
      }
    },
    {
      id: 'house-cleaning', trade: 'Cleaning', icon: '🧽',
      blurb: 'Deep clean of a 3-bed, 2-bath home with a two-person team. Supplies included.',
      job: {
        name: 'Deep clean — 3 bed / 2 bath home', client: 'Alyssa Romero',
        customer: { name: 'Alyssa Romero', email: 'alyssa.r@example.com', phone: '(555) 410-8862', address: '1550 Lakeview Blvd\nDurham, NC 27707' },
        jobAddress: '1550 Lakeview Blvd, Durham, NC 27707',
        notes: '',
        price: '420',
        materialsMode: 'total', materials: [], materialsTotal: '22',
        crew: [{ name: 'Cleaner', wage: '19', hours: '4' }],
        ownerHours: '4.5',
        shipping: '', miles: '26', mileRate: '0.70',
        fee: { preset: 'stripe', pct: '2.9', fixed: '0.30', payments: '1' },
        otherCosts: [],
        overhead: { mode: 'flat', value: '25' },
        taxPct: '20', hoursBasis: 'all'
      }
    }
  ];
  return T;
});
