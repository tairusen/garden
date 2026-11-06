import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const draftDir = resolve(root, 'draft');
const BASE = '/garden/';

// ===== Content scan =====
// Every .html file under draft/ becomes a page. Each page's <title> becomes
// its default label in the explorer.

function pageTitle(file, fallback) {
  try {
    const html = readFileSync(file, 'utf8');
    const m = html.match(/<title>([^<]*)<\/title>/i);
    if (m) return m[1].trim();
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

const diskChildren = scanDraft();
const diskPages = collectPages(diskChildren);

// ===== Explorer tree =====
// draft/explorer.json controls what the explorer shows and in what order
// (folders can be virtual groupings — they don't have to match disk layout).
// Any page on disk that isn't listed is appended at the end automatically,
// so newly dropped files never go missing.

function loadExplorerTree() {
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
          console.warn(`explorer.json: no such page "${item.page}" — skipped.`);
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

const tree = loadExplorerTree();
const homeCards = loadHomeCards();

// ===== Build plugin =====
// Injects the tree + home cards into every built page as window.GARDEN, and
// makes draft pages redirect into the shell when opened outside the iframe.

function gardenPlugin() {
  return {
    name: 'garden-meta',
    transformIndexHtml(_html, ctx) {
      const id = String(ctx.filename || ctx.path || '').replace(/\\/g, '/');
      const payload = { base: BASE, tree, home: homeCards };
      const tags = [
        {
          tag: 'script',
          injectTo: 'head',
          children: `window.GARDEN=${JSON.stringify(payload).replace(/</g, '\\u003c')}`,
        },
      ];
      const m = id.match(/\/draft\/(.*)\.html$/);
      if (m) {
        const page = m[1]; // e.g. "games/number-guesser"
        const target = page === 'index' ? BASE : `${BASE}#/${page}`;
        tags.push({
          tag: 'script',
          injectTo: 'head',
          children: `if(window.top===window)location.replace(${JSON.stringify(target)})`,
        });
      }
      return tags;
    },
  };
}

export default defineConfig({
  // The site is served from https://tairusen.github.io/garden/ (a subpath,
  // not the domain root), so asset URLs must be prefixed with /garden/.
  base: BASE,
  plugins: [gardenPlugin()],
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
          })().map((file) => ['draft/' + relative(draftDir, file).replace(/\\/g, '/').replace(/\.html$/, ''), file])
        ),
      },
    },
  },
});
