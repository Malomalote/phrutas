// ============================================================
//  Fruta · estado lógico y muelles de squash & wobble
//  El body de Matter vive en fruit.body (lo gestiona PhysicsEngine);
//  aquí solo se integra el "cuerpo blando" visual (60 fps+ estable).
// ============================================================

import { CONFIG, escalaFrutas } from '../config.js?v=14';

const K = 180;            // rigidez del muelle (1/s^2)
const DAMP = 12;          // amortiguación (1/s)  => subamortiguado, rebota
const SUB_DT = 1 / 120;   // subpaso fijo de integración (s) => independiente del frame rate
const WOBBLE_MAX = 0.26;  // límite del desplazamiento del muelle
const WOBBLE_V_MAX = 5;   // límite de la velocidad del muelle
const STRETCH_MAX = 0.15; // estiramiento máximo por velocidad
const RATIO_MAX = Math.sqrt(1.12); // techo de deformación visual sy/sx = 1.12:1
const ANGLE_MAX = 0.16;   // bamboleo rotacional máximo (rad)

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export class Fruit {
  constructor(tier, x, y) {
    const def = CONFIG.fruits[tier];
    this.tier = tier;
    // radio escalado por el nivel de dificultad de la partida en curso
    this.radius = Math.max(9, Math.round((def ? def.radius : CONFIG.fruits[0].radius) * escalaFrutas));
    this.x = Number.isFinite(x) ? x : CONFIG.world.width / 2;
    this.y = Number.isFinite(y) ? y : 0;
    this.alive = true;
    this.body = null;          // lo inyecta PhysicsEngine.addFruit
    this.golden = false;
    this.birth = performance.now(); // el renderer lo usa para el pop-in
    this.landed = false;

    // Muelle de wobble (escala 1 = reposo)
    this._w = 0;
    this._wv = 0;
    // Velocidad lineal suavizada (para estirar por velocidad)
    this._vx = 0;
    this._vy = 0;
    // Salidas cacheadas para el render
    this._sx = 1;
    this._sy = 1;
    this._angle = 0;
  }

  // Excita el muelle proporcionalmente al impacto (con clamp anti-explosión).
  // nx, ny: normal de contacto (solo se usa |ny|: los golpes verticales mandan).
  impact(strength, nx, ny) {
    const s = Number.isFinite(strength) ? clamp(strength, 0, 10) : 0;
    const vertical = Number.isFinite(ny) ? Math.min(Math.abs(ny), 1) : 0;
    const gain = 0.45 + 0.25 * vertical;
    this._wv = clamp(this._wv + s * gain, -WOBBLE_V_MAX, WOBBLE_V_MAX);
    this.landed = true;
  }

  // dtMs en milisegundos reales (ya escalados por cámara lenta si aplica).
  update(dtMs) {
    const dt = Number.isFinite(dtMs) ? clamp(dtMs, 0, 50) / 1000 : 0;

    // 1) Muelle amortiguado hacia 1 (Euler semi-implícito con subpasos fijos)
    let acc = dt;
    while (acc > 1e-6) {
      const h = Math.min(SUB_DT, acc);
      acc -= h;
      const a = -K * this._w - DAMP * this._wv;
      this._wv = clamp(this._wv + a * h, -WOBBLE_V_MAX, WOBBLE_V_MAX);
      this._w = clamp(this._w + this._wv * h, -WOBBLE_MAX, WOBBLE_MAX);
    }

    // 2) Velocidad de referencia (body) con suavizado exponencial
    const body = this.body;
    if (body && body.velocity && Number.isFinite(body.velocity.x)) {
      const t = 1 - Math.exp(-12 * dt); // framerate-independiente
      this._vx += (body.velocity.x - this._vx) * t;
      this._vy += (body.velocity.y - this._vy) * t;
      // Sincroniza la posición lógica con la física
      if (Number.isFinite(body.position.x) && Number.isFinite(body.position.y)) {
        this.x = body.position.x;
        this.y = body.position.y;
      }
    }

    // 3) Escalas: wobble con volumen ~constante y ratio limitado.
    // Techo 1.12:1 (sy·sx): la gelatina tiembla sin parecer otra fruta.
    const speed = Math.sqrt(this._vx * this._vx + this._vy * this._vy);
    const stretch = Math.min(speed * 0.006, STRETCH_MAX);
    const sy2 = clamp(1 + this._w + stretch, 1 / RATIO_MAX, RATIO_MAX);
    this._sy = sy2;
    this._sx = 1 / sy2;
    // Bamboleo rotacional pequeño: deriva lateral + gelatina
    this._angle = clamp(this._vx * 0.0035 + this._w * 0.18, -ANGLE_MAX, ANGLE_MAX);
  }

  // ----- Getters usados por el renderer -----

  get sx() { return this._sx; }
  get sy() { return this._sy; }
  get wobbleAngle() { return this._angle; }
  get drawRadius() { return this.radius; }
  get vx() { return this.body && this.body.velocity ? this.body.velocity.x : this._vx; }
  get vy() { return this.body && this.body.velocity ? this.body.velocity.y : this._vy; }

  kill() {
    this.alive = false;
  }
}
