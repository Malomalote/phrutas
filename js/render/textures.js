// ============================================================
//  SANDÍA JELLY · Texturas procedurales de frutas
//  Cada fruta se pre-renderiza a un canvas offscreen (2× de
//  supersampling) con: silueta orgánica, volumen, subsurface,
//  oclusión ambiental, doble especular, grano y decorado propio.
// ============================================================

import { CONFIG } from '../config.js?v=14';

const TAU = Math.PI * 2;
// lado del sprite = diámetro × 2.36 (~18% de aire por lado). Exportado: quien
// dibuja el sprite debe escalarlo por este factor para que la fruta horneada
// coincida exactamente con su círculo de física.
export const MARGEN = 2.36;

// ── RNG determinista (mulberry32): texturas idempotentes ──
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

// '#rrggbb' → 'rgba(r,g,b,a)'
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// ── Elipse difusa: "blur" barato con gradiente radial escalado ──
function softEllipse(ctx, x, y, rx, ry, hex, a) {
  if (a <= 0 || rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(hex, a));
  g.addColorStop(0.65, rgba(hex, a * 0.45));
  g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ── Silueta orgánica: radios con ruido suave (+ opcionales pezón/hendidura) ──
function organicPoints(cx, cy, r, rnd, opts = {}) {
  const n = Math.max(8, opts.points || 10);
  const bump = opts.bump != null ? opts.bump : 0.015;
  const base = [];
  for (let i = 0; i < n; i++) base.push(1 + (rnd() * 2 - 1) * bump);
  // suavizado circular 1-2-1 para curvas sin estridencias
  const rad = base.map((v, i) => {
    const p = base[(i - 1 + n) % n];
    const nx = base[(i + 1) % n];
    return (p + 2 * v + nx) / 4;
  });
  const pts = [];
  const nW = opts.nippleW || 0.34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2; // el punto 0 cae en el polo superior
    let rr = r * rad[i];
    if (opts.nipple) {
      const dT = angDiff(a, -Math.PI / 2);
      const dB = angDiff(a, Math.PI / 2);
      rr *=
        1 +
        opts.nipple *
          (Math.exp(-(dT * dT) / (2 * nW * nW)) + Math.exp(-(dB * dB) / (2 * nW * nW)));
    }
    if (opts.dipTop) {
      const d = angDiff(a, -Math.PI / 2);
      rr *= 1 - opts.dipTop * Math.exp(-(d * d) / (2 * 0.38 * 0.38));
    }
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

// Traza curva cerrada suave (técnica de puntos medios)
function traceClosed(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const p0 = pts[0];
  const p1 = pts[1 % n];
  ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  for (let i = 1; i <= n; i++) {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  ctx.closePath();
}

// ── Grano: patrón de ruido generado UNA vez y reutilizado con offsets ──
let grainCv = null;
function getGrainCanvas() {
  if (grainCv) return grainCv;
  const s = 128;
  grainCv = document.createElement('canvas');
  grainCv.width = s;
  grainCv.height = s;
  const g = grainCv.getContext('2d');
  const img = g.createImageData(s, s);
  const rnd = mulberry32(424242);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 88 + rnd() * 80; // grises en torno a 128 (neutro en 'overlay')
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainCv;
}

function applyGrain(ctx, path, alpha, ox, oy, direccional = false) {
  ctx.save();
  path(ctx);
  ctx.clip();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(ox), Math.round(oy));
  const pat = ctx.createPattern(getGrainCanvas(), 'repeat');
  if (direccional && pat.setTransform) {
    try {
      // estira el ruido en diagonal → piel aterciopelada
      pat.setTransform(new DOMMatrix([0.94, 0.34, -0.34, 0.94, 0, 0]).scale(2.4, 0.55));
    } catch (e) {
      /* sin DOMMatrix: grano neutro */
    }
  }
  ctx.fillStyle = pat;
  ctx.fillRect(-1024, -1024, 2048, 2048);
  ctx.restore();
}

// ── Hoja reutilizable: forma, degradado, nervadura, venas y brillo ──
function leaf(ctx, x, y, len, angle, cLight, cDark, rnd, wrinkled = false) {
  const w = len * 0.42;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(0, -w, 0, w);
  g.addColorStop(0, cLight);
  g.addColorStop(1, cDark);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -w * 1.15, len, -w * 0.1);
  ctx.quadraticCurveTo(len * 0.52, w * 0.92, 0, 0);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  // nervadura central
  ctx.strokeStyle = 'rgba(22,52,14,0.55)';
  ctx.lineWidth = Math.max(0.8, len * 0.045);
  ctx.beginPath();
  ctx.moveTo(len * 0.05, 0);
  ctx.quadraticCurveTo(len * 0.5, -w * 0.05, len * 0.95, -w * 0.08);
  ctx.stroke();
  // venas laterales
  ctx.lineWidth = Math.max(0.6, len * 0.028);
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const bx = len * (0.12 + t * 0.7);
    const by = -w * 0.05 * t;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + len * 0.06, by - w * 0.35, bx + len * 0.12, by - w * 0.6);
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + len * 0.06, by + w * 0.3, bx + len * 0.1, by + w * 0.5);
    ctx.stroke();
  }
  // brillo de cutícula
  ctx.strokeStyle = 'rgba(238,255,214,0.45)';
  ctx.lineWidth = Math.max(0.8, len * 0.06);
  ctx.beginPath();
  ctx.moveTo(len * 0.16, -w * 0.38);
  ctx.quadraticCurveTo(len * 0.48, -w * 0.9, len * 0.8, -w * 0.3);
  ctx.stroke();
  if (wrinkled) {
    // arrugas (hoja del melocotón)
    ctx.strokeStyle = 'rgba(30,60,20,0.30)';
    ctx.lineWidth = Math.max(0.6, len * 0.03);
    for (let i = 0; i < 4; i++) {
      const bx = len * (0.2 + rnd() * 0.55);
      ctx.beginPath();
      ctx.moveTo(bx, -w * 0.5 + rnd() * w * 0.2);
      ctx.lineTo(bx + len * 0.06, w * (rnd() - 0.2) * 0.6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Destello de 4 puntas horneado (variante dorada)
function sparkle(ctx, x, y, s, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = `rgba(255,252,240,${a})`;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.14, -s * 0.14, s, 0);
  ctx.quadraticCurveTo(s * 0.14, s * 0.14, 0, s);
  ctx.quadraticCurveTo(-s * 0.14, s * 0.14, -s, 0);
  ctx.quadraticCurveTo(-s * 0.14, -s * 0.14, 0, -s);
  ctx.fill();
  ctx.restore();
}

// Línea ondulada suave a partir de puntos
function wavyStroke(ctx, pts) {
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

// ============================================================
//  CAPAS COMUNES (técnicas 1-5 del pipeline)
// ============================================================
function paintBody(ctx, c, R, f, path) {
  // AO de contacto bajo la fruta, dentro del propio sprite (muy sutil)
  softEllipse(ctx, c, c + R * 1.04, R * 0.86, R * 0.15, '#0c0618', 0.18);

  // relleno base oscuro: define el borde antes del volumen
  path(ctx);
  ctx.fillStyle = f.dark;
  ctx.fill();

  ctx.save();
  path(ctx);
  ctx.clip();

  // volumen: gradiente radial desplazado arriba-izquierda
  const gx = c - R * 0.38;
  const gy = c - R * 0.42;
  let g = ctx.createRadialGradient(gx, gy, R * 0.06, gx, gy, R * 1.5);
  g.addColorStop(0, f.light);
  g.addColorStop(0.34, f.base);
  g.addColorStop(0.76, f.base);
  g.addColorStop(1, f.dark);
  ctx.fillStyle = g;
  ctx.fillRect(c - R * 1.4, c - R * 1.4, R * 2.8, R * 2.8);

  // subsurface scattering: franja translúcida abajo-derecha (lado opuesto a la luz)
  softEllipse(ctx, c + R * 0.24, c + R * 0.72, R * 0.8, R * 0.48, f.light, 0.3);
  softEllipse(ctx, c - R * 0.45, c + R * 0.45, R * 0.42, R * 0.34, f.light, 0.14);

  // oclusión ambiental: sombra interna en el canto + refuerzo superior
  ctx.strokeStyle = rgba(f.dark, 0.14);
  ctx.lineWidth = R * 0.3;
  path(ctx);
  ctx.stroke();
  ctx.strokeStyle = rgba(f.dark, 0.1);
  ctx.lineWidth = R * 0.16;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.97, -Math.PI * 0.82, -Math.PI * 0.18);
  ctx.stroke();

  // doble capa especular en suma aditiva: luz real, no gris
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(c - R * 0.36, c - R * 0.44);
  ctx.rotate(-0.55);
  softEllipse(ctx, 0, 0, R * 0.52, R * 0.34, '#ffffff', 0.16); // hotspot amplio suave
  ctx.restore();
  softEllipse(ctx, c - R * 0.3, c - R * 0.47, R * 0.15, R * 0.115, '#ffffff', 0.62); // punto intenso
  softEllipse(ctx, c - R * 0.14, c - R * 0.6, R * 0.06, R * 0.05, '#ffffff', 0.45); // núcleo
  softEllipse(ctx, c + R * 0.34, c + R * 0.44, R * 0.2, R * 0.1, '#ffffff', 0.05); // mini reflejo secundario
  ctx.restore();

  ctx.restore();
}

// ============================================================
//  DECORADOS POR FRUTA
// ============================================================

// Arándano: película cerúlea plateada + corola estrellada
function decoBloom(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();
  // velo céreo que desatura el azul
  softEllipse(ctx, c, c - R * 0.08, R * 1.02, R * 1.02, '#b9c8e8', 0.13);
  // pruina real: halo blanco-azulado que culmina al 70% del radio (exagerada
  // para sobrevivir a tamaños de juego ~30px)
  const gp = ctx.createRadialGradient(c, c, R * 0.15, c, c, R * 1.04);
  gp.addColorStop(0, 'rgba(200,210,255,0)');
  gp.addColorStop(0.7, 'rgba(200,210,255,0.26)');
  gp.addColorStop(0.88, 'rgba(200,210,255,0.12)');
  gp.addColorStop(1, 'rgba(200,210,255,0)');
  ctx.fillStyle = gp;
  ctx.fillRect(c - R * 1.1, c - R * 1.1, R * 2.2, R * 2.2);
  // cruz de luz difusa
  softEllipse(ctx, c - R * 0.12, c - R * 0.18, R * 0.78, R * 0.26, '#dfe8ff', 0.17);
  softEllipse(ctx, c - R * 0.34, c + R * 0.05, R * 0.26, R * 0.6, '#dfe8ff', 0.12);
  // motas claras de cera
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.92;
    ctx.fillStyle = `rgba(235,242,255,${0.1 + rnd() * 0.12})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, Math.max(0.5, R * (0.015 + rnd() * 0.03)), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // corola estrellada en el polo superior: 5 puntitas oscuras + centro claro
  const bx = c;
  const by = c - R * 0.6;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2 + 0.3;
    ctx.save();
    ctx.translate(bx + Math.cos(a) * R * 0.055, by + Math.sin(a) * R * 0.055);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(20,20,60,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.055, R * 0.022, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  softEllipse(ctx, bx, by, R * 0.05, R * 0.05, '#c7d3f2', 0.45);
}

// Cereza: rabito grueso, terminator profundo y el especular más brillante del set
function decoStem(ctx, c, R, f, rnd, path) {
  // muesca superior (la fruta "se hunde" donde nace el rabito)
  ctx.save();
  path(ctx);
  ctx.clip();
  softEllipse(ctx, c, c - R * 0.86, R * 0.3, R * 0.15, f.dark, 0.5);
  softEllipse(ctx, c, c - R * 0.78, R * 0.2, R * 0.08, f.light, 0.18);
  // terminator: rojo profundo → casi negro hacia el borde inferior-derecho
  const gt = ctx.createLinearGradient(c - R * 0.3, c - R * 0.3, c + R * 0.85, c + R);
  gt.addColorStop(0, 'rgba(122,10,26,0)');
  gt.addColorStop(0.5, 'rgba(110,8,22,0.28)');
  gt.addColorStop(1, 'rgba(26,2,10,0.55)');
  ctx.fillStyle = gt;
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  ctx.restore();

  // rabito curvo: grueso y legible incluso en tamaño pequeño
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c + R * 0.02, c - R * 0.8);
  ctx.quadraticCurveTo(c + R * 0.16, c - R * 1.02, c + R * 0.4, c - R * 1.12);
  ctx.strokeStyle = '#7c4a22';
  ctx.lineWidth = R * 0.19;
  ctx.stroke();
  // brillo del rabito
  ctx.beginPath();
  ctx.moveTo(c + R * 0.05, c - R * 0.83);
  ctx.quadraticCurveTo(c + R * 0.17, c - R * 1.0, c + R * 0.36, c - R * 1.08);
  ctx.strokeStyle = 'rgba(226,180,126,0.8)';
  ctx.lineWidth = R * 0.06;
  ctx.stroke();

  // especular alargado vertical (elipse 1:3): la cereza es la fruta más brillante
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(c - R * 0.26, c - R * 0.2);
  ctx.rotate(0.12);
  softEllipse(ctx, 0, 0, R * 0.11, R * 0.33, '#ffffff', 0.85);
  softEllipse(ctx, 0, R * 0.06, R * 0.05, R * 0.15, '#ffffff', 0.55);
  ctx.restore();

  leaf(ctx, c - R * 0.04, c - R * 0.88, R * 0.42, -2.95, '#63b23e', '#356f1f', rnd);
}

// Uva: reflejo vertical pulido, ombligo y borde frío
function decoGrape(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // reflejo alargado vertical (uva pulida)
  let g = ctx.createLinearGradient(0, c - R * 0.85, 0, c + R * 0.5);
  g.addColorStop(0, 'rgba(255,252,255,0)');
  g.addColorStop(0.22, 'rgba(255,252,255,0.24)');
  g.addColorStop(0.62, 'rgba(255,252,255,0.07)');
  g.addColorStop(1, 'rgba(255,252,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c - R * 0.38, c - R * 0.85, R * 0.17, R * 1.35);
  // estriada secundaria
  g = ctx.createLinearGradient(0, c - R * 0.6, 0, c + R * 0.2);
  g.addColorStop(0, 'rgba(255,252,255,0.12)');
  g.addColorStop(1, 'rgba(255,252,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c - R * 0.12, c - R * 0.6, R * 0.07, R * 0.8);

  // especular alargado vertical en suma aditiva
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(c - R * 0.26, c - R * 0.02);
  softEllipse(ctx, 0, 0, R * 0.1, R * 0.3, '#ffffff', 0.38);
  ctx.restore();
  ctx.restore();

  // tono frío tenue en el canto + rim-light púrpura a contra-luz en el borde inferior
  ctx.strokeStyle = 'rgba(207,178,255,0.14)';
  ctx.lineWidth = R * 0.07;
  path(ctx);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,120,255,0.25)';
  ctx.lineWidth = R * 0.09;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.9, Math.PI * 0.18, Math.PI * 0.82);
  ctx.stroke();

  // ombligo hundido (óvalo 0.19r, bien oscuro: debe sobrevivir a 30px en juego)
  softEllipse(ctx, c + R * 0.12, c + R * 0.36, R * 0.19, R * 0.13, '#1c0530', 0.5);
  softEllipse(ctx, c + R * 0.12, c + R * 0.42, R * 0.06, R * 0.032, '#e2ccff', 0.32);
  ctx.restore();
}

// Limón: pezones en ambos polos + poros finísimos
function decoNipple(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // papilas-bombita en ambos polos (0.12r), sombreadas con el degradado del cuerpo
  for (const s of [-1, 1]) {
    const py = c + s * R * 1.06;
    softEllipse(ctx, c, py - s * R * 0.07, R * 0.17, R * 0.13, f.dark, 0.3);
    softEllipse(ctx, c, py - s * R * 0.02, R * 0.1, R * 0.075, f.light, 0.5);
    softEllipse(ctx, c - R * 0.025, py - s * R * 0.055, R * 0.04, R * 0.028, '#fffef0', 0.35);
  }

  // poros finísimos
  for (let i = 0; i < 130; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.95;
    ctx.fillStyle = `rgba(160,110,10,${0.03 + rnd() * 0.03})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, Math.max(0.6, R * 0.012), 0, TAU);
    ctx.fill();
  }

  // especular alargado siguiendo el eje mayor de la elipse
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  softEllipse(ctx, c - R * 0.3, c - R * 0.34, R * 0.4, R * 0.1, '#fffbe0', 0.16);
  softEllipse(ctx, c - R * 0.38, c - R * 0.38, R * 0.15, R * 0.045, '#ffffff', 0.3);
  ctx.restore();
  ctx.restore();
}

// Naranja: cientos de poros, hoja, pedúnculo y brillo ceroso
function decoPores(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // poros con radio y densidad naturales + microbrillo en algunos
  for (let i = 0; i < 240; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.97;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    const pr = Math.max(0.6, R * (0.012 + rnd() * 0.018));
    ctx.fillStyle = `rgba(150,70,10,${0.05 + rnd() * 0.06})`;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, TAU);
    ctx.fill();
    if (rnd() < 0.18) {
      ctx.fillStyle = 'rgba(255,230,200,0.10)';
      ctx.beginPath();
      ctx.arc(x - pr * 0.5, y - pr * 0.5, pr * 0.7, 0, TAU);
      ctx.fill();
    }
  }

  // poros VISIBLES: hoyuelos oscuros con media luna iluminada (la piel de naranja real)
  for (let i = 0; i < 34; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.9;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    const pr = Math.max(1.2, R * (0.024 + rnd() * 0.014));
    ctx.fillStyle = `rgba(120,55,8,${0.16 + rnd() * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,220,170,${0.16 + rnd() * 0.12})`;
    ctx.lineWidth = Math.max(0.8, pr * 0.5);
    ctx.beginPath();
    ctx.arc(x, y + pr * 0.15, pr * 1.05, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  // brillo ceroso en franja
  ctx.save();
  ctx.translate(c - R * 0.3, c - R * 0.1);
  ctx.rotate(-0.35);
  softEllipse(ctx, 0, 0, R * 0.16, R * 0.42, '#ffe9d0', 0.1);
  ctx.restore();
  ctx.restore();

  // pedúnculo y hoja pequeña
  ctx.fillStyle = '#77913a';
  ctx.beginPath();
  ctx.arc(c, c - R * 0.97, Math.max(1, R * 0.045), 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(235,255,190,0.5)';
  ctx.beginPath();
  ctx.arc(c - R * 0.012, c - R * 0.985, Math.max(0.6, R * 0.018), 0, TAU);
  ctx.fill();
  leaf(ctx, c + R * 0.06, c - R * 0.94, R * 0.4, -0.6, '#57a33a', '#2f7a24', rnd);
}

// Manzana verde: hendidura, rabito, hoja grande, mejillas y cera
function decoApple(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // sombreado de la hendidura del tallo
  softEllipse(ctx, c, c - R * 0.84, R * 0.3, R * 0.15, f.dark, 0.4);
  // mejillas rojizas sutiles
  softEllipse(ctx, c - R * 0.42, c + R * 0.18, R * 0.42, R * 0.34, '#e2543f', 0.12);
  softEllipse(ctx, c + R * 0.45, c + R * 0.1, R * 0.38, R * 0.3, '#e2543f', 0.12);
  // calidez amarillenta junto al tallo
  softEllipse(ctx, c, c - R * 0.5, R * 0.42, R * 0.3, '#f2e97e', 0.1);
  // brillo ceroso en franja
  ctx.save();
  ctx.translate(c - R * 0.3, c);
  const gg = ctx.createLinearGradient(0, -R * 0.8, 0, R * 0.5);
  gg.addColorStop(0, 'rgba(255,255,250,0)');
  gg.addColorStop(0.35, 'rgba(255,255,250,0.20)');
  gg.addColorStop(0.8, 'rgba(255,255,250,0.03)');
  gg.addColorStop(1, 'rgba(255,255,250,0)');
  ctx.fillStyle = gg;
  ctx.fillRect(-R * 0.12, -R * 0.85, R * 0.24, R * 1.4);
  ctx.restore();
  ctx.restore();

  // rabito corto en la hendidura
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c, c - R * 0.9);
  ctx.quadraticCurveTo(c + R * 0.06, c - R * 1.05, c + R * 0.14, c - R * 1.1);
  ctx.strokeStyle = '#6d4423';
  ctx.lineWidth = R * 0.075;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c + R * 0.01, c - R * 0.93);
  ctx.quadraticCurveTo(c + R * 0.06, c - R * 1.03, c + R * 0.12, c - R * 1.07);
  ctx.strokeStyle = 'rgba(198,150,100,0.7)';
  ctx.lineWidth = R * 0.026;
  ctx.stroke();

  // hoja grande
  leaf(ctx, c - R * 0.04, c - R * 0.92, R * 0.46, -2.85, '#8fd053', '#4a8a2c', rnd);
}

// Kiwi CORTADO: carne verde, corazón crema, anillo de semillas y corteza fina felpuda
function decoKiwi(ctx, c, R, f, rnd, path) {
  const skin = R * 0.09; // corteza: 8-10% del radio
  ctx.save();
  path(ctx);
  ctx.clip();

  // carne verde #8DB600 con gradiente (más luminosa junto al corazón)
  const gFlesh = ctx.createRadialGradient(c, c, R * 0.08, c, c, R - skin);
  gFlesh.addColorStop(0, '#c3da55');
  gFlesh.addColorStop(0.55, '#8db600');
  gFlesh.addColorStop(1, '#749900');
  ctx.fillStyle = gFlesh;
  ctx.beginPath();
  ctx.arc(c, c, R - skin, 0, TAU);
  ctx.fill();

  // fibras jugosas radiales de la carne
  for (let i = 0; i < 44; i++) {
    const a = rnd() * TAU;
    const r0 = R * (0.22 + rnd() * 0.06);
    const r1 = R * (0.55 + rnd() * 0.3);
    const claro = rnd() < 0.5;
    ctx.strokeStyle = claro
      ? `rgba(216,234,124,${0.08 + rnd() * 0.06})`
      : `rgba(104,140,0,${0.08 + rnd() * 0.06})`;
    ctx.lineWidth = Math.max(0.7, R * 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.quadraticCurveTo(
      c + Math.cos(a + 0.14) * ((r0 + r1) / 2),
      c + Math.sin(a + 0.14) * ((r0 + r1) / 2),
      c + Math.cos(a) * r1,
      c + Math.sin(a) * r1
    );
    ctx.stroke();
  }

  // corazón blanco crema
  softEllipse(ctx, c, c, R * 0.23, R * 0.2, '#efe7bd', 0.92);
  softEllipse(ctx, c, c, R * 0.15, R * 0.13, '#faf6dd', 0.92);

  // anillo de semillas negras: dos coronas de puntitas radiales
  const seed = (rr, a, s) => {
    ctx.save();
    ctx.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(35,28,12,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.022 * s, R * 0.009 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.2;
    seed(R * 0.33, a, 1);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + 0.45;
    seed(R * 0.44, a, 0.9);
  }
  ctx.restore();

  // textura felpuda de la corteza: puntitos cortos en el anillo marrón
  for (let i = 0; i < 60; i++) {
    const a = rnd() * TAU;
    const r0 = R - skin * (0.2 + rnd() * 0.8);
    const r1 = r0 + skin * 0.35;
    ctx.strokeStyle = i % 2 ? 'rgba(214,182,138,0.30)' : 'rgba(80,54,28,0.30)';
    ctx.lineWidth = Math.max(0.6, R * 0.01);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }

  // pelusa exterior: cerellitas radiales cortas alternando claro/oscuro
  const n = 190;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * (TAU / n) * 0.9;
    const r0 = R * 0.985;
    const r1 = R * (1.02 + rnd() * 0.042);
    ctx.strokeStyle =
      i % 2 === 0 ? 'rgba(214,182,138,0.5)' : 'rgba(96,66,34,0.5)';
    ctx.lineWidth = Math.max(0.7, R * 0.016);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }
}

// Melocotón: surco, rubor asimétrico, hoja arrugada y piel de terciopelo
function decoPeach(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // rubor rosado-rojizo asimétrico + calidez inferior
  softEllipse(ctx, c + R * 0.3, c - R * 0.25, R * 0.62, R * 0.52, '#f0567a', 0.3);
  softEllipse(ctx, c - R * 0.3, c + R * 0.3, R * 0.45, R * 0.4, '#ff8ba6', 0.16);
  softEllipse(ctx, c, c + R * 0.55, R * 0.5, R * 0.3, '#ffdf9e', 0.14);

  // surco vertical curvo: sombra + luz paralela (relieve)
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c - R * 0.05, c - R * 0.92);
  ctx.quadraticCurveTo(c + R * 0.16, c - R * 0.1, c - R * 0.02, c + R * 0.92);
  ctx.strokeStyle = 'rgba(160,60,40,0.20)';
  ctx.lineWidth = R * 0.06;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c + R * 0.06, c - R * 0.9);
  ctx.quadraticCurveTo(c + R * 0.27, c - R * 0.1, c + R * 0.09, c + R * 0.9);
  ctx.strokeStyle = 'rgba(255,235,215,0.22)';
  ctx.lineWidth = R * 0.045;
  ctx.stroke();

  // piel aterciopelada: trazos finos direccionales
  for (let i = 0; i < 150; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.96;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    const l = R * (0.02 + rnd() * 0.03);
    const an = -0.5 + (rnd() - 0.5) * 0.4;
    ctx.strokeStyle =
      rnd() < 0.5 ? 'rgba(255,230,205,0.05)' : 'rgba(180,90,60,0.05)';
    ctx.lineWidth = Math.max(0.7, R * 0.015);
    ctx.beginPath();
    ctx.moveTo(x - (Math.cos(an) * l) / 2, y - (Math.sin(an) * l) / 2);
    ctx.lineTo(x + (Math.cos(an) * l) / 2, y + (Math.sin(an) * l) / 2);
    ctx.stroke();
  }

  // ombligo inferior
  softEllipse(ctx, c, c + R * 0.9, R * 0.06, R * 0.04, f.dark, 0.35);
  ctx.restore();

  leaf(ctx, c, c - R * 0.9, R * 0.42, -2.95, '#8ab455', '#4c7a2b', rnd, true);
}

// Coco: fibra en meridianos convergentes al polo peludo + poros en triángulo asimétrico
function decoCoconut(ctx, c, R, f, rnd, path) {
  // polo de los poros, ligeramente descentrado: nada de "carita" centrada
  const pole = { x: c + R * 0.06, y: c - R * 0.64 };

  ctx.save();
  path(ctx);
  ctx.clip();

  // fibra: arcos verticales que convergen en ese polo y se abren al bajar
  const n = 11;
  const bottomY = c + R * 0.96;
  for (let k = 0; k < n; k++) {
    const lon0 = (k / (n - 1) - 0.5) * 1.6; // abanico de apertura
    const lado = lon0 === 0 ? 1 : Math.sign(lon0);
    const steps = 9;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const spread = u * u; // convergencia en el polo
      const bow = Math.sin(u * Math.PI) * R * 0.045 * lado; // curvatura orgánica
      const wig = Math.sin(u * 6 + k * 2.1) * R * 0.012;
      pts.push({
        x: pole.x + Math.sin(lon0) * spread * R * 0.92 + bow + wig,
        y: pole.y + u * (bottomY - pole.y),
      });
    }
    const oscuro = k % 2 === 0;
    ctx.strokeStyle = oscuro
      ? `rgba(90,60,40,${0.1 + rnd() * 0.04})`
      : `rgba(200,178,148,${0.08 + rnd() * 0.03})`;
    ctx.lineWidth = R * (0.014 + rnd() * 0.016);
    wavyStroke(ctx, pts);
  }
  ctx.restore();

  // penacho de fibras largas en el polo de los poros (abanico ±33°, no por el canto)
  const angPole = Math.atan2(pole.y - c, pole.x - c);
  const nf = 16;
  ctx.lineCap = 'round';
  for (let i = 0; i < nf; i++) {
    const a = angPole + (i / (nf - 1) - 0.5) * 1.15;
    const r0 = R * (0.97 + rnd() * 0.02);
    const r1 = r0 + R * (0.05 + rnd() * 0.11);
    const sway = (rnd() - 0.5) * 0.2;
    ctx.strokeStyle = i % 2 ? 'rgba(125,104,84,0.5)' : 'rgba(50,40,31,0.55)';
    ctx.lineWidth = Math.max(1, R * 0.016);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.quadraticCurveTo(
      c + Math.cos(a + sway) * ((r0 + r1) / 2),
      c + Math.sin(a + sway) * ((r0 + r1) / 2),
      c + Math.cos(a + sway * 1.6) * r1,
      c + Math.sin(a + sway * 1.6) * r1
    );
    ctx.stroke();
  }

  // tres poros en TRIÁNGULO ASIMÉTRICO pegados al polo (tamaños irregulares)
  const pores = [
    { ox: -0.15, oy: 0.03, s: 0.05, rot: 0.4 },
    { ox: 0.11, oy: 0.09, s: 0.062, rot: -0.2 },
    { ox: 0.03, oy: -0.115, s: 0.043, rot: 0.9 },
  ];
  for (const p of pores) {
    const ex = pole.x + p.ox * R;
    const ey = pole.y + p.oy * R;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(p.rot);
    ctx.fillStyle = 'rgba(38,21,11,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * p.s * 1.35, R * p.s, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,184,142,0.4)';
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.stroke();
    ctx.restore();
  }
}

// Melón: red de corteza orgánica + costillas sutiles
function decoNetting(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // sombras de corteza bajo la red (pocas, para no ensuciar el valor)
  for (let i = 0; i < 28; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.94;
    softEllipse(
      ctx,
      c + Math.cos(a) * rr,
      c + Math.sin(a) * rr,
      R * (0.03 + rnd() * 0.05),
      R * (0.02 + rnd() * 0.04),
      f.dark,
      0.07
    );
  }
  // costillas verticales sutiles
  softEllipse(ctx, c - R * 0.38, c, R * 0.1, R * 0.96, f.dark, 0.13);
  softEllipse(ctx, c + R * 0.42, c, R * 0.09, R * 0.96, f.dark, 0.11);
  softEllipse(ctx, c + R * 0.05, c, R * 0.08, R * 0.96, f.dark, 0.07);

  // malla: 88 segmentos curvos en dos familias diagonales entrecruzadas
  const segs = [];
  for (let i = 0; i < 88; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * R * 0.95;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    const dir = (rnd() < 0.5 ? 0.7 : -0.7) + (rnd() - 0.5) * 0.7;
    const len = R * (0.1 + rnd() * 0.15);
    segs.push({
      x,
      y,
      mx: x + Math.cos(dir) * len * 0.5 + (rnd() - 0.5) * len * 0.5,
      my: y + Math.sin(dir) * len * 0.5 + (rnd() - 0.5) * len * 0.5,
      x2: x + Math.cos(dir) * len,
      y2: y + Math.sin(dir) * len,
      w: R * (0.016 + rnd() * 0.018),
    });
  }
  ctx.lineCap = 'round';
  const so = R * 0.014; // desnivel de la sombra bajo la costilla
  ctx.strokeStyle = rgba(f.dark, 0.24);
  for (const s of segs) {
    ctx.lineWidth = s.w * 1.3;
    ctx.beginPath();
    ctx.moveTo(s.x + so, s.y + so * 1.3);
    ctx.quadraticCurveTo(s.mx + so, s.my + so * 1.3, s.x2 + so, s.y2 + so * 1.3);
    ctx.stroke();
  }
  for (const s of segs) {
    // retícula clara bien marcada (0.35-0.5): el melón debe leerse crema, no gris
    ctx.strokeStyle = `rgba(240,235,210,${0.35 + rnd() * 0.15})`;
    ctx.lineWidth = s.w * 1.15;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.mx, s.my, s.x2, s.y2);
    ctx.stroke();
  }
  ctx.restore();
}

// Sandía: vetas meridianaas dentadas que se curvan en los polos + zarcillo
function decoStripes(ctx, c, R, f, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  const n = 7;
  const centros = []; // crestas de las rayas (para el shimmer de la dorada)
  for (let k = 0; k < n; k++) {
    const lon = ((k + 0.5) / n - 0.5) * Math.PI * 1.15;
    const w0 = R * (0.075 + rnd() * 0.05);
    const steps = 26;
    const left = [];
    const right = [];
    const center = [];
    for (let i = 0; i <= steps; i++) {
      const tt = i / steps;
      const el = -Math.PI / 2 + tt * Math.PI; // polo N → polo S
      const lonk = lon + Math.sin(tt * Math.PI * 2.3 + k) * 0.1; // ondulación
      const cEl = Math.cos(el);
      const x = c + Math.sin(lonk) * cEl * R;
      const y = c + Math.sin(el) * R;
      // ancho variable con bordes dentados
      const w =
        w0 *
        cEl *
        (0.7 + 0.55 * Math.abs(Math.sin(tt * 13 + k * 3))) *
        (0.85 + rnd() * 0.3);
      left.push({ x: x - w, y });
      right.push({ x: x + w, y });
      center.push({ x, y });
    }
    centros.push(center);
    // veta
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = rgba(f.dark, 0.88);
    ctx.fill();
    // vena central más oscura
    ctx.strokeStyle = rgba(f.dark, 0.55);
    ctx.lineWidth = Math.max(1, w0 * 0.2);
    ctx.beginPath();
    ctx.moveTo(center[0].x, center[0].y);
    for (let i = 1; i < center.length; i++) ctx.lineTo(center[i].x, center[i].y);
    ctx.stroke();
    // filo claro en el borde izquierdo (volumen de la veta)
    ctx.strokeStyle = rgba(f.light, 0.18);
    ctx.lineWidth = Math.max(1, w0 * 0.14);
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    ctx.stroke();
  }

  // sandía dorada: shimmer aditivo recorriendo las crestas de las rayas
  if (f.isGolden) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const gs = ctx.createLinearGradient(0, c - R, 0, c + R);
    gs.addColorStop(0, 'rgba(255,232,160,0)');
    gs.addColorStop(0.35, 'rgba(255,232,160,0.30)');
    gs.addColorStop(0.5, 'rgba(255,244,200,0.12)');
    gs.addColorStop(0.65, 'rgba(255,232,160,0.30)');
    gs.addColorStop(1, 'rgba(255,232,160,0)');
    ctx.strokeStyle = gs;
    ctx.lineWidth = Math.max(1, R * 0.022);
    for (const cen of centros) {
      ctx.beginPath();
      ctx.moveTo(cen[0].x, cen[0].y);
      for (let i = 1; i < cen.length; i++) ctx.lineTo(cen[i].x, cen[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // brillo ceroso alargado
  ctx.save();
  ctx.translate(c - R * 0.32, c + R * 0.05);
  softEllipse(ctx, 0, 0, R * 0.15, R * 0.5, '#eafff0', 0.1);
  ctx.restore();
  ctx.restore();

  // rabito corto + zarcillo espiral encima
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c, c - R * 0.97);
  ctx.quadraticCurveTo(c + R * 0.04, c - R * 1.08, c + R * 0.1, c - R * 1.11);
  ctx.strokeStyle = '#2f6b33';
  ctx.lineWidth = R * 0.045;
  ctx.stroke();

  const tx = c + R * 0.2;
  const ty = c - R * 0.98;
  const s = R * 0.18;
  ctx.strokeStyle = 'rgba(74,138,44,0.9)';
  ctx.lineWidth = Math.max(1, s * 0.14);
  ctx.beginPath();
  ctx.moveTo(tx, ty + s * 0.5);
  ctx.quadraticCurveTo(tx + s * 0.8, ty + s * 0.1, tx + s * 0.55, ty - s * 0.35);
  ctx.arc(tx + s * 0.32, ty - s * 0.5, s * 0.3, Math.PI * 0.25, Math.PI * 1.65);
  ctx.stroke();
}

const DECOS = {
  bloom: decoBloom,
  stem: decoStem,
  grape: decoGrape,
  nipple: decoNipple,
  pores: decoPores,
  apple: decoApple,
  kiwi: decoKiwi,
  peach: decoPeach,
  coconut: decoCoconut,
  netting: decoNetting,
  stripes: decoStripes,
};

// Personalidad de silueta por fruta
const SHAPES = {
  bloom: { points: 9, bump: 0.012 },
  stem: { points: 10, bump: 0.018 },
  grape: { points: 10, bump: 0.013 },
  nipple: { points: 28, bump: 0.012, nipple: 0.12, nippleW: 0.36 },
  pores: { points: 11, bump: 0.012 },
  apple: { points: 12, bump: 0.02, dipTop: 0.055 },
  kiwi: { points: 12, bump: 0.02 },
  peach: { points: 12, bump: 0.016 },
  coconut: { points: 12, bump: 0.02 },
  netting: { points: 11, bump: 0.012 },
  stripes: { points: 12, bump: 0.008 },
};

// Capas extra de la variante dorada (solo sandía)
function decoGolden(ctx, c, R, rnd, path) {
  ctx.save();
  path(ctx);
  ctx.clip();

  // banda de sheen metálico diagonal con borde definido
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-0.55);
  const g = ctx.createLinearGradient(-R * 0.8, 0, R * 0.8, 0);
  g.addColorStop(0, 'rgba(255,243,209,0)');
  g.addColorStop(0.34, 'rgba(255,243,209,0)');
  g.addColorStop(0.4, 'rgba(255,243,209,0.20)');
  g.addColorStop(0.5, 'rgba(255,243,209,0.10)');
  g.addColorStop(0.62, 'rgba(255,243,209,0.20)');
  g.addColorStop(0.68, 'rgba(255,243,209,0)');
  g.addColorStop(1, 'rgba(255,243,209,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3);
  ctx.restore();

  // destellos de 4 puntas horneados
  sparkle(ctx, c - R * 0.4, c - R * 0.45, R * 0.16, 0.4);
  sparkle(ctx, c + R * 0.35, c - R * 0.18, R * 0.11, 0.4);
  sparkle(ctx, c + R * 0.1, c + R * 0.42, R * 0.13, 0.38);
  sparkle(ctx, c - R * 0.18, c + R * 0.12, R * 0.08, 0.34);
  void rnd;
  ctx.restore();
}

// Paletas re-autorizadas: coco más oscuro y frío (marrón grisáceo, lejos del kiwi
// cálido); melón con saturación reforzada para no colapsar a gris sobre el fondo lila.
const PALETAS = {
  coconut: { base: '#6b5a4a', dark: '#483c31', light: '#8d7b66' },
  netting: { base: '#d3e58c', dark: '#96b25c', light: '#f6fbe6' },
};

// ── Render completo de una fruta a canvas offscreen ──
function renderFruit(i, golden) {
  const f0 = CONFIG.fruits[i];
  let f = PALETAS[f0.deco] ? { ...f0, ...PALETAS[f0.deco] } : f0;
  if (golden)
    f = {
      ...f,
      light: '#ffe9a8',
      base: '#e8b33a',
      dark: '#a5731c', // rayas en marrón dorado más claro
      isGolden: true,
    };
  const R = f0.radius;
  const S = Math.ceil(R * 2 * MARGEN * 2); // lado en px reales (supersampling 2×)
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  const L = S / 2;
  const c = L / 2;

  const rnd = mulberry32(101 + i * 977 + (golden ? 5551 : 0));

  ctx.save();
  // siluetas no circulares: kiwi ovalado en vertical; limón elipse 1.22:1 con
  // tilt fijo de instancia (−10°) y encogimiento uniforme para no rozar el margen
  if (f0.deco === 'kiwi') {
    ctx.translate(c, c);
    ctx.scale(1, 0.94);
    ctx.translate(-c, -c);
  } else if (f0.deco === 'nipple') {
    ctx.translate(c, c);
    ctx.rotate(-0.17);
    ctx.scale(1.17, 0.957);
    ctx.translate(-c, -c);
  }

  const pts = organicPoints(c, c, R, rnd, SHAPES[f0.deco] || {});
  const path = (g) => traceClosed(g, pts);

  // sandía dorada radiante: resplandor oro tras la fruta (dentro del sprite,
  // desvanecido a 0 justo en el borde para no cortar)
  if (golden) softEllipse(ctx, c, c, R * 1.18, R * 1.18, '#ffd25a', 0.25);
  paintBody(ctx, c, R, f, path);
  (DECOS[f0.deco] || decoBloom)(ctx, c, R, f, rnd, path);
  applyGrain(ctx, path, 0.05, rnd() * 128, rnd() * 128);
  if (f0.deco === 'peach') applyGrain(ctx, path, 0.04, rnd() * 128, rnd() * 128, true);
  if (golden) decoGolden(ctx, c, R, rnd, path);

  ctx.restore();

  // Directriz de arte ganadora en comparaciones ciegas A/B (2 de 2): viveza horneada
  const final = document.createElement('canvas');
  final.width = S;
  final.height = S;
  const fctx = final.getContext('2d');
  fctx.filter = 'saturate(1.44) contrast(1.12) brightness(1.04)';
  fctx.drawImage(cv, 0, 0);
  return final;
}

// ── Cache global de texturas ──
const cache = new Map();

// Pre-renderiza las 11 frutas + la variante dorada (idempotente)
export function buildTextures() {
  for (let i = 0; i < CONFIG.fruits.length; i++) fruitTexture(i, false);
  fruitTexture(CONFIG.fruits.length - 1, true); // sandía dorada (tier 10)
  fruitTexture(CONFIG.golden.tier, true); // cubre también el tier 11 del config
  return cache;
}

// Textura cuadrada de la fruta: lado = ceil(r*2*2.36*2), fruta centrada
export function fruitTexture(tier, golden = false) {
  const i = Math.max(0, Math.min(tier, CONFIG.fruits.length - 1));
  const key = i + ':' + (golden ? 'g' : 'n');
  let cv = cache.get(key);
  if (!cv) {
    cv = renderFruit(i, golden);
    cache.set(key, cv);
  }
  return cv;
}

// Icono reescalado con suavizado (HUD / barra de evolución)
export function fruitIcon(tier, size, golden = false) {
  const src = fruitTexture(tier, golden);
  const s = Math.max(1, Math.round(size));
  const cv = document.createElement('canvas');
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, s, s);
  return cv;
}
