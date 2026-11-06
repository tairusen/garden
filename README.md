# 🌱 Garden

Personal site: blog posts and games. Built with [Vite](https://vite.dev) as a
static multi-page site and deployed to GitHub Pages automatically on every push
to `main` via the workflow in `.github/workflows/deploy.yml`.

**Live at:** https://tairusen.github.io/garden/

## Structure

```
index.html              homepage
blog/                   one .html file per post, plus an index.html listing
games/                  one .html file per game, plus an index.html listing
src/                    shared CSS and per-page JS modules
vite.config.js          picks up every .html file automatically; sets /garden/ base
.github/workflows/      build + deploy on push to main
```

## Working on the site

```sh
npm install       # once
npm run dev       # local preview with hot reload (open the /garden/ URL it prints)
npm run build     # build to dist/ without deploying
npm run preview   # serve the built dist/ locally
```

## Adding a page

1. Create `blog/my-post.html` (or `games/my-game.html`) — copy an existing page
   as a starting point.
2. Link to it from `index.html` and the matching `blog/index.html` /
   `games/index.html` listing.
3. Commit to `main` and push. The Action builds and deploys; watch progress in
   the repo's **Actions** tab. Live in about a minute.

Rules of thumb:

- **Links between pages** must be relative (`first-post.html`, `../index.html`)
  because the site lives under the `/garden/` subpath.
- **CSS and JS** are referenced with a leading slash (`/src/style.css`) — Vite
  rewrites these to the right path at build time.
- New `.html` files anywhere in the repo are picked up automatically; no config
  changes needed.

Deployments also work from the GitHub web editor: edit a file, commit to
`main`, done. `main` always shows exactly what is published — drafts stay
outside this repo until they're ready.
