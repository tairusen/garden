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
  explorer.json         controls what the explorer shows and in what order
  *.html                one file per page (posts, notes, ...)
  games/*.html          games, one file per game
src/
  content.css           shared styles for content pages
  links.js              makes "#/path" links open in the shell's pane
vite.config.js          scans draft/ at build time:
                          - every .html file becomes a page automatically
                          - draft/explorer.json drives the explorer tree
                          - each page's <title> is its default explorer label
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
2. Add it to `draft/explorer.json` wherever you want it listed (leave it out
   and it still appears, auto-appended at the bottom).
3. Link to it with `href="#/my-post"` from wherever fits (e.g. the homepage).
4. To feature it in the homepage grid, add it to `draft/home.json` (max 4).
5. Commit to `main` and push — the Action deploys in about a minute.

Note: in `npm run dev`, newly added files appear after a dev-server restart
(Ctrl+C, `npm run dev` again). The published site always rebuilds from
scratch, so deploys always see everything.

Rules of thumb:

- Links between pages use `#/path-without-.html` (e.g. `#/games/number-guesser`);
  they open inside the shell's pane.
- CSS/JS references use a leading slash (`/src/content.css`) — Vite rewrites
  them for the `/garden/` subpath at build time.
- Pages opened outside the shell (direct URL) auto-redirect into it.

## Explorer config (`draft/explorer.json`)

The explorer is fully under your control. `page` paths are relative to
`draft/` and include the `.html`; `label` overrides the page's `<title>`;
`icon` overrides the automatic icon (`home` = green ⌂, `game` = orange ▶,
`file` = gray ▬ — default: home for `index.html`, game under `games/`):

```json
{
  "items": [
    { "page": "index.html", "label": "Home" },
    { "page": "introduction.html" },
    {
      "name": "notes",
      "label": "Notes",
      "items": [{ "page": "notes/2026/foo.html", "icon": "game" }]
    }
  ]
}
```

- Folders are free-form groupings — they don't have to match disk layout, so
  you can organize pages however you like.
- A page on disk that isn't listed is appended at the end of the explorer
  automatically, so newly dropped files never go missing.
- A `page` in the JSON that doesn't exist on disk is skipped with a build
  warning, so typos are easy to spot.
- The explorer pane hides/shows via the ☰ button in the title bar or
  `Ctrl+B` (`Cmd+B` on Mac). The state is remembered per browser.

## The `example/` folder

Reference material only — excluded from the build. Safe to delete.
