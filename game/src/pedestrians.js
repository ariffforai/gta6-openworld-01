// Pedestrians for SOLMAR: simple walkers who stroll the sidewalks, stop at
// corners, and flee from gunfire, speeding cars and the player.
import * as THREE from 'three';
import { clamp, mulberry32 } from './util.js';
import { BLOCK, GRID, CITY_R } from './city.js';

const SHIRTS = [0xe85d75, 0x4fb8ff, 0xffd23e, 0x7dff9a, 0xc77dff, 0xff9f43, 0xffffff, 0x2ec4b6];
const PANTS = [0x2b3a55, 0x3a3a3a, 0x6b4f2a, 0x8a2f3c, 0x223322];

export function makePedMesh(shirt, pants, skin) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.26), pantsMat);
  legs.position.y = 0.43; g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirtMat);
  torso.position.y = 1.16; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skinMat);
  head.position.y = 1.66; g.add(head);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.14), shirtMat);
  armL.position.set(-0.33, 1.15, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.33; g.add(armR);
  g.userData.armL = armL; g.userData.armR = armR;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Pedestrians {
  constructor(scene, city, rng) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.peds = [];
    this.scared = []; // {x,z,t} recent scares
  }
  randomSidewalkSpot() {
    const rng = this.rng;
    const bx = (Math.floor(rng() * (GRID * 2)) - GRID) * BLOCK + BLOCK / 2;
    const bz = (Math.floor(rng() * (GRID * 2)) - GRID) * BLOCK + BLOCK / 2;
    return { x: bx + (rng() * 2 - 1) * 15, z: bz + (rng() * 2 - 1) * 15 };
  }
  spawn(n) {
    for (let i = 0; i < n; i++) {
      const s = this.randomSidewalkSpot();
      const skin = [0xf2c9a0, 0xc98a5f, 0x8a5a3b, 0xe8b98a][Math.floor(this.rng() * 4)];
      const mesh = makePedMesh(
        SHIRTS[Math.floor(this.rng() * SHIRTS.length)],
        PANTS[Math.floor(this.rng() * PANTS.length)], skin);
      mesh.position.set(s.x, 0.25, s.z);
      this.scene.add(mesh);
      const target = this.randomSidewalkSpot();
      this.peds.push({
        mesh, x: s.x, z: s.z, heading: this.rng() * Math.PI * 2,
        tx: target.x, tz: target.z, speed: 1.2 + this.rng() * 1.1,
        walkPhase: this.rng() * 10, fleeing: 0, alive: true,
      });
    }
  }
  scare(x, z, radius) {
    this.scared.push({ x, z, radius, t: 3 });
    for (const p of this.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) p.fleeing = 2.5 + Math.random() * 2;
    }
  }
  update(dt, playerX, playerZ, playerSpeed) {
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (p.fleeing > 0) p.fleeing -= dt;
      // Flee from a fast car nearby.
      const pd = Math.hypot(p.x - playerX, p.z - playerZ);
      if (playerSpeed > 8 && pd < 9) p.fleeing = 2;
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      let speed = p.speed;
      if (p.fleeing > 0) {
        speed = 4.2;
        // Run away from the nearest scare point, else away from the player.
        let ax = p.x - playerX, az = p.z - playerZ;
        for (const s of this.scared) {
          const sd = Math.hypot(p.x - s.x, p.z - s.z);
          if (sd < s.radius) { ax = p.x - s.x; az = p.z - s.z; }
        }
        const al = Math.hypot(ax, az) || 1;
        p.heading = Math.atan2(ax / al, az / al);
      } else if (d < 2) {
        const t = this.randomSidewalkSpot();
        p.tx = t.x; p.tz = t.z;
      } else {
        const want = Math.atan2(dx, dz);
        let diff = want - p.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.heading += clamp(diff, -2.4 * dt, 2.4 * dt);
      }
      p.x += Math.sin(p.heading) * speed * dt;
      p.z += Math.cos(p.heading) * speed * dt;
      p.x = clamp(p.x, -CITY_R - 10, CITY_R + 40);
      p.z = clamp(p.z, -CITY_R - 10, CITY_R + 60);
      p.walkPhase += dt * speed * 4;
      p.mesh.position.set(p.x, 0.25 + Math.abs(Math.sin(p.walkPhase)) * 0.05, p.z);
      p.mesh.rotation.y = p.heading;
      const swing = Math.sin(p.walkPhase) * 0.5;
      p.mesh.userData.armL.rotation.x = swing;
      p.mesh.userData.armR.rotation.x = -swing;
    }
    for (const s of this.scared) s.t -= dt;
    this.scared = this.scared.filter((s) => s.t > 0);
  }
  // A pedestrian hit by a car or bullet falls and stays down.
  knockDown(x, z, radius) {
    let hit = null;
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - x, p.z - z) < radius) {
        p.alive = false;
        p.mesh.rotation.z = Math.PI / 2;
        p.mesh.position.y = 0.45;
        hit = p;
      }
    }
    return hit;
  }
  nearestAlive(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const p of this.peds) {
      if (!p.alive) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
