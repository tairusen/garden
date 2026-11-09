import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, relative, basename, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const draftDir = resolve(root, 'draft');
const editorDir = resolve(root, 'editor');
const BASE = '/garden/';

// ===== Content scan =====
// Every .html file under draft/ becomes a page. Each page's <title> becomes
// its default label in the explorer.

function pageTitle(file, fallback) {
  try {
    const html = readFileSync(file, 'utf8');
    const m = html.match(/<title>([^<]*)<\/title>/i);
    if (m && m[1].trim()) return m[1].trim(); // empty <title> falls back to the filename
  } catch {
    /* fall through to fallback */
  }
  return fallback;
}

function scanDraft(dir = draftDir, prefix = '') {
  const dirs = [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = resolve(dir, entry.name);
    if (statSync(full).isDirectory()) {
      const name = entry.name;
      dirs.push({ type: 'dir', name, path: prefix + name, children: scanDraft(full, prefix + name + '/') });
    } else if (entry.name.endsWith('.html')) {
      const name = entry.name.replace(/\.html$/, '');
      files.push({ type: 'file', name, path: prefix + entry.name, title: pageTitle(full, name) });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  dirs.sort(byName);
  files.sort(byName);
  files.sort((a, b) => (a.name === 'index' ? -1 : b.name === 'index' ? 1 : 0));
  return [...dirs, ...files];
}

function collectPages(nodes, map = new Map()) {
  for (const node of nodes) {
    if (node.type === 'dir') collectPages(node.children, map);
    else map.set(node.path, node);
  }
  return map;
}

// ===== Explorer tree + home cards =====
// draft/explorer.json controls what the explorer shows and in what order
// (folders can be virtual groupings — they don't have to match disk layout).
// Any page on disk that isn't listed is appended at the end automatically,
// so newly dropped files never go missing. Both are recomputed on demand so
// dev-server requests always reflect the current files on disk.

function loadExplorerTree() {
  const diskChildren = scanDraft();
  const diskPages = collectPages(diskChildren);
  const autoTree = { type: 'dir', name: 'draft', path: '', children: diskChildren };
  let raw;
  try {
    raw = JSON.parse(readFileSync(resolve(draftDir, 'explorer.json'), 'utf8'));
  } catch (err) {
    console.warn(`Could not read draft/explorer.json (${err.message}) — explorer is auto-generated.`);
    return autoTree;
  }
  if (!Array.isArray(raw.items)) {
    console.warn('draft/explorer.json has no "items" array — explorer is auto-generated.');
    return autoTree;
  }

  const listed = new Set(); // pages mentioned in the JSON
  const takenKeys = new Set(); // unique collapse-state keys for folders

  function normalize(items) {
    const nodes = [];
    for (const item of items) {
      if (item.page) {
        const disk = diskPages.get(item.page);
        if (!disk) {
          // If a file with the same name exists elsewhere, point at it —
          // usually means the file was moved without updating the config.
          const base = item.page.split('/').pop();
          const candidates = [...diskPages.keys()].filter((p) => p.split('/').pop() === base);
          const hint = candidates.length === 1 ? ` — did you mean "${candidates[0]}"?` : '';
          console.warn(`explorer.json: no such page "${item.page}"${hint} — skipped.`);
          continue;
        }
        listed.add(item.page);
        nodes.push({
          type: 'file',
          name: disk.name,
          path: disk.path,
          title: item.label || disk.title,
          ...(item.icon ? { icon: item.icon } : {}),
        });
      } else if (item.name && Array.isArray(item.items)) {
        let key = item.name;
        for (let n = 2; takenKeys.has(key); n++) key = `${item.name}#${n}`;
        takenKeys.add(key);
        nodes.push({
          type: 'dir',
          name: item.label || item.name,
          path: key, // only used as the collapse-state key
          children: normalize(item.items),
        });
      } else {
        console.warn(`explorer.json: skipping malformed item ${JSON.stringify(item)}`);
      }
    }
    return nodes;
  }

  const children = normalize(raw.items);
  for (const [path, node] of diskPages) {
    if (!listed.has(path)) children.push(node);
  }
  return { type: 'dir', name: 'draft', path: '', children };
}

function loadHomeCards() {
  try {
    const json = JSON.parse(readFileSync(resolve(draftDir, 'home.json'), 'utf8'));
    if (Array.isArray(json.cards)) {
      const diskPages = collectPages(scanDraft());
      for (const card of json.cards) {
        if (card.page && !diskPages.has(card.page)) {
          console.warn(`home.json: no such page "${card.page}" — card will not navigate.`);
        }
      }
      return json.cards;
    }
    console.warn('draft/home.json has no "cards" array — home grid will be empty.');
  } catch (err) {
    console.warn(`Could not read draft/home.json (${err.message}) — home grid will be empty.`);
  }
  return [];
}

// ===== Timestamps =====
// True "last edited" times come from git: CI checkouts reset file mtimes to
// the build moment, so file stamps are useless on the deployed site. Files
// with uncommitted changes (live local editing) fall back to mtime.

function gitTimes() {
  const commits = new Map(); // repo-relative path -> { ts, time }
  const dirty = new Set();
  try {
    const log = execFileSync('git', ['log', '--name-only', '--format=%cI', '--', 'draft'],
      { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
    let iso = null;
    for (const line of log.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { iso = t; continue; }
      if (iso && !commits.has(t)) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
        if (m) commits.set(t, { ts: Date.parse(iso), time: `${m[3]}:${m[2]}:${m[1].slice(2)} ${m[4]}:${m[5]}` });
      }
    }
  } catch {
    /* no git or no history — the mtime fallback covers it */
  }
  try {
    const st = execFileSync('git', ['status', '--porcelain', '--', 'draft'],
      { cwd: root, encoding: 'utf8', timeout: 5000 });
    for (const line of st.split('\n')) {
      const f = line.slice(3).trim();
      if (f && !f.includes('->')) dirty.add(f);
    }
  } catch {
    /* ignore */
  }
  return { commits, dirty };
}

// Every page with its last-edited time, most recent first — powers the
// homepage's "Recently edited" box.
function loadRecentPages() {
  const pages = collectPages(scanDraft());
  const { commits, dirty } = gitTimes();
  const entries = [];
  for (const [path, node] of pages) {
    const rel = 'draft/' + path;
    const commit = commits.get(rel);
    let time, ts;
    if (commit && !dirty.has(rel)) {
      ({ ts, time } = commit); // committed: the commit's own local time
    } else {
      try {
        ts = statSync(resolve(draftDir, path)).mtime.getTime();
      } catch {
        continue; // unreadable file — skip it
      }
      time = formatStamp(new Date(ts)); // uncommitted local edits: live mtime
    }
    entries.push({ path, name: node.title || node.name, time, ts });
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries.map(({ path, name, time }) => ({ path, name, time }));
}

// ===== Build plugin =====
// Injects the tree + home cards into every built page as window.GARDEN, makes
// draft pages redirect into the shell when opened outside the iframe, and
// stamps each draft page's meta line with the file's last-modified time.

function formatStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}:${p(date.getMonth() + 1)}:${p(date.getFullYear() % 100)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Replace the content of the page's meta div with the generated timestamp,
// injecting a meta div after the heading if the page doesn't have one.
function stampMeta(html, page) {
  const rel = 'draft/' + page + '.html';
  const { commits, dirty } = gitTimes();
  const commit = commits.get(rel);
  let time;
  if (commit && !dirty.has(rel)) {
    time = commit.time; // committed: the commit's own local time
  } else {
    try {
      time = formatStamp(statSync(resolve(draftDir, page + '.html')).mtime);
    } catch {
      return html;
    }
  }
  // Opt-in only: the stamp is generated inside a <div class="metadata"> (its
  // existing content is replaced). Pages without one — games, tools — are
  // never touched, no matter what else their markup contains.
  const re = /(<div[^>]*class="[^"]*\bmetadata\b[^"]*">)[\s\S]*?<\/div>/i;
  if (!re.test(html)) return html;
  return html.replace(re, `$1(UPDATED ${time})</div>`);
}

function gardenPlugin() {
  return {
    name: 'garden-meta',
    // Built pages are published under prod/ (dist/prod/...) even though their
    // sources live in draft/ — keeps source folder names out of public URLs.
    // Done after writing (closeBundle) because html output paths come from the
    // source tree and can't be renamed through the bundle.
    closeBundle() {
      const from = resolve(root, 'dist', 'draft');
      const to = resolve(root, 'dist', 'prod');
      try {
        rmSync(to, { recursive: true, force: true });
        renameSync(from, to);
      } catch {
        /* no draft output to move */
      }
    },
    transformIndexHtml(html, ctx) {
      const id = String(ctx.filename || ctx.path || '').replace(/\\/g, '/');
      // Dev serves draft/ sources in place; the build relocates them under prod/.
      const contentDir = ctx.server ? 'draft' : 'prod';
      const payload = {
        base: BASE,
        contentBase: BASE + contentDir + '/',
        tree: loadExplorerTree(),
        home: loadHomeCards(),
        recent: loadRecentPages(),
      };
      let inject = `<script>window.GARDEN=${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;

      const m = id.match(/\/draft\/(.*)\.html$/);
      let out = html;
      if (m) {
        const page = m[1]; // e.g. "games/number-guesser"
        const target = page === 'index' ? BASE : `${BASE}#/${page}`;
        // Only redirect when served over http(s) — opened from disk (file://)
        // the /garden/ prefix would resolve to a meaningless file:/// URL.
        inject += `<script>if(location.protocol.indexOf('http')===0&&window.top===window)location.replace(${JSON.stringify(target)})</script>`;
        out = stampMeta(out, page);
      }
      const withHead = out.replace(/<\/head>/i, `${inject}\n</head>`);
      return withHead === out ? inject + out : withHead;
    },
  };
}

// ===== Dev-only editor API (never included in builds) =====
// Serves editor/ at /editor and exposes small local endpoints so the editor
// can read and write draft/ contents on disk. Localhost only by nature:
// vite's dev server does not accept external connections by default.

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

// Resolve a relative path inside a base directory, refusing escapes.
function safeJoin(base, rel) {
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) throw new Error('Path escapes the allowed folder');
  return full;
}

function pageTemplate(title) {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    `<title>${safeTitle}</title>\n` +
    '<link rel="stylesheet" href="/src/content.css">\n' +
    '<script type="module" src="/src/links.js"></scr' + 'ipt>\n' +
    '</head>\n<body>\n' +
    `<h1>${safeTitle}</h1>\n<div class="metadata"></div>\n\n` +
    '<p>Start writing.</p>\n\n</body>\n</html>\n'
  );
}

function gardenDevApi() {
  return {
    name: 'garden-dev-api',
    apply: 'serve', // dev only — never exists in the deployed site
    configureServer(server) {
      const readBody = (req, asBuffer = false) =>
        new Promise((resolveBody, rejectBody) => {
          const chunks = [];
          let size = 0;
          req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 10 * 1024 * 1024) {
              rejectBody(new Error('Request too large (10 MB limit)'));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', () => resolveBody(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
          req.on('error', rejectBody);
        });

      const sendJson = (res, code, data) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };

      const sendFile = (res, file) => {
        const type = MIME[extname(file).toLowerCase()];
        if (!type) throw new Error('Unsupported file type');
        res.setHeader('Content-Type', type);
        res.end(readFileSync(file));
      };

      const requirePagePath = (searchParams) => {
        const rel = searchParams.get('path') || '';
        if (!rel.endsWith('.html')) throw new Error('Only .html paths are allowed');
        return safeJoin(draftDir, rel);
      };

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname.replace(new RegExp(`^${BASE}`), '/'); // works with or without /garden prefix

        try {
          // ----- editor static files -----
          if (pathname === '/editor' || pathname.startsWith('/editor/')) {
            const rel = pathname === '/editor' || pathname === '/editor/' ? 'index.html' : pathname.slice('/editor/'.length);
            sendFile(res, safeJoin(editorDir, rel));
            return;
          }

          if (!pathname.startsWith('/api/')) return next();

          // ----- tree -----
          if (pathname === '/api/tree' && req.method === 'GET') {
            sendJson(res, 200, { children: scanDraft() });
            return;
          }

          // ----- pages -----
          if (pathname === '/api/page' && req.method === 'GET') {
            const file = requirePagePath(url.searchParams);
            sendJson(res, 200, { html: readFileSync(file, 'utf8') });
            return;
          }
          if (pathname === '/api/page' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const file = requirePagePath(new URLSearchParams({ path: body.path }));
            if (typeof body.html !== 'string') throw new Error('Missing html');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, body.html);
            sendJson(res, 200, { ok: true });
            return;
          }
          if (pathname === '/api/page/new' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const file = requirePagePath(new URLSearchParams({ path: body.path }));
            if (existsCheck(file)) throw new Error('A page with that path already exists');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, pageTemplate(String(body.title || 'Untitled')));
            sendJson(res, 200, { ok: true });
            return;
          }
          if (pathname === '/api/page' && req.method === 'DELETE') {
            const file = requirePagePath(url.searchParams);
            if (!existsCheck(file)) throw new Error('No such page');
            unlinkSync(file);
            sendJson(res, 200, { ok: true });
            return;
          }

          // ----- config files (explorer.json / home.json) -----
          if (pathname === '/api/config' && req.method === 'GET') {
            const name = url.searchParams.get('name');
            if (name !== 'explorer' && name !== 'home') throw new Error('Unknown config');
            const file = resolve(draftDir, `${name}.json`);
            sendJson(res, 200, { json: readFileSync(file, 'utf8') });
            return;
          }
          if (pathname === '/api/config' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const name = body.name;
            if (name !== 'explorer' && name !== 'home') throw new Error('Unknown config');
            JSON.parse(body.json); // must be valid JSON before it touches disk
            writeFileSync(resolve(draftDir, `${name}.json`), body.json.endsWith('\n') ? body.json : body.json + '\n');
            sendJson(res, 200, { ok: true });
            return;
          }

          // ----- images -----
          if (pathname === '/api/image' && req.method === 'POST') {
            const name = basename(url.searchParams.get('name') || '');
            if (!name || !IMAGE_EXT.has(extname(name).toLowerCase())) throw new Error('Unsupported image type');
            const dir = resolve(draftDir, 'images');
            mkdirSync(dir, { recursive: true });
            const buf = await readBody(req, true);
            writeFileSync(resolve(dir, name), buf);
            sendJson(res, 200, { ok: true, name });
            return;
          }

          sendJson(res, 404, { error: 'Unknown API route' });
        } catch (err) {
          sendJson(res, 400, { error: String(err.message || err) });
        }
      });

      function existsCheck(file) {
        try {
          statSync(file);
          return true;
        } catch {
          return false;
        }
      }
    },
  };
}

export default defineConfig({
  // The site is served from https://tairusen.github.io/garden/ (a subpath,
  // not the domain root), so asset URLs must be prefixed with /garden/.
  base: BASE,
  plugins: [gardenPlugin(), gardenDevApi()],
  build: {
    rollupOptions: {
      input: {
        // The shell is the page for the root URL; everything else lives in draft/.
        index: resolve(root, 'index.html'),
        ...Object.fromEntries(
          (function findHtml(dir = draftDir, files = []) {
            for (const entry of readdirSync(dir)) {
              if (entry.startsWith('.')) continue;
              const full = resolve(dir, entry);
              if (statSync(full).isDirectory()) findHtml(full, files);
              else if (entry.endsWith('.html')) files.push(full);
            }
            return files;
          })().map((file) => ['prod/' + relative(draftDir, file).replace(/\\/g, '/').replace(/\.html$/, ''), file])
        ),
      },
    },
  },
});
