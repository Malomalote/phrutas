// ============================================================
//  SANDÍA JELLY · Director de efectos
//  Shake por trauma, popups flotantes, banners de combo/golden
//  y flash a pantalla. Mundo lógico 720×1080.
// ============================================================

import { CONFIG, STR } from '../config.js?v=13';

const TAU = Math.PI * 2;
const FONT = '"Baloo 2","Nunito",system-ui,sans-serif';

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function easeOutCubic(p) { return 1 - (1 - p) ** 3; }
// Spring con overshoot regulable (c1=2.45 → pico ≈1.18)
function easeOutBack(p, c1 = 2.45) {
  const c3 = c1 + 1;
  return 1 + c3 * ((p - 1) ** 3) + c1 * ((p - 1) ** 2);
}
function easeOutElastic(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (TAU / 3)) + 1;
}

// Escalafón cromático del combo: amarillo→naranja→magenta→dorado
function comboColor(m) {
  if (m < 3) return '#ffd23f';
  if (m < 5) return '#ff8c2e';
  if (m < 7) return '#f050d8';
  return '#ffd700';
}

// Estrella de 4 puntas rellena (para los destellos del banner dorado)
function star4(ctx, x, y, r, rot) {
  const k = r * 0.22;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
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

// Píldora centrada (para el chip de combo), sin depender de roundRect
function pillPath(ctx, w, h) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
}

export class EffectsManager {
  constructor() {
    this.trauma = 0;      // 0..24
    this.time = 0;        // reloj interno (ms)
    this.popups = [];     // textos flotantes
    this.combo = null;    // { t, life, mult }
    this.golden = null;   // { t, life, text }
    this.flashFx = null;  // { t, life, color, strength }
    this._seed = Math.random() * 100; // desfase del ruido de shake
  }

  // ----- shake (acumula trauma; game.js pasa ≈ 3 + tier) -----
  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 24);
  }

  // Desplazamiento de cámara: seno con frecuencias irracionales × trauma
  get offsetX() {
    if (this.trauma < 0.2) return 0;
    const t = this.time * 0.001 + this._seed;
    const n = Math.sin(t * 39.7) * 0.55
            + Math.sin(t * 23.3 + 1.7) * 0.3
            + Math.sin(t * 57.1 + 4.2) * 0.15;
    return n * this.trauma * 0.5;
  }

  get offsetY() {
    if (this.trauma < 0.2) return 0;
    const t = this.time * 0.001 + this._seed;
    const n = Math.sin(t * 44.3 + 0.9) * 0.55
            + Math.sin(t * 19.7 + 3.1) * 0.3
            + Math.sin(t * 61.7 + 2.2) * 0.15;
    return n * this.trauma * 0.42;
  }

  // ms restantes del banner héroe dorado (0 si no está activo):
  // permite a quien llama (y al chip de combo) ceder el protagonismo
  get activeGoldenMsLeft() {
    return this.golden ? this.golden.life - this.golden.t : 0;
  }

  // ----- API de efectos -----

  popup(x, y, text, opts = {}) {
    this.popups.push({
      x, y, text,
      color: opts.color || '#ffffff',
      size: opts.size || 34,
      weight: opts.weight || 800,
      t: 0,
      life: opts.life || 900,
    });
  }

  comboBanner(mult) {
    this.combo = { t: 0, life: 1300, mult };
  }

  goldenBanner(text) {
    this.golden = { t: 0, life: 2000, text };
  }

  flash(color = '#ffffff', strength = 0.5) {
    this.flashFx = { t: 0, life: 300, color, strength };
  }

  // ----- integración -----
  update(dtMs) {
    this.time += dtMs;

    // decaimiento exponencial del trauma (~0.0025^dt en segundos)
    this.trauma *= Math.pow(0.0025, dtMs / 1000);
    if (this.trauma < 0.05) this.trauma = 0;

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dtMs;
      if (p.t >= p.life) this.popups.splice(i, 1);
    }
    if (this.combo) {
      this.combo.t += dtMs;
      if (this.combo.t >= this.combo.life) this.combo = null;
    }
    if (this.golden) {
      this.golden.t += dtMs;
      if (this.golden.t >= this.golden.life) this.golden = null;
    }
    if (this.flashFx) {
      this.flashFx.t += dtMs;
      if (this.flashFx.t >= this.flashFx.life) this.flashFx = null;
    }
  }

  // ----- render frontal: popups → banners → flash -----
  drawFront(ctx) {
    for (let i = 0; i < this.popups.length; i++) this._drawPopup(ctx, this.popups[i]);
    if (this.combo) this._drawCombo(ctx, this.combo);
    if (this.golden) this._drawGolden(ctx, this.golden);
    if (this.flashFx) this._drawFlash(ctx, this.flashFx);
  }

  // Reservado (las partículas traseras las pinta ParticleSystem)
  drawBack() {}

  clear() {
    this.trauma = 0;
    this.popups.length = 0;
    this.combo = null;
    this.golden = null;
    this.flashFx = null;
  }

  // ===== dibujo privado =====

  _drawPopup(ctx, p) {
    const q = p.t / p.life;
    // spring-in elástico: 0 → overshoot 1.18 → 1
    const scale = easeOutBack(Math.min(p.t / 320, 1));
    const rise = -64 * easeOutCubic(q); // sube con desaceleración
    const alpha = q > 0.7 ? (1 - q) / 0.3 : 1; // fade al final
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y + rise);
    ctx.scale(scale, scale);
    ctx.font = `${p.weight} ${p.size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, p.size * 0.14);
    ctx.strokeStyle = 'rgba(30,20,40,0.9)';
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }

  _drawCombo(ctx, c) {
    // El chip cede el plano si el héroe dorado está en su tramo final
    const gl = this.activeGoldenMsLeft;
    if (gl > 0 && gl < 1400) return;

    const t = c.t;
    const inP = Math.min(t / 500, 1);       // entrada elástica
    const scale = easeOutElastic(inP);
    let alpha = 1;
    let out = 0;
    if (t > 900) {                          // salida desde los 900ms
      out = (t - 900) / (c.life - 900);
      alpha = 1 - out;
    }
    const jit = t < 600 ? Math.sin(t * 0.09) * 1.5 * (1 - t / 600) : 0; // vibra
    const text = `${STR.combo}${c.mult}!`;
    const size = 30;   // tipografía compacta
    const H = 46;      // alto máximo del chip

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CONFIG.world.width / 2 + jit * 0.6, 310 + jit - out * 24);
    ctx.scale(scale, scale);
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // píldora de fondo con borde dorado suave
    const pw = Math.min(ctx.measureText(text).width + 34, 300);
    pillPath(ctx, pw, H);
    ctx.fillStyle = 'rgba(20,12,40,0.55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(232,199,106,0.75)';
    ctx.stroke();
    // texto con escalafón cromático
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(25,14,40,0.85)';
    ctx.strokeText(text, 0, 1);
    ctx.fillStyle = comboColor(c.mult);
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  _drawGolden(ctx, g) {
    const t = g.t;
    const inP = Math.min(t / 450, 1);
    // escala cinematográfica 0.6 → 1.08 → 1
    let scale;
    if (inP < 0.7) scale = 0.6 + 0.48 * easeOutCubic(inP / 0.7);
    else scale = 1.08 - 0.08 * easeOutCubic((inP - 0.7) / 0.3);
    // fade in corto y fade out elegante
    const alpha = clamp(t / 150, 0, 1) * (t > 1650 ? (g.life - t) / 350 : 1);
    const glow = 16 + 12 * Math.sin(t * 0.012); // glow dorado pulsante

    ctx.save();
    // Ajuste del glifo: se mide el texto y se escala para que quepa SIEMPRE
    // completo y centrado (objetivo ≤660px reales; tamaño resultante 44-52px)
    let size = 52;
    ctx.font = `900 ${size}px ${FONT}`;
    const tw = ctx.measureText(g.text).width;
    const maxW = 610; // 660px del lienzo menos margen para el overshoot 1.08
    if (tw > maxW) size = Math.max(44, Math.floor((size * maxW) / tw));
    ctx.globalAlpha = alpha;
    ctx.translate(CONFIG.world.width / 2, 390); // centro exacto, sin tapar la fruta
    ctx.scale(scale, scale);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // doble contorno
    ctx.lineWidth = 19;
    ctx.strokeStyle = 'rgba(55,28,0,0.95)';
    ctx.strokeText(g.text, 0, 0);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#8a5a00';
    ctx.strokeText(g.text, 0, 0);
    // relleno dorado con glow
    const grad = ctx.createLinearGradient(0, -54, 0, 54);
    grad.addColorStop(0, '#fff6c9');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#e09a00');
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = glow;
    ctx.fillStyle = grad;
    ctx.fillText(g.text, 0, 0);
    ctx.shadowBlur = 0;
    // destellos titilantes alrededor
    ctx.fillStyle = '#fffbe0';
    for (let i = 0; i < 6; i++) {
      const tw = Math.max(0, Math.sin(t * 0.004 * 3.1 + i * 1.7));
      if (tw < 0.55) continue;
      const a = (tw - 0.55) / 0.45;
      const ang = i * 2.399 + t * 0.001;
      ctx.globalAlpha = alpha * a;
      star4(ctx, Math.cos(ang) * 210, Math.sin(ang * 1.3) * 46, 5 + 5 * tw, ang);
    }
    ctx.restore();
  }

  _drawFlash(ctx, f) {
    const p = f.t / f.life;
    // sube rapidísimo y decae hasta 0 en 300ms (alpha máximo 0.35)
    const a = Math.min(0.35, f.strength * Math.min(f.t / 40, 1) * (1 - p));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = f.color;
    ctx.fillRect(0, 0, CONFIG.world.width, CONFIG.world.height);
    ctx.restore();
  }
}
