// ============================================================
//  SANDÍA JELLY · Sistema de partículas (Canvas 2D puro)
//  Pooling manual sin churn de GC · mundo lógico 720×1080
// ============================================================

const MAX = 900;             // tope duro de partículas vivas
const TAU = Math.PI * 2;

// Tipos numéricos (comparación rápida sin strings)
const K_DROP = 0;        // gota redonda de zumo
const K_TEARDROP = 1;    // gota lágrima orientada a velocidad
const K_BIT = 2;         // micro-brizna brillante
const K_PULP = 3;        // trozo de pulpa poligonal
const K_SPARKLE = 4;     // estrella de 4 puntas
const K_RING = 5;        // onda expansiva (fina o difusa)
const K_CONFETTI = 6;    // confeti rectangular con flip 3D falso
const K_DUST = 7;        // mota de polvo de aterrizaje

const LAYER_BACK = 0;    // detrás del cristal
const LAYER_FRONT = 1;   // sobre el cristal

const DEFAULT_CONFETTI = [
  '#ff3860', '#ffd23f', '#ff7a1f', '#4fe34f',
  '#3f8cff', '#c85cff', '#2fe6c8', '#fff04d',
];

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return (a + Math.random() * (b - a + 1)) | 0; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function easeOutCubic(p) { return 1 - (1 - p) ** 3; }

// ----- color: '#rrggbb' → rgb / hsl -----
function hexToRgb(hex) {
  let h = hex || '#ffffff';
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hexToHsl(hex) {
  const c = hexToRgb(hex);
  return rgbToHsl(c.r, c.g, c.b);
}

function hsl(h, s, l) {
  return `hsl(${h.toFixed(0)}, ${clamp(s, 0, 100).toFixed(0)}%, ${clamp(l, 0, 100).toFixed(0)}%)`;
}

// Fábrica de partícula: forma plana estable (hidden class compartida)
function blank() {
  return {
    kind: 0, layer: 0,
    x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1,
    t: 0, life: 1,
    rot: 0, vr: 0,
    size: 0, size1: 0,
    a0: 1, stretch: 0,
    fill: '#ffffff', rgb: '255,255,255',
    seed: 0, tw: 0,
    r0: 0, r1: 0, w: 0,
    nv: 0, va: new Float32Array(5), vrad: new Float32Array(5),
    fw: 0, fh: 0, flip: 0, flipV: 0,
  };
}

export class ParticleSystem {
  constructor() {
    this._live = [];
    this._free = new Array(MAX);
    for (let i = 0; i < MAX; i++) this._free[i] = blank();
  }

  // ----- pool -----
  _spawn() {
    const p = this._free.pop();
    if (!p) return null; // tope alcanzado: se ignora con gracia
    this._live.push(p);
    return p;
  }

  _recycle(i) {
    const live = this._live;
    const p = live[i];
    const last = live.pop();
    if (i < live.length) live[i] = last; // swap-remove seguro hacia atrás
    this._free.push(p);
  }

  // ----- emisión: explosión de zumo al fusionar -----
  juiceBurst(x, y, color, radius, opts = {}) {
    let { h, s, l } = hexToHsl(color);
    const bvx = opts.vx || 0;      // hereda algo de la velocidad de la fruta
    const bvy = opts.vy || 0;
    const boost = opts.boost || 1;
    // Zumo VIBRANTE: saturación ≥85% y luminosidad 55-70%.
    // Tonos apagados (saturación <25%, caso coco) → blanco-crema #f5f0e6.
    const cremoso = s < 25;
    if (cremoso) {
      const c = hexToHsl('#f5f0e6');
      h = c.h; s = c.s; l = c.l;
    } else {
      s = Math.max(s, 85);
      l = clamp(l, 55, 70);
    }

    const n = randInt(16, 24);
    for (let i = 0; i < n; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = Math.random() < 0.3 ? K_TEARDROP : K_DROP;
      p.layer = LAYER_BACK;
      p.x = x + rand(-radius * 0.3, radius * 0.3);
      p.y = y + rand(-radius * 0.3, radius * 0.3);
      // radial con sesgo hacia arriba
      const a = Math.random() < 0.65 ? -Math.PI / 2 + rand(-1.3, 1.3) : rand(0, TAU);
      const sp = clamp(rand(120, 430) * (0.65 + radius / 260) * boost, 80, 640);
      p.vx = Math.cos(a) * sp + bvx * 0.4;
      p.vy = Math.sin(a) * sp + bvy * 0.4 - 60;
      p.g = rand(1250, 1700);
      p.drag = 1;
      p.t = 0;
      p.life = rand(420, 760);
      p.rot = 0; p.vr = 0;
      p.size = rand(2, 6);                 // gotas 2-6px
      p.size1 = p.size * rand(0.3, 0.45); // shrink
      p.stretch = 1;                       // squash & stretch por velocidad
      p.a0 = rand(0.85, 1);
      p.fill = cremoso
        ? hsl(h + rand(-6, 6), s, clamp(l + rand(-6, 6), 40, 92))
        : hsl(h + rand(-6, 6), clamp(s + rand(-6, 6), 85, 100), clamp(l + rand(-8, 8), 55, 70));
    }

    // micro-briznas brillantes
    const m = randInt(8, 14);
    for (let i = 0; i < m; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_BIT;
      p.layer = LAYER_BACK;
      p.x = x; p.y = y;
      const a = rand(0, TAU);
      const sp = rand(240, 580) * boost;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 120;
      p.g = rand(500, 950);
      p.drag = 0.985;
      p.t = 0;
      p.life = rand(220, 430);
      p.size = rand(1.2, 2.6);
      p.size1 = p.size;
      p.stretch = 0;
      p.a0 = rand(0.7, 1);
      p.fill = Math.random() < 0.6 ? '#ffffff' : hsl(h, s * 0.5, l + 34);
    }
  }

  // ----- emisión: trozos de pulpa (polígonos irregulares) -----
  pulpBurst(x, y, color, radius) {
    const { h, s, l } = hexToHsl(color);
    const fill = hsl(h, s, clamp(l + 12, 10, 92)); // pulpa ACLARADA +12% luminosidad
    const fillIn = hsl(h, clamp(s * 0.85, 0, 100), clamp(l + 26, 20, 96)); // borde interior
    const n = randInt(8, 14);
    for (let i = 0; i < n; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_PULP;
      p.layer = LAYER_BACK;
      p.x = x; p.y = y;
      const a = rand(0, TAU);
      const sp = rand(90, 300) * (0.7 + radius / 300);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 80;
      p.g = 1450;
      p.drag = 1;
      p.t = 0;
      p.life = rand(500, 850);
      p.rot = rand(0, TAU);
      p.vr = rand(-7, 7);
      p.nv = randInt(3, 5);
      const base = clamp(radius * rand(0.1, 0.22), 3, 16);
      for (let v = 0; v < 5; v++) {
        p.va[v] = rand(0, TAU);
        p.vrad[v] = v < p.nv ? base * rand(0.55, 1.3) : 0;
      }
      p.size = base; p.size1 = base;
      p.stretch = 0;
      p.a0 = rand(0.85, 1);
      p.fill = fill;
      p.rgb = fillIn; // reutilizado: color del borde interior más claro
    }
  }

  // ----- emisión: destellos de 4 puntas (capa frontal) -----
  sparkles(x, y, color, count = 10) {
    const { h, s, l } = hexToHsl(color);
    // Sin grises: dorado si el origen es muy claro; si no, color vivo
    const starColor = l > 85
      ? '#ffe9a3'
      : hsl(h, Math.max(s, 70), clamp(Math.max(l, 60), 0, 90));
    const n = Math.max(1, count | 0);
    for (let i = 0; i < n; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_SPARKLE;
      p.layer = LAYER_FRONT;
      p.x = x + rand(-24, 24);
      p.y = y + rand(-24, 24);
      const a = rand(0, TAU);
      const sp = rand(10, 70);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 30;
      p.g = 0;
      p.drag = 0.96;
      p.t = 0;
      p.life = rand(380, 700);
      p.rot = rand(0, TAU);
      p.vr = rand(-4, 4);
      p.size = rand(3.5, 9);
      p.size1 = p.size;
      p.seed = rand(0, TAU);       // fase de destello
      p.tw = rand(0.01, 0.02);     // velocidad de parpadeo (rad/ms)
      p.stretch = 0;
      p.a0 = rand(0.7, 1);
      p.fill = Math.random() < 0.6 ? starColor : '#fff4d6'; // 60% color / 40% blanco cálido
    }
  }

  // ----- emisión: onda expansiva (2 anillos concéntricos, ~450ms) -----
  ring(x, y, radius, color, maxRadius = Infinity) {
    const { h, s, l } = hexToHsl(color);
    const c = hexToRgb(color);
    // Tope opcional de radio (lo decide quien llama con el color correcto)
    const rMax = Number.isFinite(maxRadius) ? maxRadius : Infinity;
    // anillo fino a TODO color, grosor variable (nace 2px → pico 6px → 0)
    let p = this._spawn();
    if (p) {
      p.kind = K_RING;
      p.layer = LAYER_BACK;
      p.x = x; p.y = y;
      p.r0 = radius * 0.45;
      p.r1 = Math.min(radius * 1.9, rMax);
      p.w = 2; // anchura de nacimiento; la curva vive en el dibujo
      p.seed = 0; // modo fino
      p.t = 0; p.life = 450;
      p.fill = hsl(h, s, l); // color recibido, sin lavar
    }
    // halo interior difuso (gradiente radial hueco)
    p = this._spawn();
    if (p) {
      p.kind = K_RING;
      p.layer = LAYER_BACK;
      p.x = x; p.y = y;
      p.r0 = radius * 0.3;
      p.r1 = Math.min(radius * 1.45, rMax);
      p.w = 0;
      p.seed = 1; // modo difuso
      p.rgb = `${c.r},${c.g},${c.b}`;
      p.t = 0; p.life = 450;
    }
  }

  // ----- emisión: confeti de celebración (capa frontal) -----
  confettiBurst(x, y, colors = []) {
    const palette = colors.length ? colors : DEFAULT_CONFETTI;
    const n = randInt(60, 90);
    for (let i = 0; i < n; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_CONFETTI;
      p.layer = LAYER_FRONT;
      p.x = x + rand(-8, 8);
      p.y = y + rand(-8, 8);
      const a = -Math.PI / 2 + rand(-1.15, 1.15); // fuente ascendente
      const sp = rand(240, 640);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.g = 520;            // gravedad suave
      p.drag = 0.985;       // drag aéreo
      p.t = 0;
      p.life = rand(1600, 2400);
      p.rot = rand(0, TAU);
      p.vr = rand(-9, 9);
      p.fw = rand(6, 11);
      p.fh = rand(9, 16);
      p.flip = rand(0, TAU);
      p.flipV = rand(5, 13) * (Math.random() < 0.5 ? -1 : 1);
      p.stretch = 0;
      p.a0 = 1;
      p.fill = palette[(Math.random() * palette.length) | 0];
    }

    // 6-8 destellos estrella entremezclados con los rectángulos
    const m = randInt(6, 8);
    for (let i = 0; i < m; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_SPARKLE;
      p.layer = LAYER_FRONT;
      p.x = x + rand(-70, 70);
      p.y = y + rand(-100, 40);
      p.vx = rand(-60, 60);
      p.vy = rand(-120, -20);
      p.g = 160;
      p.drag = 0.97;
      p.t = 0;
      p.life = rand(600, 1000);
      p.rot = rand(0, TAU);
      p.vr = rand(-3, 3);
      p.size = rand(4, 9);
      p.size1 = p.size;
      p.seed = rand(0, TAU);
      p.tw = rand(0.008, 0.016);
      p.stretch = 0;
      p.a0 = 1;
      p.fill = Math.random() < 0.5 ? '#ffe9a3' : '#fff4d6';
    }
  }

  // ----- emisión: soplo de aterrizaje (sutil, efímero, horizontal) -----
  dust(x, y, radius) {
    const n = randInt(6, 10);
    for (let i = 0; i < n; i++) {
      const p = this._spawn();
      if (!p) break;
      p.kind = K_DUST;
      p.layer = LAYER_BACK;
      p.x = x + rand(-radius * 0.5, radius * 0.5);
      p.y = y + rand(-3, 3);
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.vx = dir * rand(50, 200);   // deriva horizontal pura
      p.vy = 0;                     // sin subir: nunca flota en el vacío
      p.g = 0;
      p.drag = 0.97;
      p.t = 0;
      p.life = rand(140, 250);      // 40% más corta: muere antes de flotar
      p.size = clamp(radius * rand(0.08, 0.14) * 0.7, 2, 8.5); // radios −30%
      p.size1 = p.size * rand(2.2, 3.4);
      p.stretch = 0;
      p.a0 = rand(0.10, 0.12);      // alpha máximo 0.10-0.12: nada de mugre
      p.fill = 'hsl(42, 20%, 88%)'; // gris-blanco translúcido
    }
  }

  // ----- integración -----
  update(dtMs) {
    const ds = dtMs / 1000;
    const live = this._live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dtMs;
      if (p.t >= p.life) { this._recycle(i); continue; }
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, ds * 60); // drag por frame normalizado
        p.vx *= d;
        p.vy *= d;
      }
      p.vy += p.g * ds;
      p.x += p.vx * ds;
      p.y += p.vy * ds;
      p.rot += p.vr * ds;
      if (p.kind === K_CONFETTI) p.flip += p.flipV * ds;
    }
  }

  // ----- render: zumo, pulpa, anillos y polvo (detrás del cristal) -----
  drawBack(ctx) {
    const live = this._live;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (p.layer !== LAYER_BACK) continue;
      const q = p.t / p.life;
      switch (p.kind) {
        case K_DROP:
        case K_TEARDROP: this._drawDrop(ctx, p, q); break;
        case K_BIT: this._drawBit(ctx, p, q); break;
        case K_PULP: this._drawPulp(ctx, p, q); break;
        case K_RING: this._drawRing(ctx, p, q); break;
        case K_DUST: this._drawDust(ctx, p, q); break;
        default: break;
      }
    }
    // pase de brillo del zumo: 'lighter' + shadowBlur SOLO aquí
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (p.layer !== LAYER_BACK) continue;
      if (p.kind !== K_DROP && p.kind !== K_TEARDROP) continue;
      const q = p.t / p.life;
      const s = p.size + (p.size1 - p.size) * q;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.a0 * (1 - q) * 0.35;
      ctx.shadowColor = p.fill;
      ctx.shadowBlur = 7; // glow suave 6-8
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ----- render: sparkles y confetis (sobre el cristal) -----
  drawFront(ctx) {
    const live = this._live;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (p.layer !== LAYER_FRONT) continue;
      const q = p.t / p.life;
      switch (p.kind) {
        case K_SPARKLE: this._drawSparkle(ctx, p, q); break;
        case K_CONFETTI: this._drawConfetti(ctx, p, q); break;
        default: break;
      }
    }
  }

  clear() {
    while (this._live.length) this._free.push(this._live.pop());
  }

  // ===== dibujo por tipo =====

  _drawDrop(ctx, p, q) {
    const alpha = p.a0 * (1 - q);
    const s = p.size + (p.size1 - p.size) * q;
    const sp = Math.hypot(p.vx, p.vy);
    const k = clamp(sp / 900, 0, 0.55) * p.stretch; // squash & stretch
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.scale(1 + k, 1 - k * 0.45);
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    if (p.kind === K_TEARDROP) {
      // cola suave apuntando contra la velocidad
      const tail = s * (1.2 + k * 2.2);
      ctx.beginPath();
      ctx.moveTo(-s * 0.1, -s * 0.7);
      ctx.quadraticCurveTo(-tail, 0, -s * 0.1, s * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    // núcleo blanco jugoso: radio 35% del núcleo, alpha 0.9
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-s * 0.15, -s * 0.18, s * 0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawBit(ctx, p, q) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p.a0 * (1 - q);
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = p.fill;
    ctx.fillRect(-p.size * 1.8, -p.size * 0.45, p.size * 3.6, p.size * 0.9);
    ctx.restore();
  }

  _drawPulp(ctx, p, q) {
    const alpha = p.a0 * (1 - q * q);
    const sc = 1 - q * 0.55; // encoge al morir
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    // cuerpo aclarado
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    this._pulpPath(ctx, p, sc);
    ctx.fill();
    // borde interior más claro (sensación de inset)
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = p.rgb;
    ctx.beginPath();
    this._pulpPath(ctx, p, sc * 0.55);
    ctx.fill();
    ctx.restore();
  }

  _pulpPath(ctx, p, sc) {
    for (let i = 0; i < p.nv; i++) {
      const r = p.vrad[i] * sc;
      const px = Math.cos(p.va[i]) * r;
      const py = Math.sin(p.va[i]) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  _drawSparkle(ctx, p, q) {
    // crece-encoge con curva de seno + destello con alpha senoidal
    const sc = 0.25 + Math.sin(Math.min(q, 1) * Math.PI);
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(p.seed + p.t * p.tw));
    const r = p.size * sc;
    const k = r * 0.22; // concavidad del diamante
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p.a0 * tw * (1 - q * 0.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(k, -k, r, 0);
    ctx.quadraticCurveTo(k, k, 0, r);
    ctx.quadraticCurveTo(-k, k, -r, 0);
    ctx.quadraticCurveTo(-k, -k, 0, -r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawRing(ctx, p, q) {
    const e = easeOutCubic(q);
    const r = p.r0 + (p.r1 - p.r0) * e;
    const fade = 1 - q;
    ctx.save();
    if (p.seed === 0) {
      // grosor variable: nace 2px, engorda hasta 6px al 30% de vida, se apaga
      let lw;
      if (q < 0.3) lw = 2 + 4 * (q / 0.3);
      else lw = 6 * (1 - (q - 0.3) / 0.7);
      ctx.globalAlpha = fade * fade;
      ctx.strokeStyle = p.fill;
      ctx.lineWidth = Math.max(0.4, lw);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    } else {
      // halo difuso hueco
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
      g.addColorStop(0, `rgba(${p.rgb},0)`);
      g.addColorStop(0.62, `rgba(${p.rgb},${(0.32 * fade).toFixed(3)})`);
      g.addColorStop(1, `rgba(${p.rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawConfetti(ctx, p, q) {
    const flipY = Math.sin(p.flip); // flip 3D falso
    let alpha = 0.3 + 0.7 * Math.abs(flipY);
    if (q > 0.75) alpha *= (1 - q) / 0.25;
    ctx.save();
    ctx.globalAlpha = p.a0 * alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, flipY);
    ctx.fillStyle = p.fill;
    ctx.fillRect(-p.fw / 2, -p.fh / 2, p.fw, p.fh);
    ctx.restore();
  }

  _drawDust(ctx, p, q) {
    const s = p.size + (p.size1 - p.size) * easeOutCubic(q);
    ctx.save();
    ctx.globalAlpha = p.a0 * (1 - q);
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
