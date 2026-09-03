# pivot-dev-shop

The placeholder site for Pivot Dev Shop (pivotdevshop.com) — the parent company.
Two static pages — the holding page and a case study — with no build step, no
framework, and **no JavaScript at all**.

Its first product, Famous People, is two separate repos: **famous-people**
(marketing, admin dashboard, Firestore rules) and **famous-people-app** (the game).
Nothing here shares a Firebase project with either of them.

## Ownership

This repo owns hosting for the `pivot-dev-shop` Firebase project and nothing else.
There is no `firestore` block in `firebase.json` because there is no Firestore — if
data ever arrives, the rules belong here, in this repo, rather than in whatever repo
happens to read them first. That is the mistake famous-people documents having made.

## Deploying

| What | How |
|---|---|
| Live site | Automatic on merge to `main` (`deploy-site.yml`), path-filtered |
| PR preview | Automatic per pull request, own channel, expires in 7 days (`preview.yml`) |

One secret, `FIREBASE_SERVICE_ACCOUNT` — the service account JSON, needing **Firebase
Hosting Admin** and nothing more. Don't copy famous-people's IAM list over: the extra
roles there (Service Usage Consumer, Firebase Rules Admin, Cloud Datastore User) exist
for the rules deploy and the data workflow, and that repo's own notes say hosting
worked without them.

Preview jobs are gated on `head.repo.full_name == github.repository`: a fork's pull
request gets no secrets, so without that gate every one of them fails on a missing key
and says nothing about the change.

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
