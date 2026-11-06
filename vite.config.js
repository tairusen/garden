import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Collect every .html file in the project, so dropping a new file anywhere
// (index.html, blog/whatever.html, games/whatever.html, ...) is automatically
// built as its own page. No config changes needed to add a page.
function findHtmlFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      findHtmlFiles(full, files);
    } else if (name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

export default defineConfig({
  // The site is served from https://tairusen.github.io/garden/ (a subpath,
  // not the domain root), so asset URLs must be prefixed with /garden/.
  base: '/garden/',
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        findHtmlFiles(root).map((file) => [
          relative(root, file).replace(/\.html$/, ''), // e.g. "blog/first-post"
          file,
        ])
      ),
    },
  },
});
