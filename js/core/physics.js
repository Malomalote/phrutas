// ============================================================
//  Núcleo de física · Matter.js
//  Tarro (paredes estáticas), gravedad orientable (inclinación),
//  detección de fusiones e impactos. Mundo lógico 720×1080.
// ============================================================

import { CONFIG } from '../config.js?v=15';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

// Velocidad relativa mínima (px/step) para considerar "impacto" sonoro/visual
const IMPACT_SPEED = 2.5;

// ------------------------------------------------------------
//  Geometría PURA del tarro, derivada de CONFIG
// ------------------------------------------------------------
export function jarGeometry() {
  const cx = CONFIG.jar.centerX;
  const halfW = CONFIG.jar.innerWidth / 2;
  const bottom = CONFIG.world.height - CONFIG.jar.bottomMargin;
  return {
    left: cx - halfW,
    right: cx + halfW,
    top: CONFIG.jar.topMargin,
    bottom,
    cx,
    wallT: CONFIG.jar.wallThickness,
  };
}

// Línea de peligro: siempre a una distancia fija bajo la boca del tarro
export function dangerY() {
  return jarGeometry().top + CONFIG.danger.offsetFromMouth;
}

// ------------------------------------------------------------
//  Motor de física
// ------------------------------------------------------------
export class PhysicsEngine {
  constructor() {
    const P = CONFIG.physics;

    this.engine = Engine.create();
    this.engine.gravity.y = P.gravityY;
    this.engine.gravity.scale = 0.001; // escala por defecto de Matter
    this.engine.positionIterations = 10;
    this.engine.velocityIterations = 8;

    // Paredes estáticas: izquierda, derecha y suelo (tras el cristal visual)
    this.walls = this._buildWalls();
    Composite.add(this.engine.world, this.walls);

    // Estado interno
    this._fruits = new Set();          // frutas vivas en el mundo
    this._tiltTarget = 0;              // ángulo objetivo (rad)
    this._tiltAngle = 0;               // ángulo suavizado actual (rad)
    this._acc = 0;                     // acumulador de tiempo (ms)
    this._soften = false;              // modo "amasar" activo
    this._surfaceDirty = false;        // cuerpos nuevos pendientes de configurar
    this._mergeCb = null;
    this._impactCb = null;
    this._pendingPairs = new Map();    // dedupe de pares por tick (claves por ids)
    this._pendingImpacts = new Map();  // impacto más fuerte por fruta en el tick

    // Listeners registrados UNA sola vez (guardados para poder desligarlos)
    this._onCollisionStart = (ev) => this._collect(ev, true);
    this._onCollisionActive = (ev) => this._collect(ev, false);
    Events.on(this.engine, 'collisionStart', this._onCollisionStart);
    Events.on(this.engine, 'collisionActive', this._onCollisionActive);
  }

  // ----- Ciclo de vida de frutas -----

  // Paredes derivadas de la geometría actual (jarGeometry lee CONFIG)
  _buildWalls() {
    const P = CONFIG.physics;
    const g = jarGeometry();
    const head = 800; // margen superior para que la fruta caiga sin escaparse
    const wallOpts = {
      isStatic: true,
      label: 'wall',
      restitution: P.restitution,
      friction: P.friction,
      frictionStatic: P.frictionStatic,
    };
    const yTop = g.top - head;
    const yBot = g.bottom + g.wallT;
    const wallH = yBot - yTop;
    return [
      // Izquierda y derecha
      Bodies.rectangle(g.left - g.wallT / 2, (yTop + yBot) / 2, g.wallT, wallH, wallOpts),
      Bodies.rectangle(g.right + g.wallT / 2, (yTop + yBot) / 2, g.wallT, wallH, wallOpts),
      // Suelo (cubre la unión con ambas paredes)
      Bodies.rectangle(g.cx, g.bottom + g.wallT / 2, (g.right - g.left) + g.wallT * 2, g.wallT, wallOpts),
    ];
  }

  // Recolocar paredes cuando main.js redimensiona las bandas del mundo
  rebuildWalls() {
    for (const w of this.walls) Composite.remove(this.engine.world, w);
    this.walls = this._buildWalls();
    Composite.add(this.engine.world, this.walls);
    this.wakeAll();
  }

  addFruit(fruit) {
    if (!fruit || fruit.body) return null;
    const P = CONFIG.physics;
    const desliza = this._soften || Math.abs(this._tiltTarget) > 0.02;
    const body = Bodies.circle(fruit.x, fruit.y, fruit.radius, {
      label: 'fruit',
      restitution: this._soften ? P.restitution + 0.15 : P.restitution,
      friction: desliza ? 0.05 : P.friction,
      frictionStatic: desliza ? 0.07 : P.frictionStatic,
      frictionAir: P.frictionAir,
      density: P.density,
      slop: P.slop,
    });
    if (!body.plugin) body.plugin = {};
    body.plugin.fruit = fruit;
    fruit.body = body;
    this._fruits.add(fruit);
    this._surfaceDirty = true;
    Composite.add(this.engine.world, body);
    return body;
  }

  removeFruit(fruit) {
    if (!fruit || !fruit.body) return;
    Composite.remove(this.engine.world, fruit.body);
    this._fruits.delete(fruit);
    fruit.body = null;
  }

  // Elimina TODAS las frutas; las paredes permanecen.
  clear() {
    const world = this.engine.world;
    // Barrido por etiqueta: immune a frutas huérfanas o sin registrar
    for (const b of Composite.allBodies(world)) {
      if (b.label !== 'fruit') continue;
      const f = b.plugin && b.plugin.fruit;
      if (f) { f.body = null; this._fruits.delete(f); }
      Composite.remove(world, b);
    }
    for (const f of this._fruits) f.body = null;
    this._fruits.clear();
    this._pendingPairs.clear();
    this._pendingImpacts.clear();
    this._acc = 0;
    this._surfaceDirty = false;
  }

  // ----- Inclinación: gravedad orientada con suavizado -----

  setTiltTarget(angleRad) {
    const max = CONFIG.physics.tilt.maxAngle;
    const target = Number.isFinite(angleRad)
      ? Math.min(Math.max(angleRad, -max), max)
      : 0;
    if (target === this._tiltTarget && !this._surfaceDirty) return;
    this._tiltTarget = target;
    // al inclinar, la fricción baja: si no, la estática anula el deslizamiento
    this._applySurfaceFriction();
  }

  get tiltAngle() {
    return this._tiltAngle;
  }

  // ----- Amasar (olas de gelatina) -----

  setSoften(active) {
    const on = !!active;
    if (this._soften === on) return;
    this._soften = on;
    this._applySurfaceFriction();
  }

  // Fricción de superficie según estado: normal / inclinando / amasando.
  // Sin esto, la fricción estática (0.45) cancela un ángulo de 11-26°.
  _applySurfaceFriction() {
    const P = CONFIG.physics;
    const inclinando = Math.abs(this._tiltTarget) > 0.02;
    const friction = this._soften || inclinando ? 0.05 : P.friction;
    const restitution = this._soften ? P.restitution + 0.15 : P.restitution;
    for (const fruit of this._fruits) {
      const b = fruit.body;
      if (!b) continue;
      b.friction = friction;
      b.frictionStatic = friction * 1.4;
      b.restitution = restitution;
    }
    this._surfaceDirty = false;
    this.wakeAll();
  }

  // ----- Callbacks -----

  onMerge(cb) {
    this._mergeCb = typeof cb === 'function' ? cb : null;
  }

  onImpact(cb) {
    this._impactCb = typeof cb === 'function' ? cb : null;
  }

  wakeAll() {
    for (const fruit of this._fruits) {
      if (fruit.body) Sleeping.set(fruit.body, false);
    }
  }

  // ----- Paso de simulación (dtMs ya viene escalado por cámara lenta) -----

  step(dtMs) {
    const P = CONFIG.physics;
    const dt = Number.isFinite(dtMs) ? Math.min(Math.max(dtMs, 0), 100) : 0;

    // Suavizado del ángulo y gravedad rotada (módulo constante = gravityY)
    this._tiltAngle += (this._tiltTarget - this._tiltAngle) * P.tilt.ease;
    this.engine.gravity.x = Math.sin(this._tiltAngle) * P.gravityY;
    this.engine.gravity.y = Math.cos(this._tiltAngle) * P.gravityY;

    this._pendingPairs.clear();
    this._pendingImpacts.clear();

    // Acumulador con substeps fijos (acotado: sin espiral de la muerte)
    this._acc = Math.min(this._acc + dt, P.fixedDt * P.maxSubsteps);
    let steps = 0;
    while (this._acc >= P.fixedDt - 1e-9 && steps < P.maxSubsteps) {
      // Empuje lateral directo al inclinar: garantiza desplazamiento visible
      // aunque la fricción fruta-fruta frene parte del deslizamiento.
      if (Math.abs(this._tiltAngle) > 0.03) {
        const fx = Math.sin(this._tiltAngle) * 0.00065;
        for (const fruit of this._fruits) {
          const b = fruit.body;
          if (b) Body.applyForce(b, b.position, { x: fx * b.mass, y: 0 });
        }
      }
      Engine.update(this.engine, P.fixedDt);
      this._acc -= P.fixedDt;
      steps++;
    }

    // Notificar FUERA de Engine.update (sin reentrada en el motor)
    this._flushImpacts();
    this._flushMerges();
  }

  // ----- Teardown completo (sin fugas al reiniciar de raíz) -----

  destroy() {
    Events.off(this.engine, 'collisionStart', this._onCollisionStart);
    Events.off(this.engine, 'collisionActive', this._onCollisionActive);
    Composite.clear(this.engine.world, false); // también las paredes
    this._fruits.clear();
    this._pendingPairs.clear();
    this._pendingImpacts.clear();
    Engine.clear(this.engine);
  }

  // ----- Internos -----

  // Recolecta candidatos durante collisionStart/collisionActive
  _collect(ev, isStart) {
    const pairs = ev.pairs || [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const a = pair.bodyA;
      const b = pair.bodyB;

      if (isStart) this._registerImpact(pair, a, b);

      // Fusión: dos cuerpos etiquetados como fruta
      if (a.label === 'fruit' && b.label === 'fruit') {
        const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
        if (!this._pendingPairs.has(key)) this._pendingPairs.set(key, [a, b]);
      }
    }
  }

  // Impacto en collisionStart: velocidad relativa > umbral
  _registerImpact(pair, a, b) {
    if (!this._impactCb) return;
    const va = a.velocity || { x: 0, y: 0 };
    const vb = b.velocity || { x: 0, y: 0 };
    const dx = va.x - vb.x;
    const dy = va.y - vb.y;
    const speed = Math.sqrt(dx * dx + dy * dy);
    if (!(speed > IMPACT_SPEED)) return;

    // Normal de contacto (fallback: dirección entre centros)
    const col = pair.collision;
    let nx = 0;
    let ny = -1;
    if (col && col.normal && Number.isFinite(col.normal.x) && Number.isFinite(col.normal.y)) {
      nx = col.normal.x;
      ny = col.normal.y;
    } else {
      const px = (b.position ? b.position.x : 0) - (a.position ? a.position.x : 0);
      const py = (b.position ? b.position.y : 0) - (a.position ? a.position.y : 0);
      const len = Math.sqrt(px * px + py * py);
      if (len > 1e-6) { nx = px / len; ny = py / len; }
    }

    // Una sola entrada por fruta: gana el golpe más fuerte del tick
    const fruits = [];
    if (a.label === 'fruit' && a.plugin && a.plugin.fruit) fruits.push(a.plugin.fruit);
    if (b.label === 'fruit' && b.plugin && b.plugin.fruit) fruits.push(b.plugin.fruit);
    for (const f of fruits) {
      const prev = this._pendingImpacts.get(f);
      if (!prev || speed > prev.speed) {
        this._pendingImpacts.set(f, { fruit: f, speed, nx, ny });
      }
    }
  }

  _flushImpacts() {
    if (!this._impactCb || this._pendingImpacts.size === 0) return;
    for (const { fruit, speed, nx, ny } of this._pendingImpacts.values()) {
      if (!fruit.alive) continue;
      this._impactCb(fruit, speed, nx, ny);
    }
    this._pendingImpacts.clear();
  }

  _flushMerges() {
    if (!this._mergeCb || this._pendingPairs.size === 0) return;
    for (const [a, b] of this._pendingPairs.values()) {
      const fa = a.plugin && a.plugin.fruit;
      const fb = b.plugin && b.plugin.fruit;
      // Vivas y del mismo tier en el momento de la notificación
      if (fa && fb && fa.alive && fb.alive && fa.tier === fb.tier) {
        this._mergeCb(fa, fb);
      }
    }
    this._pendingPairs.clear();
  }
}
