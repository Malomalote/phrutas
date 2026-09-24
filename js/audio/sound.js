// ============================================================
//  SANDÍA JELLY · Motor de audio 100% WebAudio (sin ficheros)
//  Cadena maestra: master(0.9) → compresor → destino
//  Música ambiental premium + SFX jugosos, todo sintetizado.
// ============================================================

import { CONFIG } from '../config.js?v=13';

// ----- utilidades -----
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

const BPM = 92;
const SIXTEENTH = 60 / BPM / 4;                 // duración de una semicorchea
const PENTA = [0, 2, 4, 7, 9];                  // pentatónica mayor (C D E G A)
const PAT = [0, -1, -1, 2, -1, -1, 4, -1, -1, 3, -1, -1, 5, -1, 7, -1]; // arpegio

export const Sound = {
  ctx: null,
  master: null,
  comp: null,
  sfx: null,          // bus de efectos
  mus: null,          // bus de música (gain total)
  noiseBuf: null,
  initialized: false,
  _muted: false,
  _musicWanted: false,
  _music: null,       // { bus, nodes[], state }
  _warnTimer: 0,

  get isMuted() { return this._muted; },

  // ----- init perezoso y seguro (primer gesto del usuario) -----
  init() {
    if (this.initialized) return;
    try {
      const AC = (typeof window !== 'undefined')
        && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.knee.value = 24;
      this.comp.ratio.value = 6;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.18;
      this.comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.comp);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);

      this.mus = ctx.createGain();
      this.mus.gain.value = this._muted ? 0 : 0.55; // música ≤0.16 total
      this.mus.connect(this.master);

      // buffer de ruido blanco reutilizable
      const len = Math.floor(ctx.sampleRate * 1.2);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.initialized = true;
      if (this._musicWanted) this.startMusic();
    } catch (e) {
      this.initialized = false; // autoplay bloqueado: seguir sin audio
    }
  },

  setMuted(m) {
    this._muted = !!m;
    if (this.initialized && this.mus) {
      const t = this.ctx.currentTime;
      this.mus.gain.cancelScheduledValues(t);
      this.mus.gain.setTargetAtTime(this._muted ? 0 : 0.55, t, 0.05);
    }
  },

  // Silenciar solo corta la salida: el contexto puede seguir vivo.
  _ok() { return this.initialized && !this._muted; },
  _now() { return this.ctx.currentTime; },

  // ===== voces básicas =====

  _tone(t0, dur, o = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(o.peak || 0.3, 0.0002), t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.dest || this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return { osc, g };
  },

  _noise(t0, dur, o = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 800, t0);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(o.peak || 0.3, 0.0002), t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.dest || this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return { f, g };
  },

  // campana FM brillante (para fanfarrias)
  _bell(t0, freq, dur, peak) {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2.01;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 1.4, t0);
    mg.gain.exponentialRampToValueAtTime(1, t0 + dur * 0.5);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    car.connect(g);
    g.connect(this.sfx);
    car.start(t0);
    mod.start(t0);
    car.stop(t0 + dur + 0.05);
    mod.stop(t0 + dur + 0.05);
  },

  // ===== música ambiental (delicada, marimba + pad cálido + delay) =====

  startMusic() {
    this._musicWanted = true;
    if (!this.initialized || this._music) return;
    const ctx = this.ctx;

    // bus con delay-feedback suave para espacialidad
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = SIXTEENTH * 3; // 3/16
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    bus.connect(this.mus);
    bus.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.mus);

    // pad cálido: 2 saws desafinados → lowpass 400Hz con LFO lentísimo
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 400;
    padFilter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 130;
    lfo.connect(lfoG);
    lfoG.connect(padFilter.frequency);

    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    padGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
    padFilter.connect(padGain);
    padGain.connect(bus);

    const nodes = [lfo];
    [[48, -5], [55, 5]].forEach(([n, det]) => { // C3 y G3 (quinta abierta)
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = midi(n);
      saw.detune.value = det;
      saw.connect(padFilter);
      saw.start();
      nodes.push(saw);
    });
    lfo.start();

    // secuenciador con lookahead de 350ms cada 100ms
    const state = { next: ctx.currentTime + 0.15, step: 0, timer: 0 };
    state.timer = setInterval(() => this._schedule(state, bus), 100);
    this._music = { bus, nodes, state };
    this._schedule(state, bus);
  },

  _schedule(state, bus) {
    if (!this._music || !this.initialized) return;
    const ahead = this._now() + 0.35;
    while (state.next < ahead) {
      const s = state.step % 16;
      const v = PAT[s];
      if (v >= 0 && !this._muted) {
        const deg = PENTA[v % 5] + 12 * Math.floor(v / 5);
        const vel = s % 4 === 0 ? 0.1 : 0.075;
        this._marimba(state.next, midi(72 + deg), vel, bus);
      }
      state.next += SIXTEENTH;
      state.step++;
    }
  },

  // pluck marimba-like: sine + triangle con envolvente corta
  _marimba(t, freq, peak, bus) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    o2.detune.value = 6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(bus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.55);
    o2.stop(t + 0.55);
  },

  stopMusic() {
    this._musicWanted = false;
    if (!this._music) return;
    const m = this._music;
    this._music = null;
    clearInterval(m.state.timer);
    const t = this._now();
    m.bus.gain.cancelScheduledValues(t);
    m.bus.gain.setTargetAtTime(0.0001, t, 0.08);
    setTimeout(() => {
      try {
        m.nodes.forEach((n) => n.stop());
        m.bus.disconnect();
      } catch (e) { /* nodos ya liberados */ }
    }, 500);
  },

  // ===== SFX =====

  // thud de lanzamiento
  drop(tier) {
    if (!this._ok()) return;
    const t = this._now();
    const f = clamp(90 + tier * 5, 90, 140);
    this._tone(t, 0.09, { f0: f, f1: f * 0.7, peak: 0.35, attack: 0.003 });
    this._noise(t, 0.07, { type: 'lowpass', freq: 420, peak: 0.16 });
  },

  // golpe suave de fruta: pitch ∝ 1/radio (14px→180Hz, 120px→70Hz)
  land(tier, strength) {
    if (!this._ok()) return;
    const t = this._now();
    const fr = CONFIG.fruits[tier] || CONFIG.fruits[0];
    const k = clamp((fr.radius - 14) / (120 - 14), 0, 1);
    const f = 180 - k * 110;
    const v = clamp(strength == null ? 0.6 : strength, 0.15, 1);
    this._tone(t, 0.12, { f0: f, f1: f * 0.82, peak: 0.34 * v });
    this._noise(t, 0.06, { type: 'bandpass', freq: f * 3.2, q: 1.2, peak: 0.14 * v });
  },

  // plop jugoso de fusión: pitch-bend + 5ª arriba + salpicadura + campanita
  pop(tier, combo = 1) {
    if (!this._ok()) return;
    const t = this._now();
    const top = 320 + tier * 28;
    this._tone(t, 0.16, { f0: 200, f1: top, peak: 0.4, attack: 0.004 });
    this._tone(t + 0.06, 0.13, { f0: top * 1.5, f1: top * 1.9, peak: 0.16, attack: 0.003 });
    this._noise(t, 0.12, { type: 'bandpass', freq: 1200, q: 0.9, peak: 0.18 });
    if (combo > 1) {
      // campanita pentatónica que sube con el combo
      const idx = Math.min(combo - 2, 9);
      const deg = PENTA[idx % 5] + 12 * Math.floor(idx / 5);
      const f = midi(84 + deg);
      this._tone(t + 0.02, 0.5, { type: 'triangle', f0: f, peak: 0.14, attack: 0.003 });
      this._tone(t + 0.02, 0.4, { f0: f * 2, peak: 0.05, attack: 0.003 });
    }
  },

  // fanfarria dorada: arpegio mayor con campanas FM + shimmer
  golden() {
    if (!this._ok()) return;
    const t = this._now();
    [72, 76, 79, 84, 88].forEach((n, i) => { // C E G C' E'
      this._bell(t + i * 0.09, midi(n), 0.9, 0.22);
    });
    this._noise(t, 1.1, { type: 'highpass', freq: 6000, peak: 0.08, attack: 0.02 });
  },

  // fin de partida: tres notas descendentes con vibrato + lavado grave
  gameOver() {
    if (!this._ok()) return;
    const t = this._now();
    [64, 60, 57].forEach((n, i) => { // E4 C4 A3
      const tt = t + i * 0.4;
      const v = this._tone(tt, 0.8, { f0: midi(n), peak: 0.22, attack: 0.03 });
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lg = this.ctx.createGain();
      lg.gain.value = 3.5;
      lfo.connect(lg);
      lg.connect(v.osc.frequency);
      lfo.start(tt);
      lfo.stop(tt + 0.85);
    });
    this._noise(t, 1.6, { type: 'lowpass', freq: 220, peak: 0.12, attack: 0.05 });
  },

  // blip de interfaz
  click() {
    if (!this._ok()) return;
    this._tone(this._now(), 0.07, { f0: 700, f1: 900, peak: 0.16, attack: 0.002 });
  },

  // buzz grave doble: "sin energía"
  denied() {
    if (!this._ok()) return;
    const t = this._now();
    this._tone(t, 0.06, { type: 'square', f0: 110, peak: 0.16, attack: 0.004 });
    this._tone(t + 0.12, 0.06, { type: 'square', f0: 110, peak: 0.16, attack: 0.004 });
  },

  // squish de amasado: barrido bandpass con LFO en Q + burbujeo
  soften() {
    if (!this._ok()) return;
    const t = this._now();
    const n = this._noise(t, 0.55, { type: 'bandpass', freq: 300, q: 5, peak: 0.2, attack: 0.05 });
    n.f.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = this.ctx.createGain();
    lg.gain.value = 3.5;
    lfo.connect(lg);
    lg.connect(n.f.Q);
    lfo.start(t);
    lfo.stop(t + 0.6);
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.05 + i * 0.11 + Math.random() * 0.04;
      const f = 140 + Math.random() * 220;
      this._tone(tt, 0.09, { f0: f, f1: f * 1.6, peak: 0.1, attack: 0.006 });
    }
  },

  // latido de peligro (arranca/para)
  warn(on) {
    if (on) {
      if (!this.initialized || this._warnTimer) return;
      this._heartbeat();
      this._warnTimer = setInterval(() => this._heartbeat(), 600);
    } else if (this._warnTimer) {
      clearInterval(this._warnTimer);
      this._warnTimer = 0;
    }
  },

  _heartbeat() {
    if (!this._ok()) return;
    const t = this._now();
    this._tone(t, 0.14, { f0: 60, peak: 0.3, attack: 0.012 });        // lub
    this._tone(t + 0.17, 0.11, { f0: 55, peak: 0.2, attack: 0.01 });  // dub
  },
};
