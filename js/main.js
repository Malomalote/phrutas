// ============================================================
//  SANDÍA JELLY · Arranque, escalado, entrada y bucle principal
// ============================================================

import { CONFIG, migrarRecordLegacy } from './config.js?v=13';
import { Game } from './core/game.js?v=13';
import { Sound } from './audio/sound.js?v=13';

const stage = document.getElementById('stage');
const canvas = document.getElementById('game-canvas');

// ---------- Escalado responsivo (mundo adaptable a la pantalla) ----------
let viewScale = 1;

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ratio = vh / vw;

  // Mundo adaptable: vertical (ratio > 1.5) crece en ALTO con ancho fijo;
  // horizontal o cuadrado (escritorio/tablet apaisada) crece en ANCHO con
  // alto fijo. En ambos casos el escenario encaja sin recortes.
  let worldW, worldH;
  if (ratio > 1.5) {
    worldW = 720;
    worldH = Math.min(2000, Math.max(1080, Math.round(720 * ratio)));
  } else {
    worldH = 1080;
    worldW = Math.min(1280, Math.max(720, Math.round(1080 * vw / vh)));
  }
  CONFIG.world.width = worldW;
  CONFIG.world.height = worldH;

  // El tarro acompaña: conserva márgenes de 80 lógicos por lado (560 en el
  // mundo mínimo) y crece hasta 880 en los mundos anchos.
  CONFIG.jar.innerWidth = Math.min(880, Math.max(560, worldW - 160));
  CONFIG.jar.centerX = Math.round(worldW / 2);

  const s = Math.min(vw / worldW, vh / worldH);
  const w = Math.floor(worldW * s);
  const h = Math.floor(worldH * s);

  stage.style.width = w + 'px';
  stage.style.height = h + 'px';

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  viewScale = canvas.width / worldW;

  // Bandas DINÁMICAS: medir la interfaz real (px CSS) y convertirla a lógicas
  // para dimensionar las bandas del tarro. Nada la tapa nunca.
  const hud = document.getElementById('hud-top');
  const bottom = document.getElementById('bottom-ui');
  const hudLogical = (hud ? hud.offsetHeight : 70) / s + 55;
  const bottomLogical = (bottom ? bottom.offsetHeight : 90) / s + 26;
  CONFIG.jar.topMargin = Math.min(320, Math.max(110, hudLogical));
  CONFIG.jar.bottomMargin = Math.min(320, Math.max(100, bottomLogical));
  if (window.__game) window.__game.physics.rebuildWalls();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();
// las fuentes web cambian alturas: re-medir cuando estén listas
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => resize());

// ---------- Juego ----------
const game = new Game({ canvas });
window.__game = game; // gancho de QA (capturas/depuración)

migrarRecordLegacy(); // el récord previo a los niveles se hereda a "Muy difícil"

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  game.startDemo();
} else {
  game.abrirMenu(); // menú con selector de nivel; Jugar inicia la partida
}

// ---------- Entrada: puntero ----------
const toWorldX = (clientX) => {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) / rect.width * CONFIG.world.width;
};

canvas.addEventListener('pointermove', (e) => {
  if (game.state === 'playing') game.setAim(toWorldX(e.clientX));
});
canvas.addEventListener('pointerdown', (e) => {
  Sound.init();
  if (game.state === 'playing') {
    game.setAim(toWorldX(e.clientX));
    game.drop();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Entrada: teclado ----------
const KEY = {
  aimStep: 30,
};

window.addEventListener('keydown', (e) => {
  if (e.repeat && !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  switch (e.key) {
    case 'ArrowLeft':
      if (game.state === 'playing') game.setAim(game.aimX - KEY.aimStep);
      e.preventDefault();
      break;
    case 'ArrowRight':
      if (game.state === 'playing') game.setAim(game.aimX + KEY.aimStep);
      e.preventDefault();
      break;
    case ' ':
    case 'Enter':
    case 'ArrowDown':
      Sound.init();
      if (game.state === 'playing') game.drop();
      else if (game.state === 'menu' && !game.overlays.visible) game.start();
      e.preventDefault();
      break;
    case 'a':
    case 'A':
      Sound.init();
      game.soften();
      break;
    case 'q':
    case 'Q':
      game.setTilt(-1, true);
      break;
    case 'e':
    case 'E':
      game.setTilt(1, true);
      break;
    case 'p':
    case 'P':
    case 'Escape':
      game.togglePause();
      break;
    case 'm':
    case 'M':
      game.toggleMute();
      break;
    case 'r':
    case 'R':
      if (game.state === 'gameover' || game.state === 'paused') game.start();
      break;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'q' || e.key === 'Q') game.setTilt(-1, false);
  if (e.key === 'e' || e.key === 'E') game.setTilt(1, false);
});

// Pausa educada al cambiar de pestaña
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') game.togglePause();
});

// ---------- Bucle principal ----------
let last = performance.now();

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(50, t - last); // clamp anti-espiral tras pestañas en segundo plano
  last = t;

  game.update(dt);
  game.render();
}

requestAnimationFrame(frame);
