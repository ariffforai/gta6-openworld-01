// Shared helpers for SOLMAR: a tiny seeded RNG, math helpers and a string hash.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
// Circle (x,z,r) against an axis-aligned box {minX,maxX,minZ,maxZ}: push the circle out.
export function collideCircleBox(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 0.000001) {
    const d = Math.sqrt(d2);
    return { x: (dx / d) * (r - d), z: (dz / d) * (r - d) };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const pl = x - b.minX + r, pr = b.maxX - x + r, pt = z - b.minZ + r, pb = b.maxZ - z + r;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return { x: -pl, z: 0 };
  if (m === pr) return { x: pr, z: 0 };
  if (m === pt) return { x: 0, z: -pt };
  return { x: 0, z: pb };
}
export function dist2(x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  return dx * dx + dz * dz;
}
