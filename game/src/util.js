// SOLMAR shared helpers: deterministic random numbers, small maths and
// circle-versus-box collision. Nothing here touches the network or the clock,
// so a world built from a fixed seed plays back the same every time.

/** A tiny deterministic PRNG (mulberry32). `seed` is any integer. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random float in [a, b). */
export function rand(rng, a, b) {
  return a + rng() * (b - a);
}

/** A random integer in [a, b]. */
export function randInt(rng, a, b) {
  return Math.floor(rand(rng, a, b + 1));
}

/** A random element of `arr`. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Clamp `v` into [a, b]. */
export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/** Linear interpolation between `a` and `b`. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smoothstep easing between 0 and 1. */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** True when point (x, z) lies inside box `b` (edges included). */
export function boxContains(b, x, z) {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

/** Shortest signed difference from angle `a` to angle `b`, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Interpolate angle `a` towards `b` along the shortest arc. */
export function angleLerp(a, b, t) {
  return a + angleDiff(a, b) * t;
}

/** Flat distance between two points on the ground plane. */
export function dist2(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

/**
 * Push a circle (centre x, z, radius r) out of one axis-aligned box
 * ({minX, maxX, minZ, maxZ}). Returns the corrected centre, or null when the
 * circle does not touch the box.
 */
export function pushOutCircle(x, z, r, box) {
  const cx = clamp(x, box.minX, box.maxX);
  const cz = clamp(z, box.minZ, box.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * r, z: cz + (dz / d) * r };
  }
  // The centre is inside the box: leave through the nearest face.
  const pl = x - box.minX;
  const pr = box.maxX - x;
  const pt = z - box.minZ;
  const pb = box.maxZ - z;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return { x: box.minX - r, z };
  if (m === pr) return { x: box.maxX + r, z };
  if (m === pt) return { x, z: box.minZ - r };
  return { x, z: box.maxZ + r };
}

/**
 * Push a circle out of every box it touches, in order. Returns the corrected
 * centre. Boxes are cheap AABBs, so a few passes are enough for corners.
 */
export function collideCircle(x, z, r, boxes) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 2; pass++) {
    for (const box of boxes) {
      const fixed = pushOutCircle(px, pz, r, box);
      if (fixed) {
        px = fixed.x;
        pz = fixed.z;
      }
    }
  }
  return { x: px, z: pz };
}
