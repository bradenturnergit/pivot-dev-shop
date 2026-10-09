# pivot-dev-shop

The placeholder site for Pivot Dev Shop (pivotdevshop.com) — the parent company.
Static pages — the holding page, a case study, and a write-up per solution (`/garage`, `/organized`) — with no build step, no
framework, and **one script on the brand pages: `public/analytics.js` (Google Analytics)** — see Analytics.
Plus one private page, `/shipped`, with its own script — see The release log.

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
| Menu data | **Manual** — Actions → Menu data → `report`, then `apply` (CSV imports only) |
| Menu prices | Day to day, from the editor at `menu.pivotdevshop.com/admin` |
| Release log (`/shipped`) | Automatic on every PR merged into `main` in any of the five repos (`release-log.yml`); `import` by hand once, for the history |

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
  several rows. Each document is **`{ name, price }` and nothing else**, priced at the
  lowest price it sold at (the higher ones carry add-ons). It used to carry the whole
  sales history too — a `prices` array, min/max, purchase counts — and a `price`
  inside that array looked exactly like the real one, so it's where the first two
  console edits went and the board never saw them. A one-time script cut every
  document down (bradenturnergit/pivot-dev-shop#9) and was then deleted; the
  history lives only in the CSV now.
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
  price slot is a `data-brink-id` holding the item's SKU (= document id).
  Four items on the board came from the sales export — Salted Caramel
  JavaBlender, Acai Bowl, Acai Bowl with NUTELLA, Bahama Mama Bowl. The other six
  (Dragon Fruit Bowl, PB Protein Crunch, Mixed Berry Greek Yogurt, Chia Oatmeal,
  both drizzles) aren't in the export, so they were added from
  `data/menu-board-items.csv` (Menu data, file `menu-board-items.csv`) at the
  board's printed prices. **Their ids — 50204, 50301, 50302,
  50303, 60401, 60402 — are the board's placeholder Brink ids, not real SKUs.** If
  the real ones turn up, create the documents under them and change the matching
  `data-brink-id` in `menu/index.html` in the same change. Everything in
  `menuItems` that isn't on the board is ignored.
- **To change a price, edit the `price` field on the item's document in the
  Firebase console** (Firestore → `menuItems` → the SKU). The board re-reads every
  60 s, so it shows on screen within a minute with no deploy. `price` must be a
  **number**, not text. There is deliberately no file or workflow for prices: the
  console is the one place they're edited, so nothing can overwrite a change made
  there.
- **CSP needs `script-src 'unsafe-inline'`**: the script is inline in a generated
  file, so a hash would silently break on the next rebuild. No `frame-ancestors`,
  so a signage player can embed the page.
- **Product images are in `menu/images/`** as WebP, cropped to the product and
  sized ~700×580 (2× the slot) for the rail: `acai-bowl-nutella`,
  `bahama-mama-bowl`, `pb-protein-crunch`, `chia-oatmeal`. Two of those were
  supplied on white, not transparent, so the photo rail uses `mix-blend-mode:
  multiply` to drop the white onto the sand panel. The hero,
  `salted-caramel-javablender.webp`, is a transparent cut-out at its native size,
  with the faint haze its cut-out left (alpha under 24) cleared so it doesn't show
  on the orange. Still missing — the board shows a dashed box naming it —
  `chobani-coffee-creamer.png` (the badge).

## The menu price editor (menu.pivotdevshop.com/admin)

`menu/admin/index.html` + `admin.js` — static, no build, Firebase JS SDK from
gstatic. Sign in with an email/password user from Firebase Authentication; the
address must also be in `isEditor()` in `firestore.rules`, which is the actual
lock (a signed-in stranger can read but not write).

**Each cafe has its own price list, and every list has two copies:**

| Cafe | Live (screens read this) | Draft (Save writes this) | Publish log | Screen address |
|---|---|---|---|---|
| default | `menuItems` | `menuItemsDraft` | `menuPublishes` | `/` |
| `1234` | `cafes/1234/items` | `cafes/1234/draft` | `cafes/1234/publishes` | `/?cafe=1234` |

`cafePath()` in `admin.js` and in `menu/index.html` both encode this table —
change one, change the other. `cafes/{id}` itself is an empty document that
exists so the editor can list cafes. A new cafe starts as a copy of the default
menu's prices, and exists only once someone presses Save.

- **Edit → Save → Publish, never skipped.** Save writes changed rows to the
  draft copy; Publish copies drafts that differ from live into live. Publish is
  disabled while there are unsaved edits, lists every change, and needs
  `PUBLISH` typed before the button works — it's the one action here that
  changes what customers see.
- **Discard saved** deletes the drafts that differ from live, so those items
  fall back to their live prices; it never touches live, so it's an ordinary
  confirm rather than a typed one. Draft documents are the only thing the rules
  let a browser delete. ("Discard unsaved" only clears edits on the page.)
- **Undo last publish** reverses the most recent publish that hasn't been
  undone. Each publish writes a log entry — `{ at, by, changes: [{ sku, before,
  after }], undone }` — in the same batch as the live prices, so there's never a
  publish without a way back. Undo sets live *and* draft back to `before` (draft
  too, or the old prices would reappear as a pending change) and marks the entry
  `undone`, again in one batch; pressing it again steps back one more publish.
  Same typed confirmation as Publish (`UNDO`), disabled while anything is
  unsaved or saved-but-unpublished. An item with no `before` — a new cafe's
  first publish — stays as it is. Only publishes made after this existed can be
  undone. Logs are editor-read-only; the rules allow creating one and later
  flipping `undone`, nothing else.
- **Open live menu board ↗** (next to the screen address) opens the cafe's
  plain board in a new tab — what customers see now, no drafts. It only
  appears once the cafe has published prices; before that the address would
  show the board's built-in fallback prices, which isn't this cafe's menu.
- **Preview** opens `/?cafe=…&preview=1`: live, then saved drafts, then the
  page's unsaved edits (handed over in `localStorage` under `menuPreview:<cafe>`
  so a second click updates the tab already open), under a yellow banner. It
  re-reads every 5 s instead of 60.
- **Drafts are publicly readable**, like live prices — the preview tab reads
  them without signing in. Menu prices on a lobby screen aren't secret.
- **Firebase config comes from `/__/firebase/init.json`**, which Firebase
  Hosting serves for the project's registered web app. No web app registered
  means that URL 404s and the page says so.
- **Only SKUs, names and prices.** SKU is the document id and read-only; the
  board's wording and layout aren't in the database, so a name change here
  doesn't change the screen. The "only items on the menu board" filter reads
  the `data-brink-id`s out of `/` itself.
- **`?mock=1`** runs the page on made-up data with no sign-in and no network
  writes — for trying changes to the editor without touching real prices.
- The editor and the board each get their own CSP (`firebase.json`, matched by
  regex on path so they never overlap); the board's is stricter.

## The release log (pivotdevshop.com/shipped)

Braden's private list of everything shipped: every pull request merged into
`main` in **garage, household-docs, pivot-dev-shop, famous-people and
famous-people-app**, grouped by solution (Garage, Organized, Famous People, Menu
Board, this website), newest first, filterable by Feature / Fix / Behind the
scenes. It replaced a claude.ai artifact that a Claude session refreshed every
two hours; this one updates itself and needs no Claude at all.

- **Private means locked.** `public/shipped.html` + `shipped.js` sign in with the
  same email/password users as the menu editor, and `firestore.rules` lets only
  `isEditor()` read `releases`. A stranger with the URL gets a sign-in form and
  nothing else. The page is also `noindex` by its own header block in
  `firebase.json`, separate from the site-wide pre-launch one, so it stays out of
  search after launch. It is linked from nowhere and loads no analytics.
- **No Firebase SDK on the page.** Sign-in, token refresh and the Firestore read
  are plain REST calls (identitytoolkit, securetoken, firestore.googleapis.com),
  so the site-wide CSP keeps `script-src 'self'` plus GA and only gains those
  three hosts in `connect-src`. The refresh token is kept in `localStorage`, so a
  return visit doesn't ask for the password; Sign out forgets it.
- **One document per PR in `releases`**, id `<repo>-<number>`:
  `{ id, repo, number, title, mergedAt (ISO string), url, solution, part, kind }`.
  `release-log/classify.js` decides `solution`/`part` from the repo (and, for
  this repo, whether the title is about the menu) and guesses `kind` from the
  title. **Create-only**, like the menu import: an entry that exists is never
  overwritten, so fixing a title or a wrong `kind` in the Firebase console sticks.
- **How a merge gets here.** This repo's own merges arrive as `pull_request:
  closed` on `release-log.yml`. Each of the other four repos has its own small
  `release-log.yml` that, on a merge into its `main`, sends a `pr-merged`
  `repository_dispatch` to this repo carrying repo, number, title and merge time.
  That needs the **`RELEASE_LOG_TOKEN`** secret in those four repos: one
  fine-grained GitHub token, access to **pivot-dev-shop only**, permission
  **Contents: read and write** (what sending a repository_dispatch takes). Without
  it their run goes red saying so rather than quietly dropping the merge.
  Writing to Firestore uses `FIREBASE_SERVICE_ACCOUNT`, which needs **Cloud
  Datastore User** — already granted for Menu data.
- **The history up to launch** (255 entries from the old artifact, titles and
  kinds as hand-corrected there) was loaded once from `data/releases-seed.json`
  with Actions → Release log → Run workflow (`import`), on 7 Oct 2026, and the
  file was then deleted, like the other backfill files here. `import` with no
  seed file fails rather than importing nothing.
- **No concurrency group on `release-log.yml`.** GitHub keeps one run in a group
  going and only the *newest* waiting, cancelling the rest — the first three
  resends arrived together and two were dropped that way. Each run writes one
  create-only document, so parallel runs are safe.
- **When: All time, Today, Last 7 / 30 days, On a date, Between dates.** Anything but
  All time swaps the solution groups for one list, newest first, with a pill
  naming the project on each line. Days are the browser's local calendar days,
  so "last 7 days" is today and the six before it. The Show filters still apply.
- **The summary card at the top** ("255 changes shipped across 5 solutions ·
  checked for new releases Oct 6, 11:50 PM") keeps the old artifact's wording.
  "Checked" is the moment this page last read `releases` — on open and every
  time the tab comes back to the front — not a separate job.
- **Bump the `?v=` on the `shipped.js` tag whenever `shipped.js` changes.**
  The page is `no-store` but every `.js` is cached for an hour, so without it a
  browser runs the new page against the old script. That happened the first
  time: the old script hit the new When buttons and the page showed
  "Cannot set properties of null" instead of the list.
- A merge whose notification fails isn't retried. Re-running that repo's Release
  log job sends it again; nothing is written twice.

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

`public/case-study.html` — "From pencil sketches to a party game people actually
play" — is the account of how Famous People got built. It used to sit on
playfamouspeople.com and moved here because it is a story about **how this shop
works**, not about the game, and it was being told on a site whose only job is signing
people up to play.

**It is deliberately high level.** It once carried the build numbers (pull requests,
deploys, minutes-to-merge), two charts, the toolkit and four things that went wrong;
Braden cut those in favour of the story the pictures tell — the 15-year-old pencil
sketches next to the screens that shipped. A before/after example went too. Keep
the images; don't put the process statistics back.

**The old URL still resolves.** `famous-people`'s `firebase.json` 301s
`playfamouspeople.com/case-study` here, and this repo's `firebase.json` rewrites
`/case-study` to the file so the shared URL keeps its clean shape. That path is out in
the world twice over now — don't rename the file without keeping both in step.

Two things about it that aren't obvious:

- **It carries its own `<style>` block, but no colour of its own.** Every value is a
  token from `/styles.css`, same rule as `index.html`.
- **It runs no JavaScript.** The only script is the site-wide `analytics.js` (see
  Analytics). The `<script type="application/ld+json">` in the head is a data block
  the parser never executes, so the CSP neither blocks it nor is contradicted by it.

The **screenshots in `public/case-study-media/`** are of Famous People, which is pink.
That does not break "one background hue per page": the rule governs the page's own
surfaces, and this page's are violet throughout. A case study can't recolour the
product it is about.

## The solution pages (/garage, /organized)

`public/garage.html` and `public/organized.html` are short blog-style write-ups of
two things the shop built: **Garage** (repo `garage`, car maintenance and costs) and
**Organized** (repo `household-docs`, household mail and paperwork). The home page's
"Recently built" cards and the footer link to both. Same article shell as the case
study, same tokens-only rule, no JavaScript beyond `analytics.js`; `firebase.json` rewrites each
clean URL to its file, the same single-rewrite shape as `/case-study`.

**The home page's "Recently built" cards are three: Garage, Organized and Famous
People** (the last links to `/case-study`; the footer calls it "Famous People Game").
Each opens on one of those phone screenshots inside an iPhone drawn in CSS — the frame
is not in the image, so the three match exactly. Famous People's is
`public/famous-people-media/start-a-game.webp`, copied from famous-people's
`public/app-media/` (same 780×1688 capture, made-up players). The status-bar strip
above each screenshot is painted in that app's own top colour (`--status` on the card).

**Every screenshot is the real app filled with made-up data — never real data.**
Both apps hold a real family's cars, receipts, bills and names, so the images in
`public/garage-media/` and `public/organized-media/` were taken by running each
app's own code with its Firebase calls swapped for stubs serving an invented
household (example cars, drivers, companies, a sample bill marked as such, an
`example.com` sign-in). No VINs, addresses, account numbers or real family names.
The Garage cars are named Mom’s Car, Rick’s Ride, Amanda’s Runabout and Mike’s
Car, each with a generic studio photo: the white Expedition and blue Mach-E
reuse the Garage app's own (`garage/public/photos/`); the GTI and Wrangler were
supplied by Braden and cut out onto transparency to match. None is a picture
of the family's own cars. Keep it that way when refreshing them: re-run the apps against fake
data, don't screenshot the live sites.

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

## Analytics (Google Analytics 4)

Every brand page loads `/analytics.js` (`defer`, before `</head>`) — the only script on
the site. Kept in a file rather than inline so the CSP stays `script-src 'self'` plus
`www.googletagmanager.com`, with no `'unsafe-inline'`; `connect-src` and `img-src` name
the GA hosts Google documents for its tag. **A new page needs the same `<script>` line**,
or it isn't counted.

- **`MEASUREMENT_ID` at the top of the file is the GA4 web stream's id** —
  `G-BGD89080Q2`, the pivotdevshop.com property. Set it back to the `G-XXXXXXXXXX`
  placeholder and the file does nothing at all.
- **Only `pivotdevshop.com` and `www.` are counted.** PR previews, `*.web.app` and
  localhost load nothing, so our own checking doesn't pad the numbers.
- **Visits, page views, referrers and outbound clicks are GA4's own** (enhanced
  measurement). The file adds two events: `cta_click` (every `.btn` and every `mailto:`
  link, with `cta_text`, `cta_location` — header / hero / bottom / footer — and
  `cta_destination`, which is `email` for mailto rather than the address) and
  `work_card_click` (`card_name`). One delegated listener, so new links of either kind
  are picked up without editing it.
- **`cta_location` and the other parameters only appear in GA reports once they are
  registered as custom dimensions** (Admin → Custom definitions). The events
  themselves show up without that.
- Not the same GA property as playfamouspeople.com (`G-B1973HB54T`, in famous-people).
  Separate sites, separate numbers.
- There is no privacy page or cookie banner. GA sets cookies; if the site starts
  targeting visitors in the EU/UK, that is the thing to add.

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
