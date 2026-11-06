# 🌱 Garden

Personal site: blog posts and games, dressed up as an early-00s engineering
program. Dark IDE styling, a collapsible file explorer, a breadcrumb, and a
content pane. Built with [Vite](https://vite.dev) as a static multi-page site
and deployed to GitHub Pages automatically on every push to `main` via
`.github/workflows/deploy.yml`.

**Live at:** https://tairusen.github.io/garden/

## How it works

```
index.html              the app shell: explorer, breadcrumb, content pane (iframe)
draft/                  ALL site content lives here
  index.html            homepage — 2x2 grid of featured pages
  home.json             picks the four featured pages for the homepage
  *.html                one file per page (posts, notes, ...)
  games/*.html          games, one file per game
src/
  content.css           shared styles for content pages
  links.js              makes "#/path" links open in the shell's pane
vite.config.js          scans draft/ at build time:
                          - every .html file becomes a page automatically
                          - the folder structure becomes the explorer tree
                          - each page's <title> becomes its tree label
                          - draft pages redirect into the shell if opened directly
.github/workflows/      build + deploy on push to main
```

## Working on the site

```sh
npm install       # once
npm run dev       # local preview with hot reload (open the /garden/ URL it prints)
npm run build     # build to dist/ without deploying
npm run preview   # serve the built dist/ locally
```

Note: in `npm run dev`, newly added files appear in the explorer after a
restart (Ctrl+C, `npm run dev` again). The published site always rebuilds
from scratch, so deploys always see everything.

## Adding a page

1. Create `draft/my-post.html` — copy an existing page as a starting point.
   Give it a `<title>`; that's what the explorer shows.
2. Link to it with `href="#/my-post"` from wherever fits (e.g. the homepage).
3. To feature it in the homepage grid, add it to `draft/home.json` (max 4).
4. Commit to `main` and push — the Action deploys in about a minute.

Subfolders just work: `draft/notes/2026/foo.html` appears as
notes › 2026 › foo in the explorer, nested and collapsible. Game pages go in
`draft/games/` (they get the orange ▶ icon).

Rules of thumb:

- Links between pages use `#/path-without-.html` (e.g. `#/games/number-guesser`);
  they open inside the shell's pane.
- CSS/JS references use a leading slash (`/src/content.css`) — Vite rewrites
  them for the `/garden/` subpath at build time.
- Pages opened outside the shell (direct URL) auto-redirect into it.

## The `example/` folder

Reference material only — excluded from the build. Safe to delete.
