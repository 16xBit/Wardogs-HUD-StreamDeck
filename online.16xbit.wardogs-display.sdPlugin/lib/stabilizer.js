/**
 * Filters OCR noise. A new reading within `maxJump` of the current value is accepted.
 * A bigger jump is only accepted after `confirmReads` consecutive consistent readings,
 * so one-off misreads (e.g. 54 -> 254 -> 54) never reach the key.
 * With `hold`, the last accepted value is kept when nothing readable is found.
 */
export class Stabilizer {
  #s = { stable: null, cand: null, count: 0, misses: 0 };
  constructor({ maxJump = 80, confirmReads = 3, maxMisses = 5, hold = false } = {}) {
    Object.assign(this, { maxJump, confirmReads, maxMisses, hold });
  }
  update(r) {
    const s = this.#s;
    if (r === null) {
      s.misses = Math.min(s.misses + 1, 1000);
      // With hold, the last accepted value stays (e.g. HUD hidden by an inventory screen).
      if (s.misses >= this.maxMisses && !this.hold) Object.assign(s, { stable: null, cand: null, count: 0 });
      return s.stable;
    }
    s.misses = 0;
    if (s.stable !== null && Math.abs(r - s.stable) <= this.maxJump) {
      Object.assign(s, { stable: r, cand: null, count: 0 });
      return r;
    }
    if (s.cand !== null && Math.abs(r - s.cand) <= this.maxJump) {
      s.count++;
      s.cand = r;
    } else {
      s.cand = r;
      s.count = 1;
    }
    if (s.count >= this.confirmReads) Object.assign(s, { stable: r, cand: null, count: 0 });
    return s.stable;
  }
}
