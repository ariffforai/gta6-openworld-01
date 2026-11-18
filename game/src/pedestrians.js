// SOLMAR pedestrians: 26 walkers who stroll the pavements of the city and
// run for cover when a gun goes off or a car bears down on them. A shot
// pedestrian goes down for a few seconds, then gets up and flees too.
// Placement and behaviour are deterministic (seed 27); no Math.random here.

import * as THREE from 'three';
import { mulberry32, pick, rand, clamp, angleLerp, dist2 } from './util.js';

const COUNT = 26;
const WALK_SPEED = 1.4;
const FLEE_SPEED = 6.2;
const FLEE_TIME = 3.5;
const DOWN_TIME = 2.5;
const PAVEMENT = 4.6; // offset from a road centreline, onto the sidewalk

const SHIRTS = [
  0xd94f3d, 0x3d7dd9, 0x4caf50, 0xe8a33d, 0x8e44ad,
  0xecf0f1, 0x2c3e50, 0xc2185b, 0x009688, 0xff7043,
];
const TROUSERS = [0x2c3e50, 0x5d4037, 0x37474f, 0x6d4c41, 0x455a64];
const SKINS = [0xc98d64, 0x8d5524, 0xe8b98a, 0x6b4423, 0xf1c27d];

/** One boxy low-poly walker, built from boxes like the player figure. */
function buildWalkerMesh(rng) {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: pick(rng, SKINS) });
  const shirt = new THREE.MeshLambertMaterial({ color: pick(rng, SHIRTS) });
  const pants = new THREE.MeshLambertMaterial({ color: pick(rng, TROUSERS) });

  const legGeo = new THREE.BoxGeometry(0.2, 0.74, 0.22);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.13, 0.37, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.13, 0.37, 0);
  legR.castShadow = true;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), shirt);
  torso.position.y = 1.05;
  torso.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.15, 0.56, 0.18);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.36, 1.08, 0);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.36, 1.08, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 9), skin);
  head.position.y = 1.52;
  head.castShadow = true;

  group.add(legL, legR, torso, armL, armR, head);
  return { group, legL, legR, armL, armR };
}

/** Create the 26 pedestrians. `city` supplies the road lines and bounds. */
export function createPedestrians(scene, city) {
  const rng = mulberry32(27);
  const list = [];

  for (let i = 0; i < COUNT; i++) {
    const { group, legL, legR, armL, armR } = buildWalkerMesh(rng);
    // Pick a road and a side, then a spot along it: half the walkers stroll
    // north-south roads, half east-west, always on the pavement edge.
    const line = pick(rng, city.roadLines);
    const side = rng() < 0.5 ? -PAVEMENT : PAVEMENT;
    const along = rand(rng, city.bounds.minZ + 12, city.bounds.maxZ - 12);
    const northSouth = rng() < 0.5;
    const x = northSouth ? line + side : along;
    const z = northSouth ? along : line + side;
    // Face along the road, either direction.
    const heading = northSouth
      ? (rng() < 0.5 ? 0 : Math.PI)
      : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    group.traverse((child) => {
      if (child.isMesh) child.userData.pedIndex = i;
    });
    scene.add(group);
    list.push({
      group,
      legL,
      legR,
      armL,
      armR,
      pos: new THREE.Vector3(x, 0, z),
      heading,
      northSouth,
      line,
      side,
      state: 'walk', // walk | flee | down
      stateTime: 0,
      fleeX: 0,
      fleeZ: 0,
      walkPhase: rand(rng, 0, Math.PI * 2),
      speed: rand(rng, 1.1, 1.7),
    });
  }

  const peds = {
    list,

    /** Every mesh of every pedestrian, for raycast hit tests. */
    meshes() {
      const out = [];
      for (const ped of list) {
        ped.group.traverse((child) => {
          if (child.isMesh) out.push(child);
        });
      }
      return out;
    },

    /** The nearest living pedestrian to (x, z) within `maxDist`, or null. */
    nearest(x, z, maxDist) {
      let best = null;
      let bestD = maxDist;
      for (const ped of list) {
        if (ped.state === 'down') continue;
        const d = dist2(x, z, ped.pos.x, ped.pos.z);
        if (d < bestD) {
          bestD = d;
          best = ped;
        }
      }
      return best;
    },

    /** Knock a pedestrian down: they fall, then get up and run. */
    knockDown(ped) {
      if (!ped || ped.state === 'down') return;
      ped.state = 'down';
      ped.stateTime = 0;
      ped.group.rotation.x = -Math.PI / 2;
      ped.group.position.y = 0.25;
    },

    /**
     * Scare every pedestrian near (x, z): they run away from the threat.
     * Called on gunfire and by cars that get too close.
     */
    scare(x, z, radius) {
      for (const ped of list) {
        if (ped.state === 'down') continue;
        const d = dist2(x, z, ped.pos.x, ped.pos.z);
        if (d > radius) continue;
        ped.state = 'flee';
        ped.stateTime = 0;
        // Flee direction: straight away from the threat, with a little
        // deterministic wobble so they do not all run in a perfect line.
        const away = Math.atan2(ped.pos.x - x, ped.pos.z - z);
        const wobble = (ped.pos.x * 0.37 + ped.pos.z * 0.11) % 0.6 - 0.3;
        ped.fleeX = Math.sin(away + wobble);
        ped.fleeZ = Math.cos(away + wobble);
        ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      }
    },

    /** Put every pedestrian back on their pavement, walking. */
    reset() {
      for (const ped of list) {
        ped.state = 'walk';
        ped.stateTime = 0;
        ped.group.rotation.x = 0;
        ped.group.position.y = 0;
        ped.group.position.copy(ped.pos);
        ped.group.rotation.y = ped.heading;
      }
    },

    /**
     * Walk the pavements, flee from danger, get up after being shot.
     * `playerPos` is used to scare peds away from a speeding car nearby.
     */
    update(dt, playerPos, playerSpeed) {
      for (const ped of list) {
        ped.stateTime += dt;
        if (ped.state === 'down') {
          if (ped.stateTime >= DOWN_TIME) {
            ped.state = 'flee';
            ped.stateTime = 0;
            ped.group.rotation.x = 0;
            ped.group.position.y = 0;
            // Run away from wherever the player is standing now.
            const away = Math.atan2(ped.pos.x - playerPos.x, ped.pos.z - playerPos.z);
            ped.fleeX = Math.sin(away);
            ped.fleeZ = Math.cos(away);
            ped.heading = away;
          }
          continue;
        }

        if (ped.state === 'flee') {
          ped.pos.x += ped.fleeX * FLEE_SPEED * dt;
          ped.pos.z += ped.fleeZ * FLEE_SPEED * dt;
          ped.walkPhase += dt * FLEE_SPEED * 2.2;
          if (ped.stateTime >= FLEE_TIME) {
            ped.state = 'walk';
            ped.stateTime = 0;
            // Resume strolling along the nearest road, on its pavement:
            // pick the axis (north-south or east-west) whose road line is
            // closest to where the flee ended up.
            let bestX = Infinity;
            let bestZ = Infinity;
            let lineX = city.roadLines[0];
            let lineZ = city.roadLines[0];
            for (const line of city.roadLines) {
              const dx = Math.abs(ped.pos.x - line);
              const dz = Math.abs(ped.pos.z - line);
              if (dx < bestX) {
                bestX = dx;
                lineX = line;
              }
              if (dz < bestZ) {
                bestZ = dz;
                lineZ = line;
              }
            }
            ped.northSouth = bestX <= bestZ;
            ped.line = ped.northSouth ? lineX : lineZ;
            ped.side = ped.northSouth
              ? (ped.pos.x >= ped.line ? PAVEMENT : -PAVEMENT)
              : (ped.pos.z >= ped.line ? PAVEMENT : -PAVEMENT);
            // Face back along the road so the stroll resumes down it.
            ped.heading = ped.northSouth
              ? (Math.cos(ped.heading) >= 0 ? 0 : Math.PI)
              : (Math.sin(ped.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2);
          }
        } else {
          // Stroll along the pavement: keep to the road line, turn around
          // at the city edge instead of walking into the sea.
          const speed = ped.speed;
          ped.pos.x += Math.sin(ped.heading) * speed * dt;
          ped.pos.z += Math.cos(ped.heading) * speed * dt;
          ped.walkPhase += dt * speed * 2.2;
          const limit = ped.northSouth ? city.bounds.maxZ - 8 : city.bounds.maxX - 8;
          const low = ped.northSouth ? city.bounds.minZ + 8 : city.bounds.minX + 8;
          const along = ped.northSouth ? ped.pos.z : ped.pos.x;
          if (along > limit || along < low) ped.heading += Math.PI;
          // Drift back onto the pavement line if a flee pushed them off.
          if (ped.northSouth) {
            ped.pos.x += (ped.line + ped.side - ped.pos.x) * Math.min(1, dt * 1.5);
          } else {
            ped.pos.z += (ped.line + ped.side - ped.pos.z) * Math.min(1, dt * 1.5);
          }
        }

        // A fast car (or the player sprinting through) close by is scary.
        if (playerSpeed > 6 && ped.state === 'walk') {
          const d = dist2(playerPos.x, playerPos.z, ped.pos.x, ped.pos.z);
          if (d < 7) peds.scare(playerPos.x, playerPos.z, 7);
        }

        ped.pos.x = clamp(ped.pos.x, city.bounds.minX, city.bounds.maxX);
        ped.pos.z = clamp(ped.pos.z, city.bounds.minZ, city.bounds.maxZ);
        ped.group.position.set(ped.pos.x, ped.pos.y, ped.pos.z);
        ped.group.rotation.y = ped.heading;

        // Walk-cycle swing; faster and wider while fleeing.
        const swing = Math.sin(ped.walkPhase) * (ped.state === 'flee' ? 0.85 : 0.45);
        ped.legL.rotation.x = swing;
        ped.legR.rotation.x = -swing;
        ped.armL.rotation.x = -swing * 0.7;
        ped.armR.rotation.x = swing * 0.7;
      }
    },
  };

  return peds;
}
