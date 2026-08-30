# pivot-dev-shop

The placeholder site for **Pivot Dev Shop** — pivotdevshop.com. One static page,
no build step, no framework, no JavaScript.

Pivot Dev Shop is the parent company; **Famous People**
([playfamouspeople.com](https://playfamouspeople.com)) is its first product and
lives in its own two repos, `famous-people` and `famous-people-app`.

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The whole site. Markup and layout CSS only |
| `public/styles.css` + `public/tokens/` | The Pivot Dev Shop design tokens — colour, type, spacing, effects |
| `public/assets/` | The logo mark in violet, white and ink, plus the favicon tile |
| `firebase.json` | Hosting config: headers, caching, CSP, the pre-launch noindex |

Both `tokens/` and `assets/` are copied from the `pivot-dev-shop-design` skill.
They are the source of every colour and size on the page — `index.html` hard-codes
neither. When the design system changes, re-copy them rather than editing values here.

## Deploying

| What | How |
|---|---|
| Live site | Automatic on merge to `main` (`deploy-site.yml`), path-filtered |
| A pull request | Automatic preview URL on its own Firebase channel, expiring in 7 days (`preview.yml`) |

Both need one repository secret, **`FIREBASE_SERVICE_ACCOUNT`**: the full JSON key
for a service account with **Firebase Hosting Admin** in the `pivot-dev-shop` project.
That is the only role hosting needs — the extra roles famous-people documents
(Service Usage Consumer, Firebase Rules Admin, Cloud Datastore User) are for
deploying Firestore rules and running data scripts, neither of which exists here.

Nothing else is configured in this project — no Firestore, no Functions, no Auth — so
a bad deploy can only ever put the wrong page up, and the next merge puts the right
one back.

Preview deploys are skipped on pull requests from forks: they get no secrets, so the
job would fail on the missing key rather than on anything about the change.

## Working on it locally

```
npx --yes http-server public -p 5502 -c-1
```

Open <http://localhost:5502>. There is nothing to install and nothing to build — the
file you edit is the file that ships.

## Things worth knowing before you change something

- **The page is still `noindex`.** `firebase.json` sends
  `X-Robots-Tag: noindex, nofollow` on everything. That header, not `robots.txt`, is
  what keeps a placeholder out of search results — a URL that is never crawled can
  still be listed bare, which is why crawling stays allowed. **Delete that one
  headers block at launch**; it is commented in place.
- **There is no `og:image`.** The brand has no chosen imagery yet, and the design
  system is explicit that stock or generated art must not stand in for it. A shared
  link therefore renders as a text card. Fix it by making a real one, not by
  reaching for a placeholder.
- **Fredoka comes from the Google Fonts CDN**, imported by `tokens/typography.css`.
  For production, self-host the woff2 files, swap that `@import` for `@font-face`
  rules, and drop `fonts.googleapis.com`/`fonts.gstatic.com` from the CSP.
- **Three brand rules that are easy to break**: the logo's arc and arrowhead are
  always one colour; green is the only button colour and yellow is never one; one
  background hue per page — violet or pink, never both.
