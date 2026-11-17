// The wanted system for SOLMAR: five stars, heat that rises with crimes and
// cools when the player stays out of sight, police spawn counts per star, and
// the "busted" rule when a police car pins the player on foot.
import { clamp } from './util.js';

export const WANTED_LABELS = [
  'Clean', 'A patrol is looking for you', 'Police on your tail',
  'Half the force is after you', 'Roadblocks everywhere', 'The whole city wants you',
];

export class Wanted {
  constructor() {
    this.stars = 0;        // 0..5
    this.heat = 0;         // 0..100, drives star changes
    this.hiddenT = 0;      // seconds since a police car last saw the player
    this.bustT = 0;        // seconds pinned by police on foot
    this.lastCrimeT = -99;
  }
  addCrime(amount, now) {
    this.heat = clamp(this.heat + amount, 0, 100);
    this.lastCrimeT = now;
    const want = this.starsForHeat();
    if (want > this.stars) {
      this.stars = want;
      return true; // rose — play the sting
    }
    return false;
  }
  starsForHeat() {
    if (this.heat < 12) return 0;
    if (this.heat < 30) return 1;
    if (this.heat < 50) return 2;
    if (this.heat < 70) return 3;
    if (this.heat < 88) return 4;
    return 5;
  }
  // dt seconds pass; seenByPolice is whether any police car is near the player.
  update(dt, seenByPolice, onFoot) {
    if (this.stars > 0) {
      if (seenByPolice) {
        this.hiddenT = 0;
        this.bustT = onFoot ? this.bustT + dt : 0;
      } else {
        this.hiddenT += dt;
        this.bustT = 0;
        // Lay low: heat bleeds off after 6 seconds unseen, faster on foot.
        if (this.hiddenT > 6) this.heat = Math.max(0, this.heat - dt * (onFoot ? 4.5 : 2.2));
      }
      const want = this.starsForHeat();
      if (want < this.stars && this.hiddenT > 4) this.stars = want;
      if (this.stars === 0) this.bustT = 0;
    } else {
      this.bustT = 0;
    }
  }
  clear() {
    this.stars = 0; this.heat = 0; this.hiddenT = 0; this.bustT = 0;
  }
  get label() { return WANTED_LABELS[this.stars]; }
  get busted() { return this.bustT > 2.2; }
}
