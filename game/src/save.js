// SOLMAR — save: localStorage persistence for money, health, armour and
// mission progress. Autosaves every 20 seconds of play and on the big
// moments (a job completed, wasted, busted). Loading happens once, on the
// first start of the page, and never restores health below 50 — a save
// written at death must not soft-lock the run.

const KEY = 'solmar-save-v1';
const AUTOSAVE_EVERY = 20;

export function createSave(deps) {
  const { world, player, missions } = deps;
  let applied = false;
  let timer = 0;

  function saveNow() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const data = {
        money: world.money,
        health: Math.round(player.health),
        armour: Math.round(player.armour || 0),
        done: { ...missions.done },
        savedAt: Date.now(),
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      // Storage full, blocked or unavailable: the game plays on without it.
      return false;
    }
  }

  function load() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.money !== 'number') return null;
      return data;
    } catch {
      return null;
    }
  }

  function applyOnStart() {
    if (applied) return false;
    applied = true;
    const data = load();
    if (!data) return false;
    world.money = data.money;
    // Clamp health into [50, 100]: a save written at death (health 0)
    // restores the player at half health instead of dead on arrival.
    const health = typeof data.health === 'number' ? data.health : 100;
    player.health = Math.min(100, Math.max(50, health));
    player.armour = typeof data.armour === 'number' ? data.armour : 0;
    if (data.done) missions.setDoneFlags(data.done);
    return true;
  }

  function update(dt) {
    // Only called while playing, so the timer counts play time, not menu time.
    timer += dt;
    if (timer >= AUTOSAVE_EVERY) {
      timer = 0;
      saveNow();
    }
  }

  return { saveNow, load, applyOnStart, update, key: KEY };
}
