// Each game lives in its own module like this one, loaded from its
// games/*.html page with: <script type="module" src="/src/your-game.js"></script>
// You can also split code across files with plain ES imports, and install
// npm libraries if you ever want a game engine.

const button = document.querySelector('#click-target');
const count = document.querySelector('#count');

let clicks = 0;
button.addEventListener('click', () => {
  clicks += 1;
  count.textContent = String(clicks);
});
