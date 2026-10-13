// ============================================================
//  HUD · Puntuación, siguiente fruta, energía y cadena de evolución
//  El DOM es fijo (index.html): aquí solo se cachea, anima y pinta.
// ============================================================

import { CONFIG, STR } from '../config.js?v=15';
import { fruitTexture, drawFruitTexture, MARGEN } from '../render/textures.js?v=15';

// Formato es-ES con separador de miles
const fmt = (n) => Math.round(n).toLocaleString('es-ES');
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// Altavoz SVG con dos estados (ondas / tachado): el emoji era ilegible
const SVG_SOUND_ON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e8e2f6" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11 5 6 9H3v6h3l5 4V5z"/>' +
  '<path d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
  '<path d="M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SVG_SOUND_OFF =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e8e2f6" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11 5 6 9H3v6h3l5 4V5z"/>' +
  '<line x1="16" y1="9" x2="22" y2="15"/>' +
  '<line x1="22" y1="9" x2="16" y2="15"/></svg>';

export class HUD {
  constructor() {
    // --- Caché de elementos por id (estructura fija) ---
    this.scoreEl = document.getElementById('score');
    this.bestEl = document.getElementById('best');
    this.bestBlock = this.bestEl.closest('.score-block');
    // Chip del nivel de dificultad actual (texto lo pone setDifficulty)
    this.difChip = document.createElement('span');
    this.difChip.className = 'dif-hud';
    this.difChip.hidden = true;
    this.bestEl.closest('.score-panel').querySelector('.score-row')
      .append(this.difChip);
    this.nextLabel = document.getElementById('label-next');
    this.nextCanvas = document.getElementById('next-canvas');
    this.rail = document.getElementById('energy-rail');
    this.track = this.rail.querySelector('.energy-track');
    this.fill = document.getElementById('energy-fill');
    this.tiltLeftBtn = document.getElementById('btn-tilt-left');
    this.tiltRightBtn = document.getElementById('btn-tilt-right');
    this.softenBtn = document.getElementById('btn-soften');
    this.softenText = this.softenBtn.querySelector('.soften-text');
    this.strip = document.getElementById('evo-strip');
    this.banner = document.getElementById('danger-banner');
    this.soundBtn = document.getElementById('btn-sound');
    this.pauseBtn = document.getElementById('btn-pause');
    this.energyLabel = document.getElementById('label-energy');

    // --- Estado interno ---
    this._shown = 0;            // valor mostrado actualmente en #score
    this._scoreRAF = null;
    this._nextTier = null;      // último tier dibujado en #next-canvas
    this._dangerTimer = null;
    this._softenHTML = this.softenText.innerHTML; // etiqueta original del botón
    this._softenActive = null;
    this.recordMini = null;     // mini-badge "¡RÉCORD!" (récord en vivo)

    this.energyLabel.textContent = STR.energy;
    this.nextLabel.textContent = STR.next;

    // Altavoz SVG: ambos estados creados, setSoundIcon alterna hidden
    this.soundBtn.textContent = '';
    this.sndOn = this._soundIco(SVG_SOUND_ON);
    this.sndOff = this._soundIco(SVG_SOUND_OFF);
    this.sndOff.hidden = true;
    this.soundBtn.append(this.sndOn, this.sndOff);

    // Glifos de inclinación "mirando hacia fuera" + micro-etiqueta
    // (el HTML fijo trae ↶/↷ sin etiqueta; se sustituyen desde aquí)
    this._buildTilt(this.tiltLeftBtn, '↺');
    this._buildTilt(this.tiltRightBtn, '↻');

    this.nextCtx = this.nextCanvas.getContext('2d');
    this.nextCtx.imageSmoothingEnabled = true;
    this.nextCtx.imageSmoothingQuality = 'high';

    // Al terminar el pop retiramos la clase (por si no disparase animationend)
    this.scoreEl.addEventListener('animationend', () => this.scoreEl.classList.remove('bump'));

    this._buildEvoStrip();
  }

  // Botón de inclinación: flecha + "Inclinar tarro" debajo (9-10px)
  _buildTilt(btn, glyph) {
    btn.textContent = '';
    const g = document.createElement('span');
    g.className = 'tilt-glyph';
    g.textContent = glyph;
    const l = document.createElement('span');
    l.className = 'tilt-label';
    l.textContent = STR.tiltLeft; // mismo texto para ambos: "Inclinar tarro"
    btn.append(g, l);
  }

  // Envoltorio para los iconos SVG del botón de sonido
  _soundIco(svg) {
    const s = document.createElement('span');
    s.className = 'sound-ico';
    s.innerHTML = svg;
    return s;
  }

  // ------------------------------------------------------------
  //  Cadena de evolución: 11 celdas con icono creciente + nombre
  // ------------------------------------------------------------
  _buildEvoStrip() {
    const fruits = CONFIG.fruits;
    const last = fruits.length - 1;
    this.evoCells = [];
    this.strip.innerHTML = '';

    fruits.forEach((f, i) => {
      const size = Math.round(22 + 4 * (i / last)); // 22 → 26 px en pantalla
      const cell = document.createElement('div');
      cell.className = 'evo-cell';
      cell.dataset.tier = String(i);

      const c = document.createElement('canvas');
      c.width = size * 2;              // 2x para nitidez en pantallas retina
      c.height = size * 2;
      c.style.width = `${size}px`;
      c.style.height = `${size}px`;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // zoom ×MARGEN centrado: el cuerpo de la fruta (1/MARGEN del sprite)
      // pasa a ocupar ~el 94% del icono en vez de perderse en el aire del lienzo
      const zoom = size * 2 * MARGEN * 0.94;
      drawFruitTexture(ctx, fruitTexture(i), (c.width - zoom) / 2, (c.height - zoom) / 2, zoom, zoom);

      const name = document.createElement('span');
      name.className = 'evo-name';
      name.textContent = f.name;

      cell.append(c, name);
      this.strip.append(cell);
      this.evoCells.push({ cell, canvas: c });

      // Separador translúcido entre frutas
      if (i < last) {
        const sep = document.createElement('span');
        sep.className = 'evo-sep';
        sep.textContent = '›';
        this.strip.append(sep);
      }
    });

    // Semántica: el tier 0 (Arándano) nace descubierto
    this.evoCells[0].cell.classList.add('discovered');
  }

  // ------------------------------------------------------------
  //  Puntuación con cuenta animada: SIEMPRE desde el valor mostrado,
  //  260 ms; si llega otra puntuación a mitad, se cancela y re-anima
  //  desde el número en pantalla (el display alcanza el real <400 ms).
  // ------------------------------------------------------------
  setScore(n) {
    const to = Math.max(0, n | 0);
    if (this._scoreRAF) cancelAnimationFrame(this._scoreRAF);

    if (to === this._shown) {
      this.scoreEl.textContent = fmt(to);
      return;
    }
    if (to > this._shown) {
      // pop de escala solo al subir (las fusiones nunca restan)
      this.scoreEl.classList.remove('bump');
      void this.scoreEl.offsetWidth; // reinicia la animación
      this.scoreEl.classList.add('bump');
    }

    const from = this._shown; // valor EN PANTALLA (se actualiza cada frame)
    const t0 = performance.now();
    const dur = 260;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      this._shown = from + (to - from) * easeOutCubic(t);
      this.scoreEl.textContent = fmt(this._shown);
      if (t < 1) {
        this._scoreRAF = requestAnimationFrame(step);
      } else {
        this._shown = to;
        this.scoreEl.textContent = fmt(to);
        this._scoreRAF = null;
      }
    };
    this._scoreRAF = requestAnimationFrame(step);
  }

  // Récord (texto plano, sin animación)
  setBest(n) {
    this.bestEl.textContent = fmt(n);
  }

  // Récord superado EN VIVO: valor dorado + mini-badge que parpadea
  // 1.6 s y DESAPARECE (animationend → remove)
  recordSurpassed() {
    this.bestBlock.classList.add('record-gold');
    if (!this.recordMini) {
      this.recordMini = document.createElement('span');
      this.recordMini.className = 'record-mini';
      this.recordMini.textContent = '¡RÉCORD!';
      this.recordMini.addEventListener('animationend', () => {
        this.recordMini?.remove();
        this.recordMini = null;
      }, { once: true });
      this.bestBlock.append(this.recordMini);
    } else {
      // si ya estaba visible, reinicia el parpadeo
      this.recordMini.classList.remove('blink');
      void this.recordMini.offsetWidth;
    }
    this.recordMini.classList.add('blink');
  }

  // Chip discreto con el nivel de dificultad de la partida en curso
  setDifficulty(nombre) {
    this.difChip.textContent = nombre;
    this.difChip.hidden = false;
  }

  // ------------------------------------------------------------
  //  Guía de primera vez (coach-mark del rail de energía):
  //  se muestra una sola vez — usar Inclinar/Amasar o «Entendido»
  //  la cierra y lo recuerda en localStorage.
  // ------------------------------------------------------------
  showEnergyTip() {
    if (this._tipShown) return;
    try {
      if (localStorage.getItem(CONFIG.storage.tutorialKey) === '1') return;
    } catch { /* sin storage: se muestra siempre */ }
    this._tipShown = true;

    const tip = document.createElement('div');
    tip.id = 'energy-tip';
    tip.setAttribute('role', 'note');

    const title = document.createElement('strong');
    title.textContent = STR.tutorial.titulo;
    tip.append(title);

    const list = document.createElement('ul');
    for (const linea of STR.tutorial.lineas) {
      const li = document.createElement('li');
      li.textContent = linea;
      list.append(li);
    }
    tip.append(list);

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn tip-ok';
    ok.textContent = STR.tutorial.cerrar;
    tip.append(ok);

    this.rail.append(tip);
    this._tipNode = tip;

    ok.addEventListener('click', () => this.dismissEnergyTip());
    this._tipTimer = setTimeout(() => this.dismissEnergyTip(), 14000);
  }

  dismissEnergyTip() {
    if (!this._tipNode) return;
    clearTimeout(this._tipTimer);
    const node = this._tipNode;
    this._tipNode = null;
    node.classList.add('bye');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600); // red de seguridad sin transitionend
    try {
      localStorage.setItem(CONFIG.storage.tutorialKey, '1');
    } catch { /* sin storage */ }
  }

  // ------------------------------------------------------------
  //  Siguiente fruta: se dibuja grande (margen mínimo) y solo al cambiar
  // ------------------------------------------------------------
  setNext(tier) {
    if (tier === this._nextTier) return;
    this._nextTier = tier;
    const ctx = this.nextCtx;
    ctx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
    // zoom ×MARGEN centrado: el cuerpo de la fruta llena el orbe (94%),
    // no el sprite entero con su aire
    const w = this.nextCanvas.width;
    const side = w * MARGEN * 0.9;
    drawFruitTexture(ctx, fruitTexture(tier), (w - side) / 2, (w - side) / 2, side, side);
  }

  // ------------------------------------------------------------
  //  Energía: altura del fill + estados .low / .full en el rail
  // ------------------------------------------------------------
  setEnergy(v, max) {
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    this.fill.style.height = `${pct}%`;
    const cost = CONFIG.physics.soften.cost;
    this.rail.classList.toggle('low', v < cost);
    this.rail.classList.toggle('full', v >= 99.5);
    this.track.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  // Gasto de energía: flash blanco breve en el extremo consumido (arriba)
  energySpent(v, max) {
    if (typeof v === 'number') this.setEnergy(v, max ?? CONFIG.energy.max);
    this.fill.classList.remove('spend');
    void this.fill.offsetWidth;
    this.fill.classList.add('spend');
    const done = (e) => {
      if (e.animationName === 'spendFlash') {
        this.fill.classList.remove('spend');
        this.fill.removeEventListener('animationend', done);
      }
    };
    this.fill.addEventListener('animationend', done);
  }

  // ------------------------------------------------------------
  //  Aviso de peligro: hidden + .visible con animación de entrada
  // ------------------------------------------------------------
  setDanger(show) {
    clearTimeout(this._dangerTimer);
    if (show) {
      this.banner.hidden = false;
      void this.banner.offsetWidth; // garantiza re-animación de entrada
      this.banner.classList.add('visible');
    } else {
      this.banner.classList.remove('visible');
      this._dangerTimer = setTimeout(() => { this.banner.hidden = true; }, 350);
    }
  }

  // Pulso dorado en la celda descubierta + marca permanente
  flashEvolution(tier) {
    const entry = this.evoCells[tier];
    if (!entry) return;
    entry.cell.classList.add('discovered');
    entry.cell.classList.remove('flash');
    void entry.cell.offsetWidth;
    entry.cell.classList.add('flash');
    entry.cell.addEventListener('animationend', () => entry.cell.classList.remove('flash'), { once: true });
  }

  // Estado del botón "Amasar": ✋ Amasando… (con −60) / etiqueta original
  setSoftenActive(active) {
    active = !!active;
    if (this._softenActive === active) return;
    this._softenActive = active;
    this.softenBtn.classList.toggle('active', active);
    this.softenBtn.setAttribute('aria-pressed', String(active));
    // Terminología del juego: "amasar", nunca "gelatina"
    this.softenText.innerHTML = active
      ? 'Amasando…<br><small>−60</small>'
      : this._softenHTML;
    if (active) this._spawnFloatCost();
  }

  // "−60" flotante junto a la barra de energía (sube y se desvanece)
  _spawnFloatCost() {
    this.rail.querySelector('.float-cost')?.remove();
    const s = document.createElement('span');
    s.className = 'float-cost';
    s.textContent = `−${CONFIG.physics.soften.cost}`;
    s.addEventListener('animationend', () => s.remove(), { once: true });
    this.rail.append(s);
  }

  // Energía insuficiente: shake horizontal del rail + flash rojo del fill
  energyDenied() {
    for (const [el, cls] of [[this.rail, 'denied'], [this.fill, 'flash-red']]) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    }
  }

  // ------------------------------------------------------------
  //  Botones: click simples + inclinación tipo "mantener pulsado"
  // ------------------------------------------------------------
  bindButtons({ onPause, onSound, onTiltLeft, onTiltRight, onSoften }) {
    const cb = (fn) => (typeof fn === 'function' ? fn : () => {});

    this.pauseBtn.addEventListener('click', () => cb(onPause)());
    this.soundBtn.addEventListener('click', () => cb(onSound)());
    this.softenBtn.addEventListener('click', () => cb(onSoften)());

    // Inclinación: pressed=true al empezar a pulsar, false al soltar/salir.
    // Pointer events cubren ratón y táctil sin duplicar eventos.
    const bindHold = (el, fn) => {
      const press = (e) => { e.preventDefault(); fn(true); };
      const release = () => fn(false);
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointerleave', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault()); // larga pulsación móvil
    };
    bindHold(this.tiltLeftBtn, cb(onTiltLeft));
    bindHold(this.tiltRightBtn, cb(onTiltRight));
  }

  setSoundIcon(muted) {
    this.sndOn.hidden = muted;
    this.sndOff.hidden = !muted;
  }

  // Reinicio visual (nueva partida): arándano descubierto, resto apagado
  reset() {
    for (const { cell } of this.evoCells) cell.classList.remove('discovered', 'flash');
    this.evoCells[0]?.cell.classList.add('discovered'); // tier 0 nace encendido
    this.bestBlock.classList.remove('record-gold');
    this.recordMini?.remove();
    this.recordMini = null;
    this.difChip.hidden = true;
    this.dismissEnergyTip();
    this.setDanger(false);
    this.setSoftenActive(false);
    this._nextTier = null;
  }
}
