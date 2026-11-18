// SOLMAR vehicles: arcade driving with a handbrake, 14 traffic cars that
// cruise rectangular loops around the blocks, and 9 parked cars. Any car
// can be stolen with E; E again (when nearly stopped) steps back out.
// Traffic cars keep to the roads; the driven car pushes against buildings.

import * as THREE from 'three';
import { mulberry32, pick, clamp, angleLerp, collideCircle } from './util.js';

const PALETTE = [
  0xc0392b, 0x2e86c1, 0xf1c40f, 0x7d3c98, 0x1abc9c,
  0xe67e22, 0xecf0f1, 0x2c3e50, 0x95a5a6, 0x8e44ad,
];
const TRAFFIC_SPEED = 7;
const MAX_SPEED = 26;
const MAX_REVERSE = 8;
const ENTER_RANGE = 3.6;

/** Rectangular traffic loops, each a ring of corners on road centrelines. */
const LOOPS = [
  [[-26, -26], [26, -26], [26, 26], [-26, 26]],
  [[78, -130], [130, -130], [130, -78], [78, -78]],
  [[-182, 78], [-130, 78], [-130, 130], [-182, 130]],
  [[-78, 130], [-26, 130], [-26, 182], [-78, 182]],
  [[130, -26], [182, -26], [182, 26], [130, 26]],
];
const LOOP_COUNTS = [3, 3, 3, 3, 2];

/** Where the 9 parked cars wait, on the edge of a road, facing along it. */
const PARKED_SPOTS = [
  [-22.5, -100, 0],
  [-22.5, 60, 0],
  [29.5, -60, 0],
  [29.5, 140, Math.PI],
  [-74.5, 20, Math.PI],
  [81.5, -140, 0],
  [-134.5, 100, Math.PI],
  [185.5, 40, 0],
  [133.5, 150, Math.PI],
];

/** Build one low-poly car mesh. Forward is +Z when yaw is 0. */
function buildCarMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2530 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.2), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glassMat);
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.3), tyreMat);
  bumper.position.set(0, 0.35, 2.1);
  group.add(bumper);

  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const x of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
    lamp.position.set(x, 0.62, 2.12);
    group.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
  for (const x of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), tailMat);
    lamp.position.set(x, 0.62, -2.12);
    group.add(lamp);
  }

  const wheels = [];
  const frontWheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  for (const [x, z, front] of [[-0.95, 1.35, true], [0.95, 1.35, true], [-0.95, -1.35, false], [0.95, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const wheel = new THREE.Mesh(wheelGeo, tyreMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    if (front) frontWheels.push(pivot);
  }
  return { group, wheels, frontWheels };
}

/** Create the traffic and the parked cars. `city` supplies colliders. */
export function createVehicles(scene, city) {
  const rng = mulberry32(77);
  const cars = [];

  const spawnCar = (x, z, yaw, color, isTraffic, waypoints) => {
    const { group, wheels, frontWheels } = buildCarMesh(color);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    scene.add(group);
    const car = {
      group,
      wheels,
      frontWheels,
      yaw,
      speed: 0,
      steer: 0,
      color,
      isTraffic,
      isParked: !isTraffic,
      waypoints: waypoints || null,
      wpIndex: 0,
    };
    cars.push(car);
    return car;
  };

  // Traffic: distribute the cars around their loops, all facing along them.
  LOOPS.forEach((loop, li) => {
    const count = LOOP_COUNTS[li];
    for (let i = 0; i < count; i++) {
      const seg = Math.floor((i / count) * 4);
      const t = (i / count) * 4 - seg;
      const a = loop[seg];
      const b = loop[(seg + 1) % 4];
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      const car = spawnCar(x, z, Math.atan2(b[0] - a[0], b[1] - a[1]), pick(rng, PALETTE), true, loop);
      car.wpIndex = (seg + 1) % 4;
      car.speed = TRAFFIC_SPEED;
    }
  });

  for (const [x, z, yaw] of PARKED_SPOTS) {
    spawnCar(x, z, yaw, pick(rng, PALETTE), false, null);
  }

  const camSmooth = new THREE.Vector3(0, 4, 56);

  const vehicles = {
    cars,
    /** The car the player is driving, or null. */
    driven: null,
    enterCooldown: 0,
    /** Fired with the impact speed (0-1) when the driven car hits a wall. */
    onCrash: null,

    /** The nearest car to `pos` within `ENTER_RANGE`, or null. */
    nearestCar(pos) {
      let best = null;
      let bestD = ENTER_RANGE;
      for (const car of cars) {
        if (car === vehicles.driven) continue;
        const d = Math.hypot(car.group.position.x - pos.x, car.group.position.z - pos.z);
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      return best;
    },

    /** Step into the nearest car, or out of the driven one. */
    tryEnter(player) {
      if (vehicles.enterCooldown > 0) return;
      if (vehicles.driven) {
        const car = vehicles.driven;
        if (Math.abs(car.speed) > 2) return; // only bail out near-stopped
        const right = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
        player.pos.copy(car.group.position).addScaledVector(right, 2.6);
        player.pos.y = 0;
        player.onFoot = true;
        player.group.visible = true;
        player.group.position.copy(player.pos);
        player.heading = car.yaw;
        player.camYaw = car.yaw;
        car.isParked = true;
        car.speed = 0;
        vehicles.driven = null;
        vehicles.enterCooldown = 0.4;
        return;
      }
      const car = vehicles.nearestCar(player.pos);
      if (!car) return;
      car.isTraffic = false;
      car.isParked = false;
      car.speed = 0;
      vehicles.driven = car;
      player.onFoot = false;
      player.group.visible = false;
      vehicles.enterCooldown = 0.4;
    },

    /**
     * Drive the traffic and the player's car. `camera` is only moved while
     * the player is driving; on foot the player module owns the camera.
     */
    update(dt, input, player, camera) {
      vehicles.enterCooldown = Math.max(0, vehicles.enterCooldown - dt);
      if (input.wasPressed('KeyE')) vehicles.tryEnter(player);

      for (const car of cars) {
        if (car === vehicles.driven) continue;
        if (car.isTraffic) {
          // Cruise the loop: steer towards the next corner, ease the speed.
          const wp = car.waypoints[car.wpIndex];
          const dx = wp[0] - car.group.position.x;
          const dz = wp[1] - car.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 5) {
            car.wpIndex = (car.wpIndex + 1) % car.waypoints.length;
            continue;
          }
          const desired = Math.atan2(dx, dz);
          car.yaw = angleLerp(car.yaw, desired, Math.min(1, dt * 2.5));
          car.speed = TRAFFIC_SPEED;
          car.group.position.x += Math.sin(car.yaw) * car.speed * dt;
          car.group.position.z += Math.cos(car.yaw) * car.speed * dt;
          car.group.rotation.y = car.yaw;
        }
        // Spin the wheels on every moving car. The wheel mesh is turned
        // 90 degrees so its local Y is the axle: rotateY spins it around
        // the axle, negative for forward roll.
        for (const wheel of car.wheels) wheel.rotateY(-(car.speed * dt) / 0.36);
      }

      const car = vehicles.driven;
      if (!car) return;
      player.pos.copy(car.group.position);

      // --- arcade driving --------------------------------------------------
      const forward = input.isDown('KeyW') || input.isDown('ArrowUp');
      const back = input.isDown('KeyS') || input.isDown('ArrowDown');
      const handbrake = input.isDown('Space');
      const steerInput = (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0)
        - (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
      car.steer = angleLerp(car.steer, steerInput, Math.min(1, dt * 8));

      if (forward) car.speed += 16 * dt;
      if (back) car.speed += car.speed > 0.5 ? -26 * dt : -10 * dt;
      if (!forward && !back) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);
      if (handbrake) {
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 30 * dt);
      }
      car.speed = clamp(car.speed, -MAX_REVERSE, MAX_SPEED);

      const grip = handbrake ? 1.7 : 1;
      const turnRate = 1.9 * grip * clamp(Math.abs(car.speed) / 8, 0, 1);
      car.yaw += car.steer * turnRate * dt * Math.sign(car.speed || 1);
      car.group.rotation.y = car.yaw;

      const nx = car.group.position.x + Math.sin(car.yaw) * car.speed * dt;
      const nz = car.group.position.z + Math.cos(car.yaw) * car.speed * dt;
      const fixed = collideCircle(nx, nz, 1.7, city.colliders);
      if (fixed.x !== nx || fixed.z !== nz) {
        // A hard wall hit bounces the car back and thuds.
        const impact = Math.abs(car.speed);
        car.speed *= -0.3;
        if (impact > 10) vehicles.onCrash?.(impact / 26);
      }
      car.group.position.x = clamp(fixed.x, city.bounds.minX, city.bounds.maxX);
      car.group.position.z = clamp(fixed.z, city.bounds.minZ, city.bounds.maxZ);

      for (const wheel of car.wheels) wheel.rotateY(-(car.speed * dt) / 0.36);
      for (const pivot of car.frontWheels) pivot.rotation.y = car.steer * 0.38;

      // --- chase camera ------------------------------------------------------
      const target = new THREE.Vector3(
        car.group.position.x,
        car.group.position.y + 2,
        car.group.position.z,
      );
      const behind = new THREE.Vector3(
        -Math.sin(car.yaw),
        0,
        -Math.cos(car.yaw),
      );
      const desired = target.clone().addScaledVector(behind, 9.5);
      desired.y = target.y + 3.6;
      camSmooth.lerp(desired, Math.min(1, dt * 5));
      camera.position.copy(camSmooth);
      if (camera.position.y < 0.8) camera.position.y = 0.8;
      camera.lookAt(target);
    },
  };

  return vehicles;
}
