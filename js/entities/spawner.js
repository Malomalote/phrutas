// ============================================================
//  Spawner · tira la siguiente fruta (uniforme 0..maxTier-1)
//  con anti-racha: nunca 3 tiradas iguales seguidas (1 re-tiro).
// ============================================================

import { CONFIG } from '../config.js?v=15';

export class Spawner {
  constructor() {
    this._h1 = -1; // última tirada
    this._h2 = -1; // penúltima tirada
    this._current = this.roll();
    this._next = this.roll();
  }

  get current() {
    return this._current;
  }

  get next() {
    return this._next;
  }

  // La actual pasa a ser "current" y se tira una nueva "next"
  advance() {
    this._current = this._next;
    this._next = this.roll();
  }

  // Entero uniforme 0..CONFIG.spawn.maxTier-1
  roll() {
    const max = Math.max(1, CONFIG.spawn.maxTier | 0);
    let t = Math.floor(Math.random() * max);
    // Anti-racha: si saldría la 3ª repetición seguida, re-tira UNA vez
    if (t === this._h1 && t === this._h2) {
      t = Math.floor(Math.random() * max);
    }
    this._h2 = this._h1;
    this._h1 = t;
    return t;
  }
}
