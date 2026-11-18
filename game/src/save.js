// SOLMAR save: the run survives in localStorage — money, health, armour
// and which jobs are done. The game autosaves every 20 seconds of play
// and right after a job pays out; being wasted or busted saves too, so the
// money and the finished jobs are never lost. Loading happens once, on the
// first start of the page: a fresh retry inside the same session keeps the
// live world instead of rewinding it to the last save.

const SAVE_KEY = 'solmar-save-v1';
const AUTOSAVE_EVERY = 20; // seconds of play between autosaves

/** Create the save system. `ctx` carries world, player and missions. */
export function createSave(ctx) {
  const { world, player, missions } = ctx;

  const save = {
    /** The parsed save read at boot, or null when there is none. */
    data: null,
    /** True once the boot save has been applied to the live world. */
    applied: false,
    /** Seconds of play since the last autosave. */
    timer: 0,

    /** Read the save from localStorage (safe when storage is unavailable). */
    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        save.data = raw ? JSON.parse(raw) : null;
      } catch {
        save.data = null;
      }
      return save.data;
    },

    /** Write the live world to localStorage. Returns false on failure.
     * The in-memory copy is refreshed too, so it never goes stale. */
    saveNow() {
      const snapshot = {
        money: world.money,
        health: Math.round(player.health),
        armour: Math.round(player.armour || 0),
        missions: missions.serialize(),
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
        save.data = snapshot;
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Apply the boot save once, on the first start of the page. Money and
     * finished jobs come back as saved; health never comes back below 50,
     * so a save written at the moment of being wasted cannot soft-lock
     * the next run. Later starts in the same session are no-ops.
     */
    applyOnStart() {
      if (save.applied || !save.data) return false;
      const d = save.data;
      if (typeof d.money === 'number') world.money = d.money;
      if (typeof d.health === 'number') {
        player.health = Math.max(50, Math.min(100, d.health));
      }
      if (typeof d.armour === 'number') player.armour = d.armour;
      missions.applySave(d.missions);
      save.applied = true;
      return true;
    },

    /** Autosave while playing; the timer only runs in the playing state. */
    update(dt) {
      if (world.state !== 'playing') return;
      save.timer += dt;
      if (save.timer >= AUTOSAVE_EVERY) {
        save.timer = 0;
        save.saveNow();
      }
    },
  };

  save.load();
  return save;
}
