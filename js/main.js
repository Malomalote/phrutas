// ============================================================
//  SANDÍA JELLY · Arranque, escalado, entrada y bucle principal
// ============================================================

import { CONFIG, migrarRecordLegacy } from './config.js?v=18';
import { Game } from './core/game.js?v=18';
import { Sound } from './audio/sound.js?v=18';

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

  // tope 2×: los sprites ya vienen supermuestreados y por encima no se aprecia
  // diferencia, pero cada píxel extra se borra y repinta en cada fotograma
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  if (window.__game) {
    window.__game.physics.rebuildWalls();
    wakeLoop(); // redimensionar borra el canvas: repintar aunque el bucle duerma
  }
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

// El audio se suspende en pausa y con la pestaña oculta (en cualquier estado)
const syncAudioPause = () => Sound.setPaused(document.hidden || game.state === 'paused');

game.onStateChange = (state) => {
  document.body.dataset.estado = state; // el CSS pausa animaciones decorativas
  syncAudioPause();
  wakeLoop();
};
document.body.dataset.estado = game.state;

// Pausa educada al cambiar de pestaña
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') game.togglePause();
  syncAudioPause();
});

// ---------- Bucle principal ----------
// Tope de ~60 fps: en pantallas de 90/120 Hz se saltan fotogramas de rAF.
// Con la escena quieta (game.isIdle) el bucle se duerme tras pintar el último
// fotograma; wakeLoop() lo reanuda al cambiar de estado o redimensionar.
const FRAME_MS = 1000 / 60;
let last = performance.now();
let nextAt = 0;
let rafId = 0;

function frame(t) {
  rafId = 0;
  if (t < nextAt - 2) { // margen para el jitter de 60 Hz
    rafId = requestAnimationFrame(frame);
    return;
  }
  nextAt = t - nextAt > FRAME_MS ? t + FRAME_MS : nextAt + FRAME_MS;
  const dt = Math.max(0, Math.min(50, t - last)); // clamp anti-espiral tras pestañas en segundo plano
  last = t;

  game.update(dt);
  game.render();
  if (!game.isIdle) rafId = requestAnimationFrame(frame);
}

function wakeLoop() {
  if (rafId) return;
  last = performance.now();
  nextAt = 0;
  rafId = requestAnimationFrame(frame);
}

wakeLoop();
