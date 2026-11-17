// Save for SOLMAR: one localStorage slot holding money, health, position,
// mission progress and the story state. Autosaves after every job.
const KEY = 'solmar-save-v1';
export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch { return null; }
}
export function writeSave(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
export function saveLabel(s) {
  if (!s) return '';
  const done = (s.missions && s.missions.done ? s.missions.done.filter(Boolean).length : 0);
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
  return `Saved game: $${(s.money || 0).toLocaleString('en-US')} · ${done}/3 jobs done` + (when ? ` · ${when}` : '');
}
