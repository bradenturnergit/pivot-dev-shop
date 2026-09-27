# pivot-dev-shop

The placeholder site for Pivot Dev Shop (pivotdevshop.com) — the parent company.
Two static pages — the holding page and a case study — with no build step, no
framework, and **no JavaScript at all**.

Its first product, Famous People, is two separate repos: **famous-people**
(marketing, admin dashboard, Firestore rules) and **famous-people-app** (the game).
Nothing here shares a Firebase project with either of them.

## Ownership

This repo owns hosting **and the Firestore rules** for the `pivot-dev-shop` Firebase
project. The rules live here, in this repo, rather than in whatever repo happens to
read the data first. That is the mistake famous-people documents having made.

## Deploying

| What | How |
|---|---|
| Live site + menu board | Automatic on merge to `main` (`deploy-site.yml`), path-filtered; the workflow creates the `pivot-dev-shop-menu` hosting site the first time |
| PR preview | Automatic per pull request, own channel, expires in 7 days (`preview.yml`) |
| Firestore rules | **Manual** — Actions → Deploy Firestore rules → Run workflow |
| Menu data | **Manual** — Actions → Menu data → `report`, then `apply` |

One secret, `FIREBASE_SERVICE_ACCOUNT` — the key for
**`firebase-adminsdk-fbsvc@pivot-dev-shop.iam.gserviceaccount.com`**, the only account
in the project with a key. Grant roles to *that* account: `claude@` and
`github-deploy@` exist but have no keys, and roles given to them change nothing here —
which is how the first rules deploy kept failing after the roles were "added". Hosting needs only
**Firebase Hosting Admin**. The Firestore workflows need more, and the account doesn't
have them by default: **Cloud Datastore User** for Menu data, **Firebase Rules Admin**
and **Service Usage Consumer** for the rules deploy. Hosting works without any of those.

## The digital menu (Firestore)

`data/menu-items.csv` → `import-menu.js` → the `menuItems` collection. The Firestore
database itself had to be created once in the Firebase console first (Firestore
Database → Create database); nothing here creates it.

- **One document per SKU, id = the SKU.** The CSV is an e-commerce export — one row
  per item *per price it sold at*, with a purchase count — so the same SKU appears on
  several rows. Every price is kept in a `prices` array (`{ price, purchases }`) with
  `minPrice`, `maxPrice` and `totalPurchases` alongside, rather than guessing which one
  is the menu price.
- **Create-only**, same rule as famous-people's imports: an existing document is never
  overwritten, so a second `apply` writes nothing and edits made in the database win.
- **Rules: public read, no browser writes.** Only the Admin SDK (the import) writes.
- Prices are rounded to cents; the export carries float noise like `8.380000000000001`.

Preview jobs are gated on `head.repo.full_name == github.repository`: a fork's pull
request gets no secrets, so without that gate every one of them fails on a missing key
and says nothing about the change.

## The menu board (menu.pivotdevshop.com)

`menu/index.html` is a 4K digital menu board (Tropical Smoothie Cafe, Tropic Bowls),
served as its own hosting site, `pivot-dev-shop-menu`, with `menu.pivotdevshop.com`
connected to it in the Firebase console. It has nothing to do with the brand site:
none of the design-system rules above apply to it, and it has its own headers block
in `firebase.json`.

- **It is private, and that means unlisted, not locked.** Every response carries
  `X-Robots-Tag: noindex`, the page has the matching meta tag, nothing links to it,
  and `robots.txt` *allows* crawling for the same reason the main site's does — the
  header only works if it's fetched. None of that stops someone who has the URL.
  Actually locking it would need a login, which a signage player can't do.
- **It is a pre-built bundle with its fonts inlined as base64**, from a separate
  project (`build-bundle.js` over an `index.html` source that isn't in this repo).
  It was edited in place here for the Firestore wiring; if a new bundle arrives,
  re-apply the changes below rather than dropping it over the top.
- **Prices come from `menuItems`**, read over the Firestore REST API every 60 s. Each
  price slot is a `data-brink-id` holding the item's SKU (= document id). Four items
  on the board are in the database — Salted Caramel JavaBlender, Acai Bowl, Acai
  Bowl with NUTELLA, Bahama Mama Bowl. The other six (Dragon Fruit Bowl, PB Protein
  Crunch, Mixed Berry Greek Yogurt, Chia Oatmeal, both drizzles) aren't, so they
  keep their original placeholder ids and show the price written in the HTML.
  Everything in `menuItems` that isn't on the board is ignored.
- **The price shown is `minPrice`**, since the export records every price an item
  sold at and the higher ones include add-ons. A `price` field added to a document
  by hand wins over it — that's the way to correct one item without touching the
  import. Those live in `data/menu-price-overrides.json` and are written by
  `set-menu-prices.js` (Menu data → `prices`, then `prices-apply`). The Bahama Mama
  Bowl is the first: the export's only sale of it was $14.88 with add-ons.
- **CSP needs `script-src 'unsafe-inline'`**: the script is inline in a generated
  file, so a hash would silently break on the next rebuild. No `frame-ancestors`,
  so a signage player can embed the page.
- **The six product images are not here yet.** Until `menu/images/*.png` exist the
  board shows dashed boxes naming the file it wants: `salted-caramel-javablender.png`,
  `chobani-coffee-creamer.png`, `acai-bowl-nutella.png`, `bahama-mama-bowl.png`,
  `pb-protein-crunch.png`, `chia-oatmeal.png`.

## The design system is copied in, with one deliberate fork

`public/styles.css`, `public/tokens/` and `public/assets/` come from the
`pivot-dev-shop-design` skill. `index.html` references tokens for every colour, size,
radius and shadow and hard-codes none of them, which is what makes re-copying those
files a safe update. **Don't edit a token value here to change the page** — that
forks the system silently; change the page's use of it, or change the skill.

`tokens/typography.css` is the exception, and it is a knowing one:

- **The page is set in Plus Jakarta Sans; Fredoka is the wordmark only.** The system
  ships Fredoka for everything and says the rounded terminals are what keep the brand
  from reading corporate. They also make four hundred words of body copy read as a
  children's app, which is the brand owner's call and the reason for this fork. The
  logo keeps Fredoka — `--font-logo`, used by exactly five elements (the `.lockup`
  word and sub, and the three hero brandmark spans) and nothing else. Setting body
  copy in `--font-logo` undoes the whole point.
- **Both faces are self-hosted from `public/fonts/`**, not imported from the Google
  Fonts CDN, so there is no third-party request on first paint and no Google host in
  the CSP. Only the weights the page renders are shipped — Jakarta 400/600/700,
  Fredoka 600/700, 76KB in total. **Adding a weight to the type scale means adding
  its woff2 file**, or the browser synthesises it and the result looks wrong in a way
  that is easy to miss. The files are cached `immutable` for a year, which is safe
  only because a changed face means a changed filename.
- Fredoka's faces are `font-display: block`, the page's are `swap`. A logo that
  redraws in a fallback and snaps into place looks broken; body copy that does the
  same is just fast.

The skill still says Fredoka everywhere. Until someone updates it, this file is the
record of which one won.

## The case study lives here, not on the product's site

`public/case-study.html` — "A party game, an admin console, and 54 deploys" — is the
long-form account of how Famous People got built. It used to sit on
playfamouspeople.com and moved here because it is a story about **how this shop
works**, not about the game: the numbers, the release loop, and the four things that
went wrong are the argument for hiring Pivot Dev Shop, and they were being made on a
site whose only job is signing people up to play.

**The old URL still resolves.** `famous-people`'s `firebase.json` 301s
`playfamouspeople.com/case-study` here, and this repo's `firebase.json` rewrites
`/case-study` to the file so the shared URL keeps its clean shape. That path is out in
the world twice over now — don't rename the file without keeping both in step.

Three things about it that aren't obvious:

- **It carries its own `<style>` block, but no colour of its own.** Every value is a
  token from `/styles.css`, same rule as `index.html`. The one thing it adds is a
  `--chart-mark` / `--chart-mark-mute` pair, and both are steps of the brand violet.
- **The charts are one hue in two steps, not a categorical palette.** Violet is the
  brand, yellow is accent-only and green is CTA-only, which leaves no second or third
  chart hue to reach for — and neither chart needs one, since both show a single
  series where a light step marks the rest and a full-strength step marks the
  emphasised band. The low-contrast light step is allowed only because every chart
  carries a written note *and* a `<details>` table of the same numbers.
- **It still runs no JavaScript.** The `<script type="application/ld+json">` in the head
  is a data block the parser never executes, so `script-src 'none'` neither blocks it
  nor is contradicted by it. Hover tooltips on the charts are `[data-tip]::after`, and
  the expandable data tables are `<details>` — both CSS and HTML, on purpose.

The **screenshots in `public/case-study-media/`** are of Famous People, which is pink.
That does not break "one background hue per page": the rule governs the page's own
surfaces, and this page's are violet throughout. A case study can't recolour the
product it is about.

## Never mix literal values and a var() in the `font:` shorthand

`font: 700 64px/1 var(--font-logo)` is the shape that broke the hero lockup in the
wild while rendering perfectly in Chromium. WebKit drops the whole declaration when
the shorthand is built that way, and the element falls back to the inherited 16px/400
— which on a 64px wordmark is unmissable and on a 17px label is nearly invisible,
so it hides until it hits something big.

Two forms are safe, and the page uses both:

- **Pure substitution**: `font: var(--type-title)`, where the entire value is one
  token. All eleven of these resolve correctly.
- **Longhands**: `font-family: var(--font-logo); font-weight: 700; font-size: 64px;
  line-height: 1;` — what the logo, the buttons and `.card .n` use now.

Chromium renders every version of this identically, so a local screenshot will not
catch a regression here. Grep for `font:` followed by anything before a `var(`.

Three rules the design system says are the ones people break:

- **The logo's arc and arrowhead are always one colour.** Violet on white, white on
  colour. There is no two-tone version.
- **Green is the only CTA colour.** Yellow is an accent — pills, highlights — and never
  a button.
- **One background hue per page.** Violet or pink, never both. The hero is violet, so
  a pink section means dropping the violet one.

Copy has its own rules — contractions, verbs for buttons, numbers over adjectives, the
middle dot `·` as the only decorative punctuation, no emoji, and the turn metaphor at
most once per page (the hero's "one team that turns" is that once). See the skill's
README before rewriting a line.

## The page is deliberately still noindex

`firebase.json` sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on
everything, and `robots.txt` **allows** crawling on purpose — that header only works if
the page is actually fetched, and a URL nobody crawls can still be listed bare. It is
one commented headers block; deleting it is the launch.

## Absent on purpose

No `og:image` (the brand has no chosen imagery, and the design system forbids standing
stock or generated art in for it — a shared link renders as a text card until someone
makes a real one), no photography, no client-logo strip, no testimonials, no pricing,
and no icon set. If a UI ever needs icons, the system says pull Lucide and say so; don't
hand-draw glyphs.

Both faces are already self-hosted, so the CSP names no font host at all — that
follow-up is done rather than pending.
