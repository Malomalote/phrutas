// ============================================================
//  Overlays · Pantallas de inicio, pausa y fin de partida
//  Construye el contenido de #overlay (el CSS hace el vidrio y el blur).
// ============================================================

import { CONFIG, STR, DIFICULTADES } from '../config.js?v=14';
import { fruitTexture, MARGEN } from '../render/textures.js?v=14';

const fmt = (n) => Math.round(n).toLocaleString('es-ES');
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// Rodea las teclas mencionadas en STR.controls con <kbd> estilizadas.
// Sin márgenes en kbd: los espacios del propio texto separan y la coma
// queda pegada al chip ("Clic, Espacio"), como debe ser.
const KEY_TOKENS = ['← →', 'Espacio', 'Clic', 'Ratón', 'Esc', '↓', 'P', 'A'];
const withKbd = (s) => {
  const t = s.replace(/^Tecla\s+/, ''); // "Tecla A para amasar" → "A para amasar"
  return KEY_TOKENS.reduce((acc, k) => acc.split(k).join(`<kbd>${k}</kbd>`), t);
};

// Iconos vectoriales inline, 14px, misma línea base (trazo redondeado)
const SVG_BOLT =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffb347" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
const SVG_WARN =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ff6b87" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3 22 20H2L12 3z"/><line x1="12" y1="10" x2="12" y2="14.5"/>' +
  '<line x1="12" y1="17.2" x2="12" y2="17.21"/></svg>';
// Cereza vectorial con rabito y hoja (nada de "punto rojo genérico")
const SVG_CHERRY =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path d="M7.5 14C8.5 9 10 5 12.5 3" fill="none" stroke="#63b23e" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M15.5 14.5C15 9.5 14 5.5 12.5 3" fill="none" stroke="#63b23e" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M12.5 3C14.5 1.2 17.5 1 19.5 2.5 18 4.8 15 5.2 12.8 3.8Z" fill="#63b23e"/>' +
  '<circle cx="7.5" cy="17.5" r="4" fill="#e63950"/>' +
  '<circle cx="15.5" cy="18" r="4.2" fill="#e63950"/>' +
  '<circle cx="9" cy="16.2" r="1.1" fill="#ff8fa0"/>' +
  '<circle cx="17" cy="16.8" r="1" fill="#ff8fa0"/></svg>';

export class Overlays {
  constructor() {
    this.overlay = document.getElementById('overlay');
    this._hideTimer = null;
    this._burstTimer = null;
    this._raf = null;
  }

  get visible() {
    return !this.overlay.hidden;
  }

  // ------------------------------------------------------------
  //  Utilidades de construcción
  // ------------------------------------------------------------
  _open(panel, extraClass, ariaLabel) {
    clearTimeout(this._hideTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.overlay.innerHTML = '';
    panel.classList.add('overlay-panel', extraClass);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', ariaLabel);
    this.overlay.append(panel);
    this.overlay.hidden = false;
    return panel;
  }

  _button(label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    return b;
  }

  _icon(tier, px) {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // zoom ×MARGEN: el cuerpo de la fruta llena el icono, no el aire del sprite
    const side = px * MARGEN * 0.94;
    ctx.drawImage(fruitTexture(tier), (px - side) / 2, (px - side) / 2, side, side);
    return c;
  }

  // Mini-canvas nítido (attr 2x, tamaño en pantalla px)
  _miniCanvas(tier, px, cls = 'howto-ico', golden = false) {
    const c = document.createElement('canvas');
    c.width = px * 2;
    c.height = px * 2;
    c.style.width = `${px}px`;
    c.style.height = `${px}px`;
    c.className = cls;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const side = c.width * MARGEN * 0.94;
    ctx.drawImage(fruitTexture(tier, golden), (c.width - side) / 2, (c.height - side) / 2, side, side);
    return c;
  }

  _svgIco(svg) {
    const s = this._el('span', 'howto-ico');
    s.innerHTML = svg;
    return s;
  }

  _el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // Confeti CSS: cuadraditos con posición/delay/rotación individuales
  _confetti(count = 14) {
    const colors = ['#ff5a7e', '#ffb347', '#8bc34a', '#7b4dff', '#4fc3f7', '#fff6ea'];
    const wrap = this._el('div', 'confetti-wrap');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--x', `${4 + Math.random() * 92}%`);
      p.style.setProperty('--d', `${(Math.random() * 2.2).toFixed(2)}s`);
      p.style.setProperty('--t', `${(2.4 + Math.random() * 2.4).toFixed(2)}s`);
      p.style.setProperty('--c', colors[i % colors.length]);
      p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.setProperty('--w', `${Math.round(5 + Math.random() * 5)}px`);
      wrap.append(p);
    }
    return wrap;
  }

  // Ráfaga dorada DETRÁS del panel: cae con gravedad, 2 s, y se desvanece
  _goldenBurst(count = 34) {
    const colors = ['#f5c04a', '#ffd98a', '#ffedb8', '#ff8c2e', '#ff5a7e', '#fff6ea'];
    const wrap = this._el('div', 'golden-burst');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--x', `${(5 + Math.random() * 90).toFixed(1)}%`);
      p.style.setProperty('--gx', `${Math.round(Math.random() * 120 - 60)}px`);
      p.style.setProperty('--d', `${(Math.random() * 0.5).toFixed(2)}s`);
      p.style.setProperty('--c', colors[i % colors.length]);
      p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.setProperty('--w', `${Math.round(5 + Math.random() * 5)}px`);
      wrap.append(p);
    }
    return wrap;
  }

  // ------------------------------------------------------------
  //  Pantalla de inicio
  // ------------------------------------------------------------
  showStart({ best, onPlay, records = {}, nivel = 'media', fusionDoradas = false }) {
    const p = this._el('div', 'screen-start');

    // Logo tipográfico en bloque: SANDÍA / JELLY apiladas, mismo
    // tratamiento crema→oro (el CSS cierra el interlineado)
    const [mainWord = STR.title, accentWord = ''] = STR.title.split(' ');
    p.append(this._el('div', 'logo',
      `<span class="logo-main">${mainWord}</span><span class="logo-accent">${accentWord}</span>`));

    // Fila de frutas con rebote escalonado infinito
    const row = this._el('div', 'fruit-row');
    for (let t = 0; t <= 4; t++) {
      const c = this._icon(t, 72);
      c.style.setProperty('--d', `${(t * 0.16).toFixed(2)}s`);
      row.append(c);
    }
    p.append(row);

    // Selector de nivel de dificultad (chips con su récord propio)
    p.append(this._el('p', 'dif-title', 'Dificultad'));
    const difRow = this._el('div', 'dif-row');
    let selNivel = nivel;
    const chips = [];
    for (const d of DIFICULTADES) {
      const chip = this._el('button', 'dif-chip');
      chip.type = 'button';
      chip.innerHTML = `<span class="dif-nombre">${d.nombre}</span>` +
        (records[d.id] > 0 ? `<span class="dif-record">★ ${fmt(records[d.id])}</span>` : '<span class="dif-record">—</span>');
      if (d.id === selNivel) chip.classList.add('sel');
      chip.addEventListener('click', () => {
        selNivel = d.id;
        try { localStorage.setItem(CONFIG.storage.nivelKey, selNivel); } catch { /* sin storage */ }
        for (const c of chips) c.classList.toggle('sel', c === chip);
      });
      chips.push(chip);
      difRow.append(chip);
    }
    p.append(difRow);

    // Opción: fusión de sandías doradas (desactivada por defecto)
    const opt = this._el('button', 'opt-toggle');
    opt.type = 'button';
    opt.setAttribute('role', 'switch');
    let fusionOn = !!fusionDoradas;
    const optState = this._el('span', 'opt-state');
    const pintar = () => {
      opt.classList.toggle('on', fusionOn);
      opt.setAttribute('aria-checked', String(fusionOn));
      optState.textContent = fusionOn ? STR.activada : STR.desactivada;
    };
    opt.append(
      this._el('span', 'opt-name', STR.fusionDoradas),
      this._el('span', 'opt-switch', '<span class="opt-knob"></span>'),
      optState
    );
    pintar();
    opt.addEventListener('click', () => { fusionOn = !fusionOn; pintar(); });
    p.append(opt);

    p.append(this._el('p', 'subtitle', STR.subtitle));
    p.append(this._el('p', 'tagline', STR.tagline));

    // Tarjeta "cómo se juega" + controles con teclas estilizadas
    const card = this._el('section', 'howto-card');
    card.append(this._el('h3', 'card-title', 'Cómo se juega'));
    const ul = this._el('ul', 'howto-list');
    STR.howto.forEach((line, i) => {
      const li = this._el('li');
      // Icono 1: cereza vectorial · Icono 2: rayo · Icono 3: advertencia
      // (los tres SVG inline a 14px sobre la misma línea base)
      const ico = i === 0 ? this._svgIco(SVG_CHERRY)
        : i === 1 ? this._svgIco(SVG_BOLT)
          : this._svgIco(SVG_WARN);
      li.append(ico, this._el('span', null, line));
      ul.append(li);
    });
    card.append(ul);
    card.append(this._el('h4', 'card-subtitle', 'Controles'));
    const ctrl = this._el('ul', 'controls-list');
    for (const line of Object.values(STR.controls)) {
      ctrl.append(this._el('li', null, withKbd(line)));
    }
    card.append(ctrl);
    p.append(card);

    const play = this._button(STR.play, 'btn primary big');
    play.addEventListener('click', () => onPlay(selNivel, fusionOn));
    p.append(play);

    this._open(p, 'start-panel', STR.title);
  }

  // ------------------------------------------------------------
  //  Pausa
  // ------------------------------------------------------------
  showPause({ onResume, onRestart }) {
    const p = this._el('div', 'screen-pause');
    p.append(this._el('h2', 'pause-title', STR.paused));

    const row = this._el('div', 'btn-row');
    const resume = this._button(STR.resume, 'btn primary');
    resume.addEventListener('click', () => onResume());
    const restart = this._button(STR.restart, 'btn ghost');
    restart.addEventListener('click', () => onRestart());
    row.append(resume, restart);
    p.append(row);

    this._open(p, 'pause-panel', STR.pause);
  }

  // ------------------------------------------------------------
  //  Fin de partida (count-up, confeti si hay récord, CTA Menú)
  // ------------------------------------------------------------
  showGameOver({ score, best, isRecord, goldenFound, onRestart, onMenu, maxCombo = 1, dificultad = 'Media' }) {
    const p = this._el('div', 'screen-over');
    let burst = null;
    p.append(this._el('h2', 'over-title', STR.gameOver));
    p.append(this._el('div', 'level-pill', `Nivel: ${dificultad}`));

    if (isRecord) {
      // Con badge de récord, la píldora de récord sería redundante
      p.append(this._confetti(14));
      p.append(this._el('div', 'record-badge', STR.newRecord));
    } else {
      p.append(this._el('div', 'best-row', `<span>${STR.best}</span><strong>${fmt(best)}</strong>`));
    }
    // El combo se muestra SIEMPRE que maxCombo > 1 (bajo récord o badge)
    if (maxCombo > 1) {
      p.append(this._el('div', 'combo-row',
        `<span>Mejor combo:</span><strong>×${maxCombo}</strong>`));
    }

    p.append(this._el('span', 'final-label', STR.finalScore));
    const final = this._el('span', 'final-score', '0');
    p.append(final);

    if (goldenFound) {
      // Medalla: sandía dorada real con anillo dorado fino y glow
      const line = this._el('div', 'golden-line');
      const medal = this._el('span', 'golden-medal');
      medal.append(this._miniCanvas(CONFIG.golden.tier, 28, 'golden-ico', true));
      line.append(medal, this._el('span', null, STR.goldenUnlocked));
      p.append(line);
      burst = this._goldenBurst(34);
    }

    const row = this._el('div', 'btn-row');
    const restart = this._button(STR.restart, 'btn primary');
    restart.addEventListener('click', () => onRestart());
    row.append(restart);
    if (typeof onMenu === 'function') {
      const menu = this._button('Menú', 'btn ghost');
      menu.addEventListener('click', () => onMenu());
      row.append(menu);
    }
    p.append(row);

    this._open(p, 'over-panel', STR.gameOver);

    // Celebración detrás del panel (z-index 0): no estorba a la CTA
    if (burst) {
      this.overlay.prepend(burst);
      clearTimeout(this._burstTimer);
      this._burstTimer = setTimeout(() => burst.remove(), 2800);
    }

    // Count-up de la puntuación final (900 ms easeOut)
    const target = Math.max(0, score | 0);
    const t0 = { v: null };
    const step = (ts) => {
      if (t0.v === null) t0.v = ts;
      const t = Math.min(1, (ts - t0.v) / 900);
      final.textContent = fmt(target * easeOutCubic(t));
      if (t < 1) this._raf = requestAnimationFrame(step);
      else this._raf = null;
    };
    this._raf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------
  //  Ocultar con animación de salida (250 ms)
  // ------------------------------------------------------------
  hide() {
    if (this.overlay.hidden) return;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    clearTimeout(this._burstTimer);
    const panel = this.overlay.firstElementChild;
    if (panel) panel.classList.add('leaving');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this.overlay.hidden = true;
      this.overlay.innerHTML = '';
    }, 250);
  }
}
