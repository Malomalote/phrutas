// ============================================================
//  SANDÍA JELLY · Renderizador de escena
//  Capas: fondo → tarro trasero → frutas → tarro delantero →
//         línea de peligro → aura de amasado.
//  Todas las coordenadas son lógicas (720×1080); el DPR/escala
//  lo aplica main.js con su transform.
// ============================================================

import { jarGeometry, dangerY } from '../core/physics.js?v=15';
import { fruitTexture, drawFruitTexture, MARGEN } from './textures.js?v=15';
import { CONFIG } from '../config.js?v=15';

const TAU = Math.PI * 2;
const POP_MS = 260; // duración del pop-in de nacimiento

// ── RNG determinista para estrellas y burbujas ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// overshoot suave para el pop-in
function easeOutBack(u) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = u - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

// '#rrggbb' → 'rgba(r,g,b,a)'
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Elipse difusa (blur simulado con gradiente radial escalado)
function softEllipse(ctx, x, y, rx, ry, hex, a) {
  if (a <= 0 || rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(hex, a));
  g.addColorStop(0.6, rgba(hex, a * 0.5));
  g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Rectángulo con esquinas inferiores redondeadas (interior del tarro / cristal)
function addRoundedBottomBox(ctx, left, top, right, bottom, cr) {
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom - cr);
  ctx.quadraticCurveTo(right, bottom, right - cr, bottom);
  ctx.lineTo(left + cr, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - cr);
  ctx.closePath();
}

// Franja vertical curva de reflejo sobre el cristal
function glassStreak(ctx, x, w, a, top, bot, bow) {
  ctx.beginPath();
  ctx.moveTo(x, top + 12);
  ctx.quadraticCurveTo(x - bow, (top + bot) / 2, x, bot - 10);
  ctx.lineTo(x + w, bot - 10);
  ctx.quadraticCurveTo(x + w - bow, (top + bot) / 2, x + w, top + 12);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.25, `rgba(255,255,255,${a})`);
  g.addColorStop(0.75, `rgba(255,255,255,${a * 0.7})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
}

// Canto vertical de pared; ondula con sin(y*0.02 + t*0.008) mientras se amasa
function wavyWall(ctx, x, y0, y1, phase, amp, mirror) {
  const step = 22;
  const pts = [];
  for (let y = y0; y <= y1; y += step) {
    const dx = Math.sin(y * 0.02 + phase) * amp * (mirror ? -1 : 1);
    pts.push({ x: x + dx, y });
  }
  pts.push({ x, y: y1 });
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this._stars = null;
    this._bubbles = null;
    this._jarFrontCache = null;
    this.softenWobble = 0; // ondulación del cristal durante el amasado (0..1)
  }

  // game avisa del amasado restante: el cristal ondula con la gelatina
  setSoftenWobble(v) {
    this.softenWobble = clamp01(v || 0);
  }

  // ── Fondo nocturno violeta en todo el lienzo lógico ──
  drawBackground(ctx, t) {
    const W = CONFIG.world.width;
    const H = CONFIG.world.height;

    // gradiente radial profundo
    let g = ctx.createRadialGradient(W * 0.5, H * 0.42, W * 0.1, W * 0.5, H * 0.42, H * 0.78);
    g.addColorStop(0, '#241540');
    g.addColorStop(0.55, '#1c0f34');
    g.addColorStop(1, '#150c28');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // resplandor frambuesa que respira
    const a1 = 0.045 + 0.02 * Math.sin(t * 0.00021);
    g = ctx.createRadialGradient(W * 0.2, H * 0.24, 0, W * 0.2, H * 0.24, W * 0.55);
    g.addColorStop(0, `rgba(255,90,150,${a1})`);
    g.addColorStop(1, 'rgba(255,90,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // resplandor azul, desfasado
    const a2 = 0.05 + 0.015 * Math.sin(t * 0.00016 + 2.1);
    g = ctx.createRadialGradient(W * 0.82, H * 0.72, 0, W * 0.82, H * 0.72, W * 0.6);
    g.addColorStop(0, `rgba(80,120,255,${a2})`);
    g.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // polvo de estrellas: 60 motas fijas con parpadeo sinusoidal lento
    this._ensureStars();
    for (const s of this._stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const a = 0.04 + 0.12 * tw;
      ctx.fillStyle = s.warm ? `rgba(255,236,200,${a})` : `rgba(210,225,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  _ensureStars() {
    const dim = CONFIG.world.width + 'x' + CONFIG.world.height;
    if (this._stars && this._starDim === dim) return;
    this._starDim = dim; // el cielo crece con la pantalla
    const rnd = mulberry32(20260907);
    this._stars = [];
    for (let i = 0; i < 60; i++) {
      this._stars.push({
        x: rnd() * CONFIG.world.width,
        y: rnd() * CONFIG.world.height,
        r: 0.5 + rnd() * 1.2,
        ph: rnd() * TAU,
        sp: 0.0004 + rnd() * 0.0008,
        warm: rnd() < 0.3,
      });
    }
  }

  // ── Interior del tarro (detrás de las frutas) ──
  drawJarBack(ctx, t) {
    const g0 = jarGeometry();
    const { left, right, top, bottom, cx } = g0;
    const cr = CONFIG.jar.cornerRadius;
    const w = right - left;
    const h = bottom - top;

    // vidrio trasero: base redondeada + gradiente vertical translúcido
    ctx.beginPath();
    addRoundedBottomBox(ctx, left, top, right, bottom, cr);
    let g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.45, 'rgba(184,172,232,0.09)');
    g.addColorStop(1, 'rgba(30,20,60,0.35)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    addRoundedBottomBox(ctx, left, top, right, bottom, cr);
    ctx.clip();

    // luz cenital: cono suave desde arriba
    const topW = w * 0.14;
    const botW = w * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - topW, top);
    ctx.lineTo(cx + topW, top);
    ctx.lineTo(cx + botW, bottom);
    ctx.lineTo(cx - botW, bottom);
    ctx.closePath();
    g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, `rgba(255,250,235,${0.05 + 0.008 * Math.sin(t * 0.0009)})`);
    g.addColorStop(0.6, 'rgba(255,250,235,0.016)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.fill();

    // resplandor de fondo central: evita el efecto "túnel vacío"
    g = ctx.createRadialGradient(cx, top + h * 0.42, 0, cx, top + h * 0.42, w * 0.55);
    g.addColorStop(0, 'rgba(150,120,220,0.10)');
    g.addColorStop(1, 'rgba(150,120,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(left, top, w, h);

    // línea de brillo interior en las paredes laterales
    g = ctx.createLinearGradient(left, 0, left + w * 0.055, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(left, top, w * 0.055, h);
    g = ctx.createLinearGradient(right, 0, right - w * 0.045, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.11)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(right - w * 0.045, top, w * 0.045, h);

    // sombra de base: elipse oscura difusa en el suelo del tarro
    softEllipse(ctx, cx, bottom - h * 0.02, w * 0.44, h * 0.035, '#0a0518', 0.38);
    // piso visible: banda de luz violeta justo sobre el fondo
    softEllipse(ctx, cx, bottom - 4, w * 0.46, h * 0.018, '#b79aff', 0.16);

    ctx.restore();
  }

  // ── Frutas vivas: sombra, pop-in, squash/wobble y halo dorado ──
  drawFruits(ctx, fruits, t) {
    if (!fruits || !fruits.length) return;
    const g0 = jarGeometry();
    const floorY = g0.bottom;
    const span = Math.max(1, floorY - g0.top);

    // pintar de arriba hacia abajo: las bajas quedan delante
    const orden = [...fruits].sort((a, b) => (a.y || 0) - (b.y || 0));

    // sombras de contacto: ¿hay otra fruta viva justo debajo? (O(n²), barato)
    const vivas = orden.filter((f) => f && f.alive !== false);
    const conContacto = new Set();
    for (let i = 0; i < vivas.length; i++) {
      const a = vivas[i];
      for (let j = 0; j < vivas.length; j++) {
        if (i === j) continue;
        const b = vivas[j];
        const dy = (b.y || 0) - (a.y || 0);
        const dx = Math.abs((b.x || 0) - (a.x || 0));
        if (dy > 0 && dx < (a.radius || 0) + (b.radius || 0) * 0.8) {
          conContacto.add(a);
          break;
        }
      }
    }

    for (const fr of orden) {
      if (!fr || fr.alive === false) continue;
      const R = fr.radius || 20;
      const x = fr.x || 0;
      const y = fr.y || 0;

      // altura sobre el suelo (0 = en el suelo, 1 = arriba del todo)
      const h01 = clamp01((floorY - (y + R)) / span);

      // sombra proyectada en el suelo: más pequeña y nítida cerca del suelo
      const shR = R * (0.7 + 0.55 * h01);
      const shA = 0.28 * (1 - 0.55 * h01);
      softEllipse(ctx, x, floorY - 2, shR, Math.max(3, shR * 0.22), '#070312', shA);

      // media luna de oclusión donde otra fruta se apoya debajo
      if (conContacto.has(fr)) {
        softEllipse(ctx, x, y + R * 0.75, R * 0.85, R * 0.2, '#0a0519', 0.22);
      }

      // halo pulsante de las doradas
      if (fr.golden) {
        const a = 0.15 + 0.1 * Math.sin(t * 0.005);
        const hg = ctx.createRadialGradient(x, y, R * 0.5, x, y, R * 1.75);
        hg.addColorStop(0, `rgba(255,214,120,${a})`);
        hg.addColorStop(1, 'rgba(255,214,120,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.75, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // pop-in de nacimiento (easeOutBack)
      let pop = 1;
      if (fr.birth != null) {
        const age = t - fr.birth;
        if (age <= 0) continue; // aún no nace
        if (age < POP_MS) pop = Math.max(0.001, easeOutBack(age / POP_MS));
      }

      // sprite: el cuerpo horneado ocupa 1/MARGEN del lienzo → dibujar el
      // sprite a 2R×MARGEN para que la fruta visible SEA el círculo de física
      const tex = fruitTexture(fr.tier, !!fr.golden);
      const half = R * MARGEN;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(fr.wobbleAngle || 0);
      ctx.scale((fr.sx == null ? 1 : fr.sx) * pop, (fr.sy == null ? 1 : fr.sy) * pop);
      drawFruitTexture(ctx, tex, -half, -half, half * 2, half * 2);
      ctx.restore();
    }
  }

  // ── Fruta apuntando + guía de caída + marcador de aterrizaje ──
  drawAim(ctx, tier, x, aimY, dropY, blocked, t) {
    const i = Math.max(0, Math.min(tier, CONFIG.fruits.length - 1));
    const R = CONFIG.fruits[i].radius;
    const y = aimY + Math.sin((t * TAU) / 2200) * 4; // vaivén vertical ±4px, 2.2s
    const rot = Math.sin(t * 0.0011) * 0.05; // rotación mínima

    // guía de caída discontinua: llega EXACTAMENTE hasta el marcador
    const gy0 = y + R * 1.25;
    const gy1 = Math.max(gy0 + 4, dropY);
    const gg = ctx.createLinearGradient(0, gy0, 0, dropY);
    gg.addColorStop(0, 'rgba(255,255,255,0.18)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.strokeStyle = gg;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -((t * 0.02) % 16);
    ctx.beginPath();
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, gy1);
    ctx.stroke();
    ctx.setLineDash([]);

    // marcador de aterrizaje: siempre elíptico con anillo de 1.5px, nunca disco.
    // Alpha atenuado por la distancia recorrida: cerca del suelo ≈0.22, en altura ≈0.08.
    const gAim = jarGeometry();
    const aMark =
      0.22 * (1 - clamp01((dropY - aimY) / Math.max(1, gAim.bottom - aimY)) * 0.65);
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.004);
    const aFill = blocked ? Math.min(0.35, aMark + 0.08) : aMark;
    const mr = R * (0.82 + 0.04 * breathe);
    ctx.translate(x, dropY);
    ctx.scale(1, 0.32);
    ctx.beginPath();
    ctx.arc(0, 0, mr, 0, TAU);
    ctx.fillStyle = blocked
      ? `rgba(255,92,104,${aFill})`
      : `rgba(255,255,255,${aFill})`;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = blocked
      ? `rgba(255,130,140,${Math.min(0.55, aFill + 0.15)})`
      : `rgba(255,255,255,${Math.min(0.4, aFill + 0.06)})`;
    ctx.stroke();
    ctx.restore();

    // luz cálida muy sutil tras la fruta sostenida (gradiente difuso, sin borde duro)
    softEllipse(ctx, x, y, R * 1.35, R * 1.35, '#fff0dc', 0.06);

    // fruta flotante (mismo escalado que las frutas del tarro)
    const tex = fruitTexture(i, false);
    const half = R * MARGEN;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    drawFruitTexture(ctx, tex, -half, -half, half * 2, half * 2);
    ctx.restore();

    // aviso de bloqueo: aro fino rojo SOLO cuando blocked
    if (blocked) {
      ctx.strokeStyle = 'rgba(255,110,120,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R * 1.08, 0, TAU);
      ctx.stroke();
    }

    // tinte rojo sutil sobre la fruta si está bloqueado
    if (blocked) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.clip();
      const rg = ctx.createRadialGradient(x, y, R * 0.2, x, y, R);
      rg.addColorStop(0, 'rgba(255,70,80,0)');
      rg.addColorStop(1, 'rgba(255,70,80,0.16)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - R, y - R, R * 2, R * 2);
      ctx.restore();
    }
  }

  // ── Cristal delantero (encima de las frutas) ──
  // intensity (opcional, 0..1): ondula los cantos interiores durante el amasado
  drawJarFront(ctx, t, intensity = this.softenWobble || 0) {
    if (intensity > 0) {
      this._drawJarFront(ctx, t, intensity);
      return;
    }
    const g = jarGeometry();
    const width = this.canvas.width;
    const height = this.canvas.height;
    const worldWidth = CONFIG.world.width;
    const gt = CONFIG.jar.glassThickness;
    const cr = CONFIG.jar.cornerRadius;
    let cache = this._jarFrontCache;
    if (!cache || cache.width !== width || cache.height !== height ||
        cache.worldWidth !== worldWidth || cache.left !== g.left ||
        cache.right !== g.right || cache.top !== g.top || cache.bottom !== g.bottom ||
        cache.gt !== gt || cache.cr !== cr) {
      const layer = cache ? cache.layer : document.createElement('canvas');
      layer.width = width;
      layer.height = height;
      const scale = width / worldWidth;
      const layerCtx = layer.getContext('2d');
      layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
      this._drawJarFront(layerCtx, 0, 0);
      cache = { layer, width, height, worldWidth, ...g, gt, cr };
      this._jarFrontCache = cache;
    }
    const scale = width / worldWidth;
    ctx.drawImage(cache.layer, 0, 0, width / scale, height / scale);
  }

  _drawJarFront(ctx, t, intensity) {
    const g0 = jarGeometry();
    const gt = CONFIG.jar.glassThickness;
    const cr = CONFIG.jar.cornerRadius;
    const { left, right, top, bottom, cx } = g0;
    const L = left - gt;
    const Rr = right + gt;
    const T = top - gt;
    const B = bottom + gt;
    const w = right - left;

    // halo exterior: sombra profunda detrás del tarro
    ctx.save();
    ctx.shadowColor = 'rgba(5,2,14,0.55)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 18;
    ctx.beginPath();
    addRoundedBottomBox(ctx, L, T, Rr, B, cr + 4);
    ctx.fillStyle = 'rgba(8,4,20,0.18)';
    ctx.fill();
    ctx.restore();

    // anillo de cristal (paredes + suelo + labio) con evenodd
    ctx.beginPath();
    addRoundedBottomBox(ctx, L, T, Rr, B, cr + 4);
    addRoundedBottomBox(ctx, left, top, right, bottom, cr);
    ctx.fillStyle = 'rgba(206,192,255,0.13)';
    ctx.fill('evenodd');

    // doble pared: dos strokes separados 8px (cuerpo, no contorno)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    addRoundedBottomBox(ctx, L, T, Rr, B, cr + 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    addRoundedBottomBox(ctx, L + 8, T + 8, Rr - 8, B - 8, Math.max(6, cr - 2));
    ctx.stroke();

    // especulares verticales en ambas aristas (gradiente 0.12→0, ~10px)
    let g = ctx.createLinearGradient(L + 1, 0, L + 11, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(L + 1, T + 12, 10, B - T - 24);
    g = ctx.createLinearGradient(Rr - 1, 0, Rr - 11, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Rr - 11, T + 12, 10, B - T - 24);

    // labio superior: arco de brillo + línea fina
    g = ctx.createLinearGradient(L, 0, Rr, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(L + 6, T + 3);
    ctx.quadraticCurveTo(cx, T - 4, Rr - 6, T + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(L + 8, T + 8);
    ctx.lineTo(Rr - 8, T + 8);
    ctx.stroke();

    // labio: brillo elíptico suave a lo ancho (0.12)
    const wLip = (Rr - L) / 2 - 14;
    ctx.save();
    ctx.translate(cx, T + 3);
    ctx.scale(1, 4 / wLip);
    ctx.beginPath();
    ctx.arc(0, 0, wLip, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.restore();

    // pinceladas de esquina: doble brillo corto (~20px) en cada radio inferior
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 3;
    for (const [ex, dir] of [
      [L, 1],
      [Rr, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(ex + dir * 5, B - 20);
      ctx.lineTo(ex + dir * 19, B - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + dir * 13, B - 27);
      ctx.lineTo(ex + dir * 26, B - 14);
      ctx.stroke();
    }

    // banda base gruesa (~14px) sobre el suelo interior + refracción:
    // el cristal desplaza/brilla el interior cerca del suelo
    ctx.save();
    ctx.beginPath();
    addRoundedBottomBox(ctx, left, top, right, bottom, cr);
    ctx.clip();
    g = ctx.createLinearGradient(0, bottom - 22, 0, bottom - 4);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.07)');
    ctx.fillStyle = g;
    ctx.fillRect(left, bottom - 22, w, 22);
    // overlay horizontal claro (refracción) en los 18px sobre el suelo
    g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.005)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.005)');
    g.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(left, bottom - 18, w, 18);
    // línea de contacto del cristal con el suelo
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left + cr * 0.6, bottom - 3);
    ctx.lineTo(right - cr * 0.6, bottom - 3);
    ctx.stroke();
    ctx.restore();

    // cantos interiores: ondulan con el amasado (intensity)
    const wob = clamp01(intensity) * 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    wavyWall(ctx, left + 1, top + 2, bottom - cr - 2, t * 0.008, wob, false);
    wavyWall(ctx, right - 1, top + 2, bottom - cr - 2, t * 0.008, wob, true);

    // reflejos: dos franjas verticales curvas que recorren el cristal
    glassStreak(ctx, left + w * 0.06, gt * 0.95, 0.08, T, B, 7);
    glassStreak(ctx, right - w * 0.15, gt * 0.55, 0.045, T, B, 7);

    // rim light inferior violeta claro
    ctx.save();
    ctx.shadowColor = 'rgba(190,150,255,0.65)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(198,162,255,0.40)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(L + 3, B - cr - 2);
    ctx.quadraticCurveTo(L + 3, B - 2, L + cr + 2, B - 2);
    ctx.lineTo(Rr - cr - 2, B - 2);
    ctx.quadraticCurveTo(Rr - 3, B - 2, Rr - 3, B - cr - 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Clipea al interior redondeado del tarro ──
  // Lo usa game.js para las partículas de zumo: ninguna debe atravesar el cristal.
  clipJarInterior(ctx) {
    const g0 = jarGeometry();
    ctx.beginPath();
    addRoundedBottomBox(
      ctx,
      g0.left,
      g0.top,
      g0.right,
      g0.bottom,
      CONFIG.jar.cornerRadius
    );
    ctx.clip();
  }

  // ── Línea de peligro: SIEMPRE roja; el pulso intensifica, nunca la apaga ──
  drawDangerLine(ctx, pulse01, t) {
    const g0 = jarGeometry();
    const y = dangerY();
    const x0 = g0.left + 8;
    const x1 = g0.right - 8;
    const p = clamp01(pulse01);

    ctx.save();
    ctx.lineCap = 'round';

    // base roja continua permanente con glow suave
    ctx.shadowColor = 'rgba(255,60,80,0.7)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(255,90,110,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    // guiones rojos encima: el pulso sube el glow y la intensidad
    ctx.setLineDash([16, 12]);
    ctx.lineDashOffset = -((t * 0.012) % 28);
    ctx.shadowBlur = 8 + 16 * p;
    ctx.strokeStyle = `rgba(255,90,110,${0.65 + 0.35 * p})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // escuadras rojas en los extremos
    const s = 9;
    ctx.strokeStyle = `rgba(255,90,110,${0.5 + 0.45 * p})`;
    ctx.lineWidth = 3;
    for (const [ex, dir] of [
      [x0, 1],
      [x1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(ex + dir * s, y);
      ctx.lineTo(ex, y);
      ctx.lineTo(ex, y - s);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Aura de "amasar": velo menta + burbujas de gelatina ──
  drawSoftenAura(ctx, intensity01, t) {
    if (!intensity01 || intensity01 <= 0) return;
    const g0 = jarGeometry();
    const { left, right, top, bottom } = g0;
    const cr = CONFIG.jar.cornerRadius;

    ctx.save();
    ctx.beginPath();
    addRoundedBottomBox(ctx, left, top, right, bottom, cr);
    ctx.clip();

    // gradiente verde-menta translúcido (más presencia: 0.16 en la cima)
    let g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, `rgba(150,255,212,${0.16 * intensity01})`);
    g.addColorStop(1, `rgba(120,240,196,${0.06 * intensity01})`);
    ctx.fillStyle = g;
    ctx.fillRect(left, top, right - left, bottom - top);

    // sheen diagonal que barre el interior (banda a 15°, 1.6 s por barrido)
    const cw = right - left;
    const ch = bottom - top;
    const span = (Math.max(cw, ch) / 2) * 1.5;
    const pSweep = ((t * 0.625) % 1600) / 1600;
    const bw = cw * 0.22;
    const bxS = (pSweep - 0.5) * span * 2.6;
    ctx.save();
    ctx.translate(left + cw / 2, top + ch / 2);
    ctx.rotate(-Math.PI / 12);
    const sg = ctx.createLinearGradient(bxS - bw, 0, bxS + bw, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, `rgba(255,255,255,${0.04 * intensity01})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(bxS - bw, -span, bw * 2, span * 2);
    ctx.restore();

    // burbujas de gelatina subiendo con vaivén sinusoidal
    this._ensureBubbles();
    const hgt = bottom - top;
    for (const b of this._bubbles) {
      const p = ((t * b.sp + b.ph) % 1 + 1) % 1; // 0..1 por ciclo
      const by = bottom - p * hgt + b.r;
      const bx =
        left + b.u * (right - left) + Math.sin(t * 0.0016 * b.sw + b.ph * TAU) * 16;
      const a = Math.max(0, 0.06 * intensity01 * Math.sin(Math.PI * clamp01(p)));
      if (a > 0.001) {
        softEllipse(
          ctx,
          bx,
          by,
          b.r,
          b.r * (0.82 + 0.18 * Math.sin(t * 0.003 + b.ph * 9)),
          '#eafff8',
          a
        );
      }
    }
    ctx.restore();
  }

  _ensureBubbles() {
    if (this._bubbles) return;
    const rnd = mulberry32(777001);
    this._bubbles = [];
    for (let i = 0; i < 9; i++) {
      this._bubbles.push({
        u: rnd(),
        ph: rnd(),
        sp: 1 / (5200 + rnd() * 4200), // subida de ~5-9 s
        r: 7 + rnd() * 15,
        sw: 0.9 + rnd() * 1.4,
      });
    }
  }
}
