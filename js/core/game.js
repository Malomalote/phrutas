// ============================================================
//  SANDÍA JELLY · Núcleo del juego
//  Máquina de estados, fusiones, energía, combos y peligro.
// ============================================================

import { CONFIG, STR, TIME, DIFICULTADES, escalaFrutas, recordDe, guardarRecordDe, fijarEscalaFrutas } from '../config.js?v=15';
import { PhysicsEngine, jarGeometry, dangerY } from './physics.js?v=15';
import { Fruit } from '../entities/fruit.js?v=15';
import { Spawner } from '../entities/spawner.js?v=15';
import { buildTextures } from '../render/textures.js?v=15';
import { SceneRenderer } from '../render/renderer.js?v=15';
import { ParticleSystem } from '../effects/particles.js?v=15';
import { EffectsManager } from '../effects/effects.js?v=15';
import { Sound } from '../audio/sound.js?v=15';
import { HUD } from '../ui/hud.js?v=15';
import { Overlays } from '../ui/overlays.js?v=15';

const JAR = new Proxy({}, {
  // geometría SIEMPRE viva: main.js ajusta las bandas al redimensionar
  get(_, prop) {
    return jarGeometry()[prop];
  },
});

// Altura a la que flota la fruta lanzable: entre el HUD y la boca del tarro
function aimY() {
  return Math.max(70, jarGeometry().top - 46);
}
const now = () => performance.now();

export class Game {
  constructor({ canvas }) {
    buildTextures(); // las texturas deben existir antes de construir el HUD

    this.canvas = canvas;
    this.renderer = new SceneRenderer(canvas);
    this.physics = new PhysicsEngine();
    this.particles = new ParticleSystem();
    this.effects = new EffectsManager();
    this.hud = new HUD();
    this.overlays = new Overlays();
    this.spawner = new Spawner();

    this.fruits = [];
    this._fruitsDirty = false;
    this.state = 'menu';
    this.score = 0;
    this.dificultad = DIFICULTADES[2]; // Media por defecto
    this.fusionDoradas = false;       // opción del menú: dos doradas se funden
    this.best = this._loadBest();
    this.goldenFound = false;
    this.isRecord = false;

    this.energy = CONFIG.energy.start;
    this.tiltDir = 0;
    this.softenLeft = 0;
    this.dropCd = 0;
    this.aimX = JAR.cx;
    this.dropY = JAR.bottom;
    this.blocked = false;

    this.combo = 0;
    this.maxCombo = 1;
    this.lastMergeAt = -1e9;
    this.dangerT = 0;
    this.warnOn = false;
    this.deniedAt = 0;
    this._softenJiggleAt = 0;
    this._recordNotified = false;

    this.dieQueue = [];
    this.dieTimer = 0;
    this.slowmoUntil = 0;

    this.demo = new URLSearchParams(location.search).has('demo');
    this.demoEvents = [];
    this.demoClock = 0;

    this._wireCallbacks();
    this.hud.setBest(this.best);
    this.hud.setNext(this.spawner.next);
  }

  // ---------- Cableado de módulos ----------
  _wireCallbacks() {
    this.physics.onMerge((a, b) => this._merge(a, b));
    this.physics.onImpact((f, speed, nx, ny) => {
      if (!f.alive) return;
      f.impact(speed, nx, ny);
      if (speed > 3.2) Sound.land(f.tier, Math.min(1, speed / 14));
      // polvo solo junto al suelo: en altura leería a mancha en el cristal
      if (speed > 7.5 && f.y + f.radius > JAR.bottom - 120) {
        this.particles.dust(f.x, JAR.bottom - 6, f.radius);
      }
    });
    this.hud.bindButtons({
      onPause: () => this.togglePause(),
      onSound: () => this.toggleMute(),
      onTiltLeft: (pressed) => this.setTilt(-1, pressed),
      onTiltRight: (pressed) => this.setTilt(1, pressed),
      onSoften: () => this.soften(),
    });
    // Sonido persistido
    try {
      const m = localStorage.getItem(CONFIG.storage.muteKey) === '1';
      Sound.setMuted(m);
      this.hud.setSoundIcon(m);
    } catch { /* almacenamiento no disponible */ }
  }

  // ---------- Ciclo de partida ----------
  start(dificultadId, fusionDoradas) {
    const D = DIFICULTADES.find((d) => d.id === dificultadId) || this.dificultad || DIFICULTADES[2];
    fijarEscalaFrutas(D.escala);   // la ÚNICA variación entre niveles: tamaño de frutas
    this.dificultad = D;
    if (fusionDoradas !== undefined && fusionDoradas !== null) {
      this.fusionDoradas = !!fusionDoradas;
      try { localStorage.setItem(CONFIG.storage.fusionKey, this.fusionDoradas ? '1' : '0'); } catch { /* sin storage */ }
    }
    this.physics.clear();
    this.particles.clear();
    this.effects.clear();
    this.fruits = [];
    this._fruitsDirty = false;
    this.spawner = new Spawner();
    this.score = 0;
    this.energy = CONFIG.energy.start;
    this.combo = 0;
    this.maxCombo = 1;
    this.lastMergeAt = -1e9;
    this.dangerT = 0;
    this.warnOn = false;
    this.goldenFound = false;
    this.isRecord = false;
    this.tiltDir = 0;
    this.softenLeft = 0;
    this.dropCd = 0;
    this._recordNotified = false;
    this.best = recordDe(D.id);   // récord independiente por nivel
    this._startBest = this.best;
    this.physics.setTiltTarget(0);
    this.physics.setSoften(false);
    TIME.scale = 1;
    this.hud.reset();
    this.hud.setScore(0);
    this.hud.setBest(this.best);
    this.hud.setDifficulty(D.nombre);
    this.hud.setNext(this.spawner.next);
    this.hud.setDanger(false);
    this._prePlace();
    this.state = 'playing';
    this.overlays.hide();
    Sound.warn(false);

    // guía de primera vez: nada en demo; se cierra sola o al usar energía
    clearTimeout(this._tipTimer);
    if (!this.demo) {
      this._tipTimer = setTimeout(() => this.hud.showEnergyTip(), 1200);
    }
  }

  _prePlace() {
    const slots = [-150, -60, 40, 140];
    for (let i = 0; i < CONFIG.spawn.prePlaced; i++) {
      const tier = Math.floor(Math.random() * 3);
      const x = JAR.cx + slots[i] + (Math.random() * 18 - 9);
      const y = JAR.bottom - CONFIG.fruits[tier].radius * escalaFrutas - Math.random() * 24;
      const f = this._spawn(tier, x, y);
      f.landed = true; // nacen apoyadas: no re-quieren impacto para contar peligro
    }
  }

  _spawn(tier, x, y) {
    const f = new Fruit(tier, x, y);
    this.physics.addFruit(f);
    this.fruits.push(f);
    return f;
  }

  // ---------- Entrada ----------
  setAim(x) {
    const r = CONFIG.fruits[this.spawner.current].radius;
    this.aimX = Math.max(JAR.left + r + 4, Math.min(JAR.right - r - 4, x));
  }

  drop() {
    if (this.state !== 'playing' || this.dropCd > 0) return;
    const tier = this.spawner.current;
    const r = CONFIG.fruits[tier].radius;
    // Spawn adaptativo: con el montón alto la fruta nace pegada a él (aunque
    // sea sobre la línea roja) — como el original, te deja seguir lanzando
    // para hacerlas bajar durante el margen de gracia.
    const spawnY = Math.max(JAR.top + r * 0.35, Math.min(aimY(), this.dropY - r - 2));
    const f = this._spawn(tier, this.aimX, spawnY);
    Sound.drop(tier);
    this.dropCd = CONFIG.spawn.dropCooldown;
    this.spawner.advance();
    this.hud.setNext(this.spawner.next);
    return f;
  }

  setTilt(dir, pressed) {
    if (this.state !== 'playing') return;
    if (pressed) {
      if (this.energy <= 0.5) {
        this._denied();
        return;
      }
      this.tiltDir = dir;
      this.hud.dismissEnergyTip(); // usar la energía cierra la guía
    } else if (this.tiltDir === dir) {
      this.tiltDir = 0;
    }
  }

  soften() {
    if (this.state !== 'playing') return;
    if (this.softenLeft > 0) return;
    if (this.energy < CONFIG.physics.soften.cost) {
      this._denied();
      return;
    }
    this.energy -= CONFIG.physics.soften.cost;
    this.softenLeft = CONFIG.physics.soften.duration;
    this.physics.setSoften(true);
    Sound.soften();
    this.hud.energySpent(CONFIG.physics.soften.cost);
    this.hud.dismissEnergyTip(); // usar la energía cierra la guía
    for (const f of this.fruits) {
      if (!f.alive) continue;
      const a = Math.random() * Math.PI * 2;
      f.impact(6 + Math.random() * 5, Math.cos(a), Math.sin(a));
    }
    this.particles.sparkles(JAR.cx, JAR.bottom - 160, '#a8f0c0', 14);
  }

  _denied() {
    if (now() - this.deniedAt < 350) return;
    this.deniedAt = now();
    Sound.denied();
    this.hud.energyDenied();
  }

  toggleMute() {
    const m = !Sound.isMuted;
    Sound.setMuted(m);
    this.hud.setSoundIcon(m);
    try { localStorage.setItem(CONFIG.storage.muteKey, m ? '1' : '0'); } catch { /* sin storage */ }
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.physics.setTiltTarget(0);
      this.tiltDir = 0;
      this.overlays.showPause({
        onResume: () => this.togglePause(),
        onRestart: () => { Sound.click(); this.start(this.dificultad.id); },
      });
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.overlays.hide();
    }
  }

  toMenu() {
    this.abrirMenu();
  }

  // Menú de inicio con selector de nivel; Jugar arranca con el elegido
  abrirMenu() {
    this.state = 'menu';
    clearTimeout(this._tipTimer);
    this.hud.dismissEnergyTip();
    this.physics.clear();
    this.particles.clear();
    this.fruits = [];
    this._fruitsDirty = false;
    this.physics.setTiltTarget(0);
    this.physics.setSoften(false);
    this.tiltDir = 0;
    this.softenLeft = 0;
    Sound.warn(false);
    const records = {};
    for (const d of DIFICULTADES) records[d.id] = recordDe(d.id);
    let fusionPre = this.fusionDoradas;
    try { fusionPre = localStorage.getItem(CONFIG.storage.fusionKey) === '1'; } catch { /* sin storage */ }
    this.overlays.showStart({
      records,
      nivel: this.dificultad.id,
      fusionDoradas: fusionPre,
      onPlay: (difId, fusionOn) => {
        Sound.init();
        Sound.click();
        Sound.startMusic();
        this.start(difId, fusionOn);
      },
    });
  }

  // ---------- Fusión ----------
  _merge(a, b) {
    if (this.state !== 'playing') return;
    if (!a.alive || !b.alive) return;
    if (a.tier !== b.tier) return;
    // las doradas solo participan en la fusión máxima, y solo si se activó
    const dobleDorada = a.golden && b.golden;
    if ((a.golden || b.golden) && !(dobleDorada && this.fusionDoradas)) return;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    a.kill(); b.kill();
    this._fruitsDirty = true;
    this.physics.removeFruit(a);
    this.physics.removeFruit(b);

    const combo = (now() - this.lastMergeAt < CONFIG.combo.windowMs)
      ? Math.min(this.combo + 1, CONFIG.combo.maxMultiplier)
      : 1;
    this.combo = combo;
    this.maxCombo = Math.max(this.maxCombo, combo);
    this.lastMergeAt = now();

    // ── Nivel máximo: dos sandías doradas se funden y DESAPARECEN ──
    if (dobleDorada) {
      const pts = CONFIG.golden.mergeScore * combo;
      this._fusionDoradaMoment(mx, my, pts, combo);
      this.score += pts;
      this.energy = Math.min(CONFIG.energy.max, this.energy + CONFIG.energy.mergeGain);
      if (this.score > this._startBest && !this._recordNotified) {
        this._recordNotified = true;
        this.hud.recordSurpassed();
      }
      this.hud.flashEvolution(10);
      this.hud.setScore(this.score);
      if (this.score > this.best) {
        this.best = this.score;
        this.hud.setBest(this.best);
      }
      return; // no nace fruta nueva: se aniquilan
    }

    const isGolden = a.tier >= 10;
    // el clímax se celebra dentro de cuadro: nunca por encima del tercio superior
    const my2 = isGolden ? Math.max(my, JAR.top + 420) : my;
    const mx2 = isGolden ? JAR.cx : mx;
    const nf = new Fruit(isGolden ? 10 : a.tier + 1, mx2, my2);
    let pts;
    if (isGolden) { // sandía + sandía → sandía dorada
      nf.golden = true;
      pts = CONFIG.golden.bonusScore * combo;
      this.goldenFound = true;
      this._goldenMoment(mx2, my2);
    } else {
      pts = CONFIG.fruits[nf.tier].score * combo;
    }

    this.physics.addFruit(nf);
    this.fruits.push(nf);
    if (!isGolden) this._impulseUp(nf, -2.6);

    this.score += pts;
    this.energy = Math.min(CONFIG.energy.max, this.energy + CONFIG.energy.mergeGain);
    if (this.score > this._startBest && !this._recordNotified) {
      this._recordNotified = true;
      this.hud.recordSurpassed();
    }

    const spec = CONFIG.fruits[Math.min(nf.tier, 10)];
    if (isGolden) {
      // el clímax es monocromo-oro: nada de anillos verdes ni pulpa estándar
      this.particles.sparkles(mx2, my2, '#ffe9a3', 20);
    } else {
      this.particles.juiceBurst(mx2, my2, spec.juice, spec.radius);
      this.particles.pulpBurst(mx2, my2, spec.juice, spec.radius);
      this.particles.ring(mx2, my2, spec.radius * 1.1, spec.light);
      if (combo >= 2) this.particles.sparkles(mx2, my2, '#ffe9a3', 6 + combo * 2);
    }
    this.effects.shake(2 + nf.tier * CONFIG.juice.shakePerTier);
    this.effects.popup(mx2, my2 - spec.radius - 14, '+' + pts, {
      color: combo >= 2 ? '#ffd76e' : '#ffffff',
      size: Math.min(46, 20 + spec.radius * 0.28),
    });
    if (combo >= 2) {
      this.effects.comboBanner(combo);
      this.effects.flash(spec.light, 0.10 + nf.tier * 0.012);
    }
    Sound.pop(nf.tier, combo);
    this.hud.flashEvolution(Math.min(nf.tier, 10));
    this.hud.setScore(this.score);
    if (this.score > this.best) {
      this.best = this.score;
      this.hud.setBest(this.best);
    }
  }

  _impulseUp(f, vy) {
    // pequeño brillo de nacimiento al fusionar (Matter es global, cargado en index.html)
    if (f.body) Matter.Body.setVelocity(f.body, { x: 0, y: vy });
  }

  // Aniquilación de dos doradas: el evento máximo del juego se lleva las dos
  _fusionDoradaMoment(x, y, pts, combo) {
    this.effects.goldenBanner(STR.goldenFusionLabel);
    this.effects.flash('#ffe9a3', 0.35);
    this.effects.shake(18);
    this.particles.confettiBurst(x, y, ['#ffd76e', '#ffb347', '#fff6d8', '#ff5a7e', '#8bc34a']);
    this.particles.sparkles(x, y, '#ffe9a3', 30);
    this.particles.ring(x, y, 150, '#ffd76e');
    this.particles.juiceBurst(x, y, '#ffd76e', 140);
    this.effects.popup(x, y - 170, '+' + pts, { color: '#ffd76e', size: 52 });
    if (combo >= 2) this.effects.comboBanner(combo);
    Sound.golden();
    TIME.scale = 0.3;
    this.slowmoUntil = now() + CONFIG.juice.slowmoOnGolden;
  }

  _goldenMoment(x, y) {
    this.effects.goldenBanner(CONFIG.golden.label);
    this.effects.flash('#ffe9a3', 0.32);
    this.effects.shake(14);
    this.particles.confettiBurst(x, y, ['#ffd76e', '#ffb347', '#fff6d8', '#ff5a7e', '#8bc34a']);
    this.particles.sparkles(x, y, '#ffe9a3', 24);
    this.particles.ring(x, y, 90, '#ffd76e', 210);
    Sound.golden();
    TIME.scale = 0.3;
    this.slowmoUntil = now() + CONFIG.juice.slowmoOnGolden;
  }

  // ---------- Peligro y fin de partida ----------
  _dangerStep(dt) {
    const dy = dangerY();
    let invading = false;
    for (const f of this.fruits) {
      if (!f.alive || !f.landed || now() - f.birth < 700) continue;
      if (f.y - f.radius < dy) { invading = true; break; }
    }
    if (invading) this.dangerT += dt;
    else this.dangerT = Math.max(0, this.dangerT - dt * 2.2);

    const warn = this.dangerT > 140;
    if (warn !== this.warnOn) {
      this.warnOn = warn;
      this.hud.setDanger(warn);
      Sound.warn(warn);
    }
    if (this.dangerT > CONFIG.danger.graceMs) this._beginDeath();
  }

  get dangerPulse() {
    // pulso por invasión + aviso previo por proximidad de la pila
    const dy = dangerY();
    let topMost = JAR.bottom;
    for (const f of this.fruits) {
      if (!f.alive) continue;
      topMost = Math.min(topMost, f.y - f.radius);
    }
    const near = Math.max(0, 1 - (dy - topMost) / 120) * 0.30;
    const g = Math.min(1, this.dangerT / CONFIG.danger.graceMs);
    return Math.min(1, g * (0.55 + 0.45 * Math.sin(now() / 110)) + near);
  }

  _beginDeath() {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.tiltDir = 0;
    this.physics.setTiltTarget(0);
    Sound.warn(false);
    this.hud.setDanger(false);
    this.isRecord = this.score > 0 && this.score >= this.best;
    this.dieQueue = this.fruits.filter((f) => f.alive).sort((a, b) => a.y - b.y);
    this.dieTimer = 260;
  }

  _dyingStep(dt) {
    this.dieTimer -= dt;
    if (this.dieTimer <= 0 && this.dieQueue.length > 0) {
      const f = this.dieQueue.shift();
      if (f.alive) {
        f.kill();
        this._fruitsDirty = true;
        this.physics.removeFruit(f);
        const spec = CONFIG.fruits[Math.min(f.tier, 10)];
        this.particles.juiceBurst(f.x, f.y, spec.juice, f.radius * 0.8);
        Sound.pop(f.tier, 1);
        this.effects.shake(1.4 + f.tier * 0.5);
      }
      this.dieTimer = 70;
    }
    if (this.dieQueue.length === 0 && this.dieTimer <= -350) {
      this.state = 'gameover';
      this._saveBest();
      Sound.gameOver();
      this.overlays.showGameOver({
        score: this.score,
        best: this.best,
        isRecord: this.isRecord,
        goldenFound: this.goldenFound,
        maxCombo: this.maxCombo,
        dificultad: this.dificultad.nombre,
        onRestart: () => { Sound.click(); this.start(this.dificultad.id); },
        onMenu: () => { Sound.click(); this.toMenu(); },
      });
    }
  }

  _loadBest() {
    return recordDe(this.dificultad.id);
  }

  _saveBest() {
    guardarRecordDe(this.dificultad.id, this.best);
  }

  // ---------- Actualización por frame ----------
  update(dtReal) {
    const t = now();

    // Recuperación de la cámara lenta
    if (t > this.slowmoUntil) TIME.scale += (1 - TIME.scale) * 0.08;
    const dt = dtReal * TIME.scale;

    if (this.state === 'playing') {
      // inclinación: drena energía
      if (this.tiltDir !== 0) {
        this.energy -= CONFIG.energy.tiltDrainPerSecond * dtReal / 1000;
        if (this.energy <= 0) {
          this.energy = 0;
          this.tiltDir = 0;
          this._denied();
        }
      }
      this.physics.setTiltTarget(this.tiltDir * CONFIG.physics.tilt.maxAngle);

      // amasar: temporizador + empuje físico real (desplaza, no solo vibra)
      if (this.softenLeft > 0) {
        this.softenLeft -= dtReal;
        if (this.softenLeft <= 0) {
          this.softenLeft = 0;
          this.physics.setSoften(false);
        } else if (now() - this._softenJiggleAt > 190) {
          this._softenJiggleAt = now();
          for (const f of this.fruits) {
            if (!f.alive) continue;
            const ph = Math.sin(f.x * 0.05 + now() * 0.004);
            f.impact(2.6 + ph * 1.8, ph, 1 - Math.abs(ph) * 0.6); // gelatina visual
            // con la fricción bajada por setSoften, estos empujes desplazan
            // las frutas de verdad: se reordenan y pueden encadenar fusiones
            if (f.body) {
              Matter.Body.setVelocity(f.body, {
                x: (Math.random() - 0.5) * 7,
                y: -Math.random() * 3,
              });
            }
          }
        }
      }
      this.hud.setSoftenActive(this.softenLeft > 0);

      // blindaje: la energía nunca puede dejar de ser un número
      if (!Number.isFinite(this.energy)) this.energy = CONFIG.energy.start;

      this.dropCd = Math.max(0, this.dropCd - dtReal);

      this.physics.step(dt);
      for (const f of this.fruits) if (f.alive) f.update(dt);
      this._dangerStep(dtReal);

      // geometría de apuntado; "blocked" ya no bloquea el soltado: solo tiñe
      // de rojo el marcador como aviso de que el aterrizaje queda sobre la línea
      const r = CONFIG.fruits[this.spawner.current].radius;
      this.dropY = this._dropY(this.aimX, r);
      this.blocked = this.dropY - r < dangerY();

      if (this.demo) this._demoStep(dtReal);
    } else if (this.state === 'dying') {
      this.physics.step(dt * 0.4);
      for (const f of this.fruits) if (f.alive) f.update(dt);
      this._dyingStep(dtReal);
    }

    // Compactación estable, solo tras una baja y sin asignar otro array.
    if (this._fruitsDirty) {
      let live = 0;
      for (const fruit of this.fruits) {
        if (fruit.alive) this.fruits[live++] = fruit;
      }
      this.fruits.length = live;
      this._fruitsDirty = false;
    }

    this.particles.update(dt);
    this.effects.update(dtReal);

    // HUD energía (solo si cambia)
    if (this._lastEnergy === undefined || Math.abs(this._lastEnergy - this.energy) > 0.15) {
      this._lastEnergy = this.energy;
      this.hud.setEnergy(this.energy, CONFIG.energy.max);
    }
  }

  _dropY(x, r) {
    let y = JAR.bottom - r;
    for (const f of this.fruits) {
      if (!f.alive) continue;
      if (Math.abs(f.x - x) < f.radius + r - 2) {
        y = Math.min(y, f.y - f.radius - r);
      }
    }
    return Math.max(JAR.top + r, y);
  }

  // ---------- Render ----------
  render() {
    const ctx = this.renderer.ctx;
    const scale = this.canvas.width / CONFIG.world.width;
    const t = now();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, CONFIG.world.width, CONFIG.world.height);

    ctx.save();
    ctx.translate(this.effects.offsetX, this.effects.offsetY);

    this.renderer.drawBackground(ctx, t);
    this.renderer.drawJarBack(ctx, t);
    this.renderer.drawFruits(ctx, this.fruits, t);
    if (this.state === 'playing' && this.dropCd < CONFIG.spawn.dropCooldown * 0.55) {
      this.renderer.drawAim(ctx, this.spawner.current, this.aimX, aimY(), this.dropY, this.blocked, t);
    }
    // el zumo no atraviesa el cristal: partículas traseras clipeadas al tarro
    const clipped = typeof this.renderer.clipJarInterior === 'function';
    if (clipped) {
      ctx.save();
      this.renderer.clipJarInterior(ctx);
    }
    this.particles.drawBack(ctx);
    if (clipped) ctx.restore();
    this.renderer.drawJarFront(ctx, t);
    if (this.softenLeft > 0) {
      const inten = Math.min(1, this.softenLeft / 700);
      this.renderer.setSoftenWobble(inten); // el cristal tiembla con la gelatina
      this.renderer.drawSoftenAura(ctx, inten, t);
    } else if (this._lastWobble) {
      this.renderer.setSoftenWobble(0);
      this._lastWobble = false;
    }
    if (this.softenLeft > 0) this._lastWobble = true;
    this.renderer.drawDangerLine(ctx, this.state === 'playing' ? this.dangerPulse : 0, t);
    this.particles.drawFront(ctx);
    this.effects.drawFront(ctx);

    ctx.restore();
  }

  // ---------- Modo demo (capturas / QA) ----------
  _demoStep(dt) {
    this.demoClock += dt;
    const E = this.demoEvents;
    while (E.length && E[0].t <= this.demoClock) {
      const e = E.shift();
      this._spawn(e.tier, JAR.cx + e.x, e.y ?? (JAR.top + 40));
    }
  }

  startDemo() {
    this.start('muy-dificil');
    const seq = [
      { t: 150, tier: 0, x: -90 }, { t: 150, tier: 0, x: -30 },
      { t: 1100, tier: 1, x: 120 }, { t: 1900, tier: 1, x: 170 },
      { t: 2700, tier: 2, x: -150 }, { t: 3400, tier: 2, x: -95 },
      { t: 4300, tier: 0, x: 40 }, { t: 4900, tier: 0, x: 90 },
      { t: 5600, tier: 3, x: 100 }, { t: 6200, tier: 3, x: 150 },
      { t: 6900, tier: 1, x: -40 }, { t: 7500, tier: 1, x: 10 },
      { t: 8200, tier: 2, x: 60 }, { t: 8800, tier: 2, x: 5 },
      { t: 9500, tier: 4, x: -170 }, { t: 10300, tier: 4, x: -120 },
      { t: 11000, tier: 0, x: 160 }, { t: 11600, tier: 1, x: -190 },
      { t: 12300, tier: 3, x: 60 }, { t: 12900, tier: 2, x: -60 },
      { t: 13600, tier: 3, x: -140 }, { t: 14200, tier: 2, x: 150 },
      { t: 14900, tier: 1, x: -20 }, { t: 15500, tier: 4, x: 170 },
      { t: 16200, tier: 2, x: -180 }, { t: 16900, tier: 3, x: 20 },
      { t: 17600, tier: 4, x: -60 }, { t: 18300, tier: 3, x: 110 },
    ];
    this.demoEvents = seq.map((e) => ({ ...e, y: JAR.top + 30 }));
    this.demoClock = 0;
  }

  // ---------- Utilidades de depuración/QA ----------
  debugAdd(tier, dx, dy) {
    return this._spawn(Math.max(0, Math.min(10, tier)), JAR.cx + dx, JAR.top + 30 + (dy || 0));
  }

  debugSettle(tier, dx) {
    const r = CONFIG.fruits[tier].radius;
    return this._spawn(tier, JAR.cx + dx, JAR.bottom - r - 2);
  }

  debugSoften() { this.soften(); }

  debugGameOver() {
    this._spawn(9, JAR.cx - 60, JAR.bottom - 91);
    this._spawn(8, JAR.cx + 70, JAR.bottom - 88);
    this._spawn(7, JAR.cx - 160, JAR.bottom - 74);
    this._spawn(6, JAR.cx + 160, JAR.bottom - 61);
    this.score = this.score || 1234;
    this._beginDeath();
  }
}
