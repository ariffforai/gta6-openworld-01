// SOLMAR wanted system: 0-5 stars driven by heat. Crimes add heat; the
// heat decays once the player lies low and no cruiser is close. Police
// cruisers spawn on the roads, chase the player and ram them. At 3+ stars
// a cruiser that pins a stopped player busts them; a rammed-out player
// with no health left is wasted. Deterministic (seed 37); no Math.random.

import * as THREE from 'three';
import { mulberry32, clamp, angleLerp, collideCircle, dist2 } from './util.js';

const MAX_LEVEL = 5;
const HEAT_PER_LEVEL = 20;
const DECAY_DELAY = 6; // seconds of quiet before the heat starts falling
const DECAY_RATE = 5; // heat points per second while lying low
const CRUISER_HP = 3;
const BUST_LEVEL = 3;
const BUST_RANGE = 5.5;
const BUST_TIME = 2.5;
const RAM_RANGE = 3.4;
const RAM_DAMAGE = 10;
const RAM_COOLDOWN = 1.0;
const STEAL_HEAT = 12;

/** A Solmar PD cruiser: white body, black doors, flashing light bar. */
function buildCruiserMesh() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const black = new THREE.MeshLambertMaterial({ color: 0x14181d });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2530 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.2), white);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glass);
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  // Black doors on both flanks, the classic PD look.
  for (const x of [-1.01, 1.01]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 1.9), black);
    door.position.set(x, 0.62, 0.1);
    group.add(door);
  }
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.4), black);
  barBase.position.set(0, 1.36, -0.2);
  group.add(barBase);
  const redLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xff2a22 }),
  );
  redLight.position.set(-0.32, 1.48, -0.2);
  const blueLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.34),
    new THREE.MeshBasicMaterial({ color: 0x2266ff }),
  );
  blueLight.position.set(0.32, 1.48, -0.2);
  group.add(redLight, blueLight);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const wheel = new THREE.Mesh(wheelGeo, tyre);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }
  return { group, wheels, redLight, blueLight };
}

/**
 * Create the wanted system. `callbacks` gets `onBusted` and `onWasted`,
 * fired once when the player is caught or their health runs out.
 */
export function createWanted(scene, city, player, vehicles, callbacks) {
  const rng = mulberry32(37);
  const cruisers = [];

  const wanted = {
    heat: 0,
    level: 0,
    cruisers,
    bustTimer: 0,
    ramCooldown: 0,
    timeSinceCrime: 99,
    finished: false, // set once busted/wasted fires, so it fires once
    prevDriven: null,
    flashTime: 0,

    /** Add heat from a crime; the level follows from the heat. */
    addHeat(amount) {
      if (wanted.finished) return;
      wanted.heat = clamp(wanted.heat + amount, 0, 100);
      wanted.timeSinceCrime = 0;
      wanted.level = clamp(Math.floor(wanted.heat / HEAT_PER_LEVEL), 0, MAX_LEVEL);
    },

    /** A cruiser takes a bullet. Disabled cruisers stop and go dark. */
    damageCruiser(cruiser) {
      if (!cruiser || cruiser.disabled) return;
      cruiser.hp -= 1;
      wanted.addHeat(8);
      if (cruiser.hp <= 0) {
        cruiser.disabled = true;
        cruiser.redLight.visible = false;
        cruiser.blueLight.visible = false;
        cruiser.leaveTimer = 8;
      }
    },

    /** Put the heat back to zero and clear every cruiser. */
    reset() {
      wanted.heat = 0;
      wanted.level = 0;
      wanted.bustTimer = 0;
      wanted.ramCooldown = 0;
      wanted.timeSinceCrime = 99;
      wanted.finished = false;
      wanted.prevDriven = null;
      for (const cruiser of cruisers) scene.remove(cruiser.group);
      cruisers.length = 0;
    },

    /** Spawn one cruiser on a road near the player, behind the pursuit. */
    spawnCruiser() {
      const { group, wheels, redLight, blueLight } = buildCruiserMesh();
      // Nearest road line to the player, then a spot along it some way off.
      let bestLine = city.roadLines[0];
      let bestD = Infinity;
      for (const line of city.roadLines) {
        const d = Math.min(Math.abs(player.pos.x - line), Math.abs(player.pos.z - line));
        if (d < bestD) {
          bestD = d;
          bestLine = line;
        }
      }
      const alongRoad = rng() < 0.5;
      const dir = rng() < 0.5 ? -1 : 1;
      const gap = 55 + rng() * 20;
      let x;
      let z;
      if (alongRoad) {
        x = bestLine + (rng() < 0.5 ? -4.5 : 4.5);
        z = clamp(player.pos.z + dir * gap, city.bounds.minZ + 10, city.bounds.maxZ - 10);
      } else {
        z = bestLine + (rng() < 0.5 ? -4.5 : 4.5);
        x = clamp(player.pos.x + dir * gap, city.bounds.minX + 10, city.bounds.maxX - 10);
      }
      const yaw = Math.atan2(player.pos.x - x, player.pos.z - z);
      group.position.set(x, 0, z);
      group.rotation.y = yaw;
      scene.add(group);
      const cruiser = {
        group,
        wheels,
        redLight,
        blueLight,
        yaw,
        speed: 0,
        hp: CRUISER_HP,
        disabled: false,
        leaveTimer: 0,
      };
      group.traverse((child) => {
        if (child.isMesh) child.userData.cruiser = cruiser;
      });
      cruisers.push(cruiser);
      return cruiser;
    },

    /** Every cruiser mesh, for raycast hit tests. */
    meshes() {
      const out = [];
      for (const cruiser of cruisers) {
        cruiser.group.traverse((child) => {
          if (child.isMesh) out.push(child);
        });
      }
      return out;
    },

    /**
     * Chase, ram, bust and decay. Runs every tick while playing.
     * `playerSpeed` is the player's current speed (on foot or driving).
     */
    update(dt, playerSpeed) {
      if (wanted.finished) return;
      wanted.timeSinceCrime += dt;
      wanted.ramCooldown = Math.max(0, wanted.ramCooldown - dt);
      wanted.flashTime += dt;

      // Stealing a car is a crime — catch the moment the player gets in.
      if (vehicles.driven && !wanted.prevDriven) wanted.addHeat(STEAL_HEAT);
      wanted.prevDriven = vehicles.driven;

      // Lying low: heat falls once the coast has been clear for a while.
      let nearestCruiser = Infinity;
      for (const cruiser of cruisers) {
        const d = dist2(player.pos.x, player.pos.z,
          cruiser.group.position.x, cruiser.group.position.z);
        if (d < nearestCruiser) nearestCruiser = d;
      }
      if (wanted.timeSinceCrime > DECAY_DELAY && nearestCruiser > 45 && wanted.heat > 0) {
        wanted.heat = Math.max(0, wanted.heat - DECAY_RATE * dt);
        wanted.level = clamp(Math.floor(wanted.heat / HEAT_PER_LEVEL), 0, MAX_LEVEL);
      }

      // Keep the cruiser count matched to the wanted level.
      const target = wanted.level;
      while (cruisers.length < target) wanted.spawnCruiser();
      while (cruisers.length > target) {
        // Drop the cruiser furthest from the player first.
        let worst = 0;
        let worstD = -1;
        cruisers.forEach((cruiser, i) => {
          const d = dist2(player.pos.x, player.pos.z,
            cruiser.group.position.x, cruiser.group.position.z);
          if (d > worstD) {
            worstD = d;
            worst = i;
          }
        });
        const [gone] = cruisers.splice(worst, 1);
        scene.remove(gone.group);
      }

      // Flash the light bars: red and blue alternate twice a second.
      const redOn = Math.floor(wanted.flashTime * 4) % 2 === 0;
      for (const cruiser of cruisers) {
        if (cruiser.disabled) continue;
        cruiser.redLight.visible = redOn;
        cruiser.blueLight.visible = !redOn;
      }

      let busted = false;
      // Iterate a copy: a disabled cruiser removes itself mid-loop.
      for (const cruiser of [...cruisers]) {
        const cx = cruiser.group.position.x;
        const cz = cruiser.group.position.z;
        if (cruiser.disabled) {
          cruiser.leaveTimer -= dt;
          if (cruiser.leaveTimer <= 0) {
            scene.remove(cruiser.group);
            cruisers.splice(cruisers.indexOf(cruiser), 1);
          }
          continue;
        }

        // Chase: steer at the player and close in, faster at higher stars.
        const dx = player.pos.x - cx;
        const dz = player.pos.z - cz;
        const dist = Math.hypot(dx, dz);
        const desired = Math.atan2(dx, dz);
        cruiser.yaw = angleLerp(cruiser.yaw, desired, Math.min(1, dt * 2.2));
        const topSpeed = 11 + wanted.level * 1.4;
        cruiser.speed = Math.min(topSpeed, cruiser.speed + 9 * dt);
        const nx = cx + Math.sin(cruiser.yaw) * cruiser.speed * dt;
        const nz = cz + Math.cos(cruiser.yaw) * cruiser.speed * dt;
        const fixed = collideCircle(nx, nz, 1.7, city.colliders);
        cruiser.group.position.x = clamp(fixed.x, city.bounds.minX, city.bounds.maxX);
        cruiser.group.position.z = clamp(fixed.z, city.bounds.minZ, city.bounds.maxZ);
        cruiser.group.rotation.y = cruiser.yaw;
        for (const wheel of cruiser.wheels) {
          wheel.rotateY(-(cruiser.speed * dt) / 0.36);
        }

        // Ram: a cruiser that reaches the player shoves them hard.
        if (dist < RAM_RANGE && wanted.ramCooldown <= 0) {
          wanted.ramCooldown = RAM_COOLDOWN;
          if (player.onFoot) {
            player.health = Math.max(0, player.health - RAM_DAMAGE);
            const push = Math.max(dist, 0.5);
            player.pos.x += (dx / push) * -2.2;
            player.pos.z += (dz / push) * -2.2;
            player.pos.x = clamp(player.pos.x, city.bounds.minX, city.bounds.maxX);
            player.pos.z = clamp(player.pos.z, city.bounds.minZ, city.bounds.maxZ);
            player.group.position.copy(player.pos);
          } else if (vehicles.driven) {
            vehicles.driven.speed *= 0.55;
          }
          cruiser.speed *= 0.4;
        }

        // Bust: at 3+ stars, a cruiser sitting on a stopped player
        // for a couple of seconds ends the run.
        if (wanted.level >= BUST_LEVEL && playerSpeed < 1.5 && dist < BUST_RANGE) {
          wanted.bustTimer += dt;
          if (wanted.bustTimer >= BUST_TIME) busted = true;
        }
      }
      if (wanted.level < BUST_LEVEL || playerSpeed >= 1.5) wanted.bustTimer = 0;

      if (player.health <= 0) {
        wanted.finished = true;
        callbacks.onWasted?.();
        return;
      }
      if (busted) {
        wanted.finished = true;
        callbacks.onBusted?.();
      }
    },
  };

  return wanted;
}
