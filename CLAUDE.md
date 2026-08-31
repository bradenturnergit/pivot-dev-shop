# pivot-dev-shop

The placeholder site for Pivot Dev Shop (pivotdevshop.com) — the parent company.
One static page, no build step, no framework, and **no JavaScript at all**.

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
