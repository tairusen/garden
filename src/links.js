// Links to other garden pages use "#/path" (e.g. <a href="#/games/pong">).
// Inside the shell, the target page must open in the parent frame's pane,
// so we rewrite the hash on the top-level window instead of this page's.

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link) return;
  event.preventDefault();
  const top = window.top === window ? window : window.parent;
  try {
    if (top.location.hash === link.getAttribute('href')) return;
    top.location.hash = link.getAttribute('href');
  } catch {
    window.location.href = link.getAttribute('href'); // fallback: navigate this frame
  }
});
