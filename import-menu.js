/**
 * import-menu.js
 *
 * Loads data/menu-items.csv into the `menuItems` collection in the
 * pivot-dev-shop Firestore database.
 *
 * The CSV is an e-commerce export, not a menu: one row per (item, price) pair
 * with how many purchases happened at that price. The same SKU turns up on
 * several rows because it sold at several prices (sizes, add-ons, promotions).
 * So rows are grouped by SKU into one document per item, priced at the lowest
 * price it sold at — the higher ones carry add-ons.
 *
 * Document id is the SKU. Shape, and nothing else:
 *   name   'ACAI BOWL'
 *   price  10.69
 *
 * That's deliberate. The first version kept the whole sales history on each
 * document (every price, purchase counts, min/max), and a `price` inside that
 * history looked exactly like the one the board reads — so it's where the first
 * console edits went. The history is still in the CSV.
 *
 * Prices are rounded to cents — the export carries float noise like
 * 8.380000000000001.
 *
 * It is **create-only**: a SKU that already has a document is reported and
 * skipped, never overwritten, so a second run creates nothing and anything
 * edited in the database later beats the file.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS in CI, or ./serviceAccountKey.json
 * by hand (gitignored).
 *
 * Run:
 *   node import-menu.js            # report only, writes nothing
 *   node import-menu.js --apply    # actually write
 */

const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const COLLECTION = 'menuItems';
const CSV_PATH = path.resolve(__dirname, process.env.CSV || 'data/menu-items.csv');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const APPLY = process.argv.includes('--apply');

// Minimal CSV parser: handles quoted fields and doubled quotes, which is all
// a spreadsheet export produces.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const cents = (n) => Math.round(n * 100) / 100;

function buildItems(csvText) {
  const [header, ...rows] = parseCsv(csvText.replace(/^﻿/, ''));
  const col = (re) => {
    const i = header.findIndex((h) => re.test(h.trim()));
    if (i === -1) throw new Error(`CSV has no column matching ${re}. Header: ${header.join(', ')}`);
    return i;
  };
  const iName = col(/^name$/i);
  const iSku = col(/^sku$/i);
  const iPrice = col(/^price$/i);
  const iCount = col(/purchase/i);

  const bySku = new Map();
  const problems = [];
  rows.forEach((r, n) => {
    const line = n + 2;
    const name = (r[iName] || '').trim();
    const sku = (r[iSku] || '').trim();
    const price = Number(r[iPrice]);
    const purchases = Number(r[iCount] || 0);
    if (!name || !sku) return problems.push(`line ${line}: missing name or sku`);
    if (!/^[A-Za-z0-9_-]+$/.test(sku)) return problems.push(`line ${line}: sku "${sku}" can't be a document id`);
    if (!Number.isFinite(price) || price < 0) return problems.push(`line ${line}: bad price "${r[iPrice]}"`);

    const item = bySku.get(sku) || { name, sku, prices: new Map() };
    if (item.name !== name) problems.push(`line ${line}: sku ${sku} is "${item.name}" earlier and "${name}" here`);
    const p = cents(price);
    item.prices.set(p, (item.prices.get(p) || 0) + (Number.isFinite(purchases) ? purchases : 0));
    bySku.set(sku, item);
  });

  const items = [...bySku.values()].map((it) => {
    const prices = [...it.prices].map(([price, purchases]) => ({ price, purchases }))
      .sort((a, b) => a.price - b.price);
    return {
      name: it.name,
      sku: it.sku,
      prices,
      minPrice: prices[0].price,
      maxPrice: prices[prices.length - 1].price,
      totalPurchases: prices.reduce((s, p) => s + p.purchases, 0),
    };
  });
  return { rowCount: rows.length, items, problems };
}

async function main() {
  const { rowCount, items, problems } = buildItems(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`${path.basename(CSV_PATH)}: ${rowCount} rows -> ${items.length} menu items`);
  if (problems.length) {
    console.error('Fix these in the CSV first:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  const credential = fs.existsSync(SERVICE_ACCOUNT_PATH)
    ? cert(require(SERVICE_ACCOUNT_PATH))
    : applicationDefault();
  initializeApp({ credential, projectId: 'pivot-dev-shop' });
  const db = getFirestore();

  const refs = items.map((it) => db.collection(COLLECTION).doc(it.sku));
  const existing = new Set();
  // getAll takes up to a few hundred refs at once; this file is ~50.
  for (let i = 0; i < refs.length; i += 300) {
    (await db.getAll(...refs.slice(i, i + 300))).forEach((s) => s.exists && existing.add(s.id));
  }

  const toCreate = items.filter((it) => !existing.has(it.sku));
  for (const it of items) {
    const tag = existing.has(it.sku) ? 'skip (exists)' : 'create';
    const range = it.minPrice === it.maxPrice ? `$${it.minPrice.toFixed(2)}`
      : `$${it.minPrice.toFixed(2)}–$${it.maxPrice.toFixed(2)}`;
    console.log(`  ${tag.padEnd(13)} ${it.sku}  ${it.name}  ${range}`);
  }
  console.log(`\n${toCreate.length} to create, ${existing.size} already there.`);

  if (!APPLY) {
    console.log('Report only — nothing written. Run with --apply to write.');
    return;
  }
  for (let i = 0; i < toCreate.length; i += 400) {
    const batch = db.batch();
    toCreate.slice(i, i + 400).forEach((it) =>
      batch.create(db.collection(COLLECTION).doc(it.sku), { name: it.name, price: it.minPrice }));
    await batch.commit();
  }
  console.log(`Wrote ${toCreate.length} documents to ${COLLECTION}.`);
}

if (require.main === module) {
  main().catch((err) => {
    if (err.code === 5 || /NOT_FOUND/.test(err.message)) {
      console.error('Firestore said NOT_FOUND — the database probably hasn\'t been created yet. ' +
        'Firebase console → pivot-dev-shop → Firestore Database → Create database.');
    } else if (err.code === 7 || /PERMISSION_DENIED/.test(err.message)) {
      console.error('Permission denied — the service account needs the Cloud Datastore User role ' +
        '(Google Cloud console → IAM).');
    }
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseCsv, buildItems };
