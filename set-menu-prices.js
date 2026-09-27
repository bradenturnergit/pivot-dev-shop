/**
 * set-menu-prices.js
 *
 * Applies data/menu-price-overrides.json to the menuItems collection: sets a
 * `price` field on each listed document. The menu board reads `price` before
 * `minPrice`, so this is how one item's board price is corrected without
 * touching the import.
 *
 * Only ever updates documents that already exist, and only the `price` field.
 * Re-running with the same file changes nothing.
 *
 * Run:
 *   node set-menu-prices.js            # report only
 *   node set-menu-prices.js --apply    # write
 */

const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data/menu-price-overrides.json');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const APPLY = process.argv.includes('--apply');

async function main() {
  const overrides = Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))
    .filter(([sku]) => sku !== '//');
  for (const [sku, o] of overrides) {
    if (!Number.isFinite(o.price) || o.price < 0) throw new Error(`${sku}: price must be a number, got ${o.price}`);
  }

  const credential = fs.existsSync(SERVICE_ACCOUNT_PATH)
    ? cert(require(SERVICE_ACCOUNT_PATH))
    : applicationDefault();
  initializeApp({ credential, projectId: 'pivot-dev-shop' });
  const db = getFirestore();

  let changes = 0;
  for (const [sku, o] of overrides) {
    const ref = db.collection('menuItems').doc(sku);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`${sku}: no menuItems document with that SKU`);
    const d = snap.data();
    const same = d.price === o.price;
    console.log(`  ${same ? 'unchanged' : 'set      '} ${sku}  ${d.name}  ` +
      `price ${d.price ?? '(none)'} -> ${o.price}  (minPrice ${d.minPrice})`);
    if (same) continue;
    changes++;
    if (APPLY) await ref.update({ price: o.price });
  }
  console.log(`\n${changes} to change.` + (APPLY ? ' Written.' : ' Report only — run with --apply to write.'));
}

main().catch((err) => { console.error(err); process.exit(1); });
