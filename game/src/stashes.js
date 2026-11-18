// SOLMAR cash stashes: a handful of hidden cash pickups tucked around the
// city — under a palm, behind a dumpster, at the end of an alley. Walking
// over one collects it: money goes up, a toast names the find and the
// chime plays. Stash positions and amounts come from a seeded RNG (seed
// 71), so every run hides the same eight stashes in the same places.
// Session-only: stashes are never written to the save file, and a new run
// (startGame) hides them all again.

import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { ROAD_LINES } from './city.js';

const STASH_SEED = 71;
const STASH_COUNT = 8;
const PICKUP_RADIUS = 2.2;
const HIDE_MIN = 78;

// Amounts, dealt out in seeded order so the big stashes land in
// different corners each time the seed changes.
const AMOUNTS = [100, 250, 50, 150, 100, 250, 75, 150];

function pickSpots() {
  const rng = mulberry32(STASH_SEED);
  const spots = [];
  const seen = new Set();
  let guard = 0;
  while (spots.length < STASH_COUNT && guard < 400) {
    guard += 1;
    const x = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)];
    const z = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)];
    // Keep the spawn plaza clear: the first stash should be a discovery,
    // not something the player trips over on the first step.
    if (Math.abs(x) < HIDE_MIN && Math.abs(z) < HIDE_MIN) continue;
    // Nudge off the road centre-line onto the pavement edge.
    const nx = x + (rng() < 0.5 ? -4.5 : 4.5);
    const nz = z + (rng() < 0.5 ? -4.5 : 4.5);
    const key = `${Math.round(nx)},${Math.round(nz)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spots.push({ x: nx, z: nz });
  }
  return spots;
}

export function createStashes(scene, deps) {
  const { world, player, toast, chime } = deps;
  const spots = pickSpots();
  const rng = mulberry32(STASH_SEED + 1);
  // Seeded shuffle of the amounts across the spots.
  const amounts = AMOUNTS.slice();
  for (let i = amounts.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = amounts[i];
    amounts[i] = amounts[j];
    amounts[j] = tmp;
  }

  const list = [];
  let time = 0;

  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i];
    const group = new THREE.Group();
    // A banded stack of bills: green block, gold strap around it.
    const stackMat = new THREE.MeshLambertMaterial({
      color: 0x1f8a4c,
      emissive: 0x0a3d1e,
    });
    const stack = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.26, 0.5),
      stackMat,
    );
    stack.position.y = 0.13;
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xffc233 });
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.09, 0.52),
      bandMat,
    );
    band.position.y = 0.13;
    // A flat gold disc underneath, so the stash reads at a glance
    // even from the far side of the street.
    const discMat = new THREE.MeshLambertMaterial({
      color: 0xffc233,
      emissive: 0x4a3500,
    });
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 0.04, 20),
      discMat,
    );
    disc.position.y = 0.02;
    group.add(stack);
    group.add(band);
    group.add(disc);
    group.position.set(spot.x, 0.3, spot.z);
    scene.add(group);
    list.push({
      group,
      x: spot.x,
      z: spot.z,
      amount: amounts[i],
      phase: rng() * Math.PI * 2,
      collected: false,
    });
  }

  const stashes = {
    list,
    collected: 0,
    get total() {
      return list.length;
    },
    get remaining() {
      return list.length - stashes.collected;
    },

    reset() {
      stashes.collected = 0;
      for (const stash of list) {
        stash.collected = false;
        stash.group.visible = true;
      }
    },

    update(dt) {
      time += dt;
      for (const stash of list) {
        if (stash.collected) continue;
        // Gentle bob and slow turn, phased per stash so they do not
        // all move in lockstep.
        stash.group.position.y = 0.3 + Math.sin(time * 2 + stash.phase) * 0.1;
        stash.group.rotation.y += dt * 0.6;
        if (!player.onFoot) continue;
        const dx = player.pos.x - stash.x;
        const dz = player.pos.z - stash.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        stash.collected = true;
        stash.group.visible = false;
        stashes.collected += 1;
        world.money += stash.amount;
        toast(`Found a hidden stash — +$${stash.amount}`);
        chime();
      }
    },
  };

  return stashes;
}
