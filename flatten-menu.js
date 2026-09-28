/**
 * flatten-menu.js — ONE-TIME. Delete once applied.
 *
 * Rewrites every menuItems document down to { name, price }, dropping the
 * sales-history fields (prices, minPrice, maxPrice, totalPurchases, sku,
 * createdAt). They confused price editing — a `price` inside the `prices`
 * array looks like the board's price and isn't — and nothing reads them.
 * The history is still in data/menu-items.csv.
 *
 * price is taken, in order, from:
 *   1. a top-level `price` already set by hand
 *   2. the one entry in `prices`, when there is exactly one — that's where two
 *      prices were edited in the console before this existed
 *   3. minPrice
 *
 * Run:
 *   node flatten-menu.js            # report only
 *   node flatten-menu.js --apply    # write
 */

const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const APPLY = process.argv.includes('--apply');

async function main() {
  const credential = fs.existsSync(SERVICE_ACCOUNT_PATH)
    ? cert(require(SERVICE_ACCOUNT_PATH))
    : applicationDefault();
  initializeApp({ credential, projectId: 'pivot-dev-shop' });
  const db = getFirestore();

  const snap = await db.collection('menuItems').get();
  if (snap.empty) throw new Error('menuItems is empty — wrong project?');

  const writes = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const keys = Object.keys(d).sort().join(',');
    if (keys === 'name,price') { console.log(`  already flat  ${doc.id}  ${d.name}  ${d.price}`); continue; }
    let price, from;
    if (typeof d.price === 'number') { price = d.price; from = 'price'; }
    else if (Array.isArray(d.prices) && d.prices.length === 1 && typeof d.prices[0].price === 'number') { price = d.prices[0].price; from = 'prices[0]'; }
    else if (typeof d.minPrice === 'number') { price = d.minPrice; from = 'minPrice'; }
    else throw new Error(`${doc.id}: no price to keep`);
    if (typeof d.name !== 'string' || !d.name) throw new Error(`${doc.id}: no name`);
    const note = from === 'prices[0]' && price !== d.minPrice ? '   <- console edit kept' : '';
    console.log(`  flatten       ${doc.id}  ${d.name}  ${price}  (from ${from})${note}`);
    writes.push([doc.ref, { name: d.name, price }]);
  }
  console.log(`\n${writes.length} to rewrite, ${snap.size - writes.length} already flat.`);
  if (!APPLY) { console.log('Report only — run with --apply to write.'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }
  console.log(`Rewrote ${writes.length} documents.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
