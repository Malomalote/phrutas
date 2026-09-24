// ============================================================
//  SANDÍA JELLY · Configuración global del juego
//  Única fuente de verdad: constantes, cadena de frutas y textos.
// ============================================================

export const CONFIG = {
  // ----- Mundo lógico (el canvas se escala para encajar en pantalla) -----
  world: {
    width: 720,
    height: 1080,
  },

  // ----- Tarro (zona de juego) -----
  // Bandas DIMÁMICAS: main.js mide el HUD superior y la interfaz inferior
  // (cadena + energía) en cada resize y ajusta topMargin/bottomMargin, de
  // modo que el tarro nunca queda tapado por la interfaz en ningún dispositivo.
  jar: {
    innerWidth: 560,
    topMargin: 170,          // banda superior (HUD) — la ajusta main.js
    bottomMargin: 150,       // banda inferior (cadena + energía) — idem
    centerX: 360,
    wallThickness: 26,       // grosor físico de paredes/suelo (invisible)
    glassThickness: 14,      // grosor visual del cristal
    cornerRadius: 42,        // radio de las esquinas inferiores del cristal
  },

  // ----- Física -----
  physics: {
    gravityY: 1.35,             // gravedad base de Matter (escala propia)
    fixedDt: 1000 / 120,        // paso fijo (ms) con substeps => sin túneles
    maxSubsteps: 5,
    restitution: 0.12,          // rebote bajo: se apilan, no botan como goma
    friction: 0.45,             // fricción tangencial: evita deslizamientos
    frictionStatic: 0.6,
    frictionAir: 0.012,
    density: 0.0018,
    slop: 0.02,
    // Inclinación del tarro (gasta energía). 26°: con fricción reducida
    // durante la inclinación, las frutas deslizan de forma claramente visible.
    tilt: {
      maxAngle: 26 * Math.PI / 180,
      ease: 0.08,
    },
    // Amasar (olas de gelatina): coste alto, efecto gozoso
    soften: {
      cost: 60,
      duration: 2600,           // ms de gelatina reforzada
      jiggleImpulse: 0.9,
    },
  },

  // ----- Energía -----
  energy: {
    max: 100,
    start: 100,
    tiltDrainPerSecond: 10,
    mergeGain: 2,
    regenPerSecond: 0,        // sin regeneración pasiva: gestionar es la gracia
  },

  // ----- Cadena de frutas (11 niveles) -----
  // radius en px del mundo lógico; score = puntos al CREAR ese nivel por fusión
  fruits: [
    { id: 'arandano',  name: 'Arándano',   radius: 17,  score: 1,                      base: '#4c63d2', dark: '#2d3f9e', light: '#8fa3ef', juice: '#5f74e0', deco: 'bloom'   },
    { id: 'cereza',    name: 'Cereza',     radius: 23,  score: 3,                      base: '#e63950', dark: '#a81f38', light: '#ff8fa0', juice: '#ff4d6d', deco: 'stem'    },
    { id: 'uva',       name: 'Uva',        radius: 30,  score: 6,                      base: '#9c53d4', dark: '#6b2fa3', light: '#d3a4f4', juice: '#a55ce0', deco: 'grape'   },
    { id: 'limon',     name: 'Limón',      radius: 38,  score: 10,                     base: '#ffd23f', dark: '#e0a41a', light: '#fff3a3', juice: '#ffe066', deco: 'nipple'  },
    { id: 'naranja',   name: 'Naranja',    radius: 47,  score: 15,                     base: '#ff8c2e', dark: '#e06a12', light: '#ffc38a', juice: '#ffa042', deco: 'pores'   },
    { id: 'manzana',   name: 'Manzana',    radius: 58,  score: 21,                     base: '#8bc34a', dark: '#5d9232', light: '#d3eda4', juice: '#aedn63', deco: 'apple'   },
    { id: 'kiwi',      name: 'Kiwi',       radius: 70,  score: 28,                     base: '#a6763f', dark: '#7a5227', light: '#d4b083', juice: '#8fd14f', deco: 'kiwi'    },
    { id: 'melocoton', name: 'Melocotón',  radius: 84,  score: 36,                     base: '#ffb08a', dark: '#e8835c', light: '#ffd9c2', juice: '#ff9e73', deco: 'peach'   },
    { id: 'coco',      name: 'Coco',       radius: 98,  score: 45,                     base: '#8d6748', dark: '#5f4530', light: '#c4a077', juice: '#f5f0e6', deco: 'coconut' },
    { id: 'melon',     name: 'Melón',      radius: 118, score: 55,                     base: '#d9e5b8', dark: '#a8bd7f', light: '#f4f9e4', juice: '#cfe3a1', deco: 'netting' },
    { id: 'sandia',    name: 'Sandía',     radius: 140, score: 66,                     base: '#3f9b4f', dark: '#2c713a', light: '#7ed48a', juice: '#ff5a6e', deco: 'stripes' },
  ],

  // Nivel dorado secreto: dos sandías fusionadas (mi propio giro)
  golden: {
    tier: 10,                  // índice de la sandía en CONFIG.fruits
    bonusScore: 200,
    label: '¡SANDÍA DORADA!',
  },

  // ----- Aparición -----
  spawn: {
    maxTier: 5,               // niveles 1..5 con probabilidad uniforme
    prePlaced: 4,             // frutas ya dentro del tarro al empezar
    aimY: 110,                // altura a la que flota la fruta lanzable
    dropCooldown: 450,        // ms entre soltar y poder soltar la siguiente
  },

  // ----- Línea de peligro / fin de partida -----
  danger: {
    offsetFromMouth: 75,      // px bajo la boca del tarro (se mueve con él)
    graceMs: 3000,            // margen para seguir soltando y hacerlas bajar
    warnFlashMs: 350,
  },

  // ----- Combo -----
  combo: {
    windowMs: 2200,           // ventana para encadenar fusiones
    maxMultiplier: 8,
  },

  // ----- Cámara / juice -----
  juice: {
    shakePerTier: 1.6,        // px de sacudida por nivel de fruta fusionada
    shakeDecay: 0.90,
    slowmoOnGolden: 900,      // ms de cámara lenta en sandía dorada
  },

  // ----- Almacenamiento -----
  storage: {
    bestScoreKey: 'sandia-jelly-record-v1',   // récord "muy-dificil" (compatibilidad)
    muteKey: 'sandia-jelly-silencio-v1',
    tutorialKey: 'sandia-jelly-tutor-v1',
    recordPrefix: 'sandia-jelly-record-',     // + id de nivel + '-v1'
    nivelKey: 'sandia-jelly-nivel-v1',        // último nivel elegido en el menú
  },
};

// ============================================================
//  Niveles de dificultad — la única variación es el tamaño de las
//  frutas (escala sobre el radio base). Récord independiente por nivel.
// ============================================================
export const DIFICULTADES = [
  { id: 'muy-dificil', nombre: 'Muy difícil', escala: 1.00 },
  { id: 'dificil',     nombre: 'Difícil',     escala: 0.95 },
  { id: 'media',       nombre: 'Media',       escala: 0.90 },
  { id: 'baja',        nombre: 'Baja',        escala: 0.85 },
  { id: 'muy-baja',    nombre: 'Muy baja',    escala: 0.80 },
];

// Escala de frutas de la partida en curso (la fija game.start al elegir
// nivel en el menú). Fruit la lee al construirse.
export let escalaFrutas = 1;
export function fijarEscalaFrutas(v) {
  escalaFrutas = Math.max(0.5, Math.min(1, v));
}

// Récord guardado de un nivel (0 si nunca se jugó)
export function recordDe(nivelId) {
  try {
    return parseInt(localStorage.getItem(CONFIG.storage.recordPrefix + nivelId + '-v1') || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function guardarRecordDe(nivelId, puntos) {
  try {
    localStorage.setItem(CONFIG.storage.recordPrefix + nivelId + '-v1', String(puntos));
  } catch { /* sin storage */ }
}

// Una sola vez: el récord antiguo (previo a los niveles) pasa a "Muy difícil"
export function migrarRecordLegacy() {
  try {
    const viejo = localStorage.getItem(CONFIG.storage.bestScoreKey);
    const claveNueva = CONFIG.storage.recordPrefix + 'muy-dificil-v1';
    if (viejo && !localStorage.getItem(claveNueva)) {
      localStorage.setItem(claveNueva, viejo);
    }
  } catch { /* sin storage */ }
}

// Velocidad de simulación (cámara lenta configurable). Lo usa game.js.
export const TIME = { scale: 1 };

// ============================================================
//  Textos de interfaz (español) — única fuente para UI
// ============================================================
export const STR = {
  title: 'SANDÍA JELLY',
  subtitle: 'Fusión frutal de cuerpo blando',
  tagline: 'Combina frutas iguales y forja la sandía dorada',

  play: 'Jugar',
  resume: 'Continuar',
  restart: 'Reiniciar',
  pause: 'Pausa',
  paused: 'Pausa',
  sound: 'Sonido',
  gameOver: '¡Tarro lleno!',
  finalScore: 'Puntuación final',
  newRecord: '¡NUEVO RÉCORD!',
  best: 'Récord',
  score: 'Puntos',
  next: 'Siguiente',
  energy: 'Energía',
  tiltLeft: 'Inclinar tarro',
  tiltRight: 'Inclinar tarro',
  soften: 'Amasar (−60)',
  softenActive: '¡Gelatina!',
  noEnergy: 'Sin energía',
  combo: '¡COMBO ×',
  warning: '¡Cuidado! El tarro está lleno',
  goldenUnlocked: '¡Has forjado la sandía dorada!',

  controls: {
    mouse: 'Ratón o ← → para apuntar',
    drop: 'Clic, Espacio o ↓ para soltar',
    softenKey: 'Tecla A para amasar',
    pauseKey: 'P o Esc para pausar',
  },

  howto: [
    'Suelta frutas en el tarro y une dos iguales para evolucionarlas.',
    'Cada fusión da +2 de energía: inclina el tarro para que rueden o amasa (−60) para hacer botar la gelatina.',
    'Si la fruta cruza la línea roja, ¡el tarro se desborda!',
  ],

  // Guía contextual de primera vez (coach-mark del rail de energía)
  tutorial: {
    titulo: '⚡ Energía',
    lineas: [
      'Gana +2 por cada fusión.',
      'Mantén Inclinar para inclinar el tarro (10/s).',
      'Con 60, Amasar hace botar la gelatina.',
    ],
    cerrar: 'Entendido',
  },

  footer: 'Hecho con canvas, Matter.js y mucho zumo.',
};
