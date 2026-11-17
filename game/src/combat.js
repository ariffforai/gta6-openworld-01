// Combat for SOLMAR: the player's pistol, tracers and muzzle flash, enemy
// shooters for the marina shootout, and hit particles. Hits are raycasts
// against simple spheres so they stay cheap and reliable.
import * as THREE from 'three';
import { clamp } from './util.js';

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];   // {mesh, x, z, hp, shootT, alive}
    this.tracers = [];   // {line, t}
    this.particles = []; // {mesh, vx, vy, vz, t}
    this.fireCooldown = 0;
    this.muzzle = new THREE.PointLight(0xffc266, 0, 18, 1.8);
    this.scene.add(this.muzzle);
  }
  spawnEnemies(spots) {
    for (const s of spots) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3c2a4d });
      const skinMat = new THREE.MeshLambertMaterial({ color: 0xc98a5f });
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.85, 0.28),
        new THREE.MeshLambertMaterial({ color: 0x222222 }));
      legs.position.y = 0.43; g.add(legs);
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.32), bodyMat);
      torso.position.y = 1.16; g.add(torso);
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.34),
        new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
      vest.position.y = 1.2; g.add(vest);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skinMat);
      head.position.y = 1.66; g.add(head);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36),
        new THREE.MeshLambertMaterial({ color: 0x8a1f2a }));
      cap.position.y = 1.86; g.add(cap);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6),
        new THREE.MeshLambertMaterial({ color: 0x111111 }));
      gun.position.set(0.25, 1.25, 0.4); g.add(gun);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.position.set(s.x, 0.25, s.z);
      this.scene.add(g);
      this.enemies.push({ mesh: g, x: s.x, z: s.z, hp: 3, shootT: 1 + Math.random() * 2, alive: true });
    }
  }
  clearEnemies() {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies = [];
  }
  aliveCount() { return this.enemies.filter((e) => e.alive).length; }
  // Player fires from the camera: returns what was hit, if anything.
  // origin/direction in world space; targets: enemies, peds, police cars, traffic cars.
  playerShoot(origin, dir, targets) {
    if (this.fireCooldown > 0) return null;
    this.fireCooldown = 0.22;
    const end = origin.clone().addScaledVector(dir, 90);
    this.addTracer(origin, end, 0xffd23e);
    this.muzzle.position.copy(origin).addScaledVector(dir, 1.2);
    this.muzzle.intensity = 60;
    let best = null, bestD = 90;
    for (const t of targets) {
      if (!t.alive) continue;
      // Sphere test against the target's chest point.
      const cx = t.x, cy = t.y ?? 1.3, cz = t.z;
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const along = ox * dir.x + oy * dir.y + oz * dir.z;
      if (along < 0 || along > bestD) continue;
      const px = origin.x + dir.x * along, py = origin.y + dir.y * along, pz = origin.z + dir.z * along;
      const dd = Math.hypot(px - cx, py - cy, pz - cz);
      if (dd < (t.radius ?? 1.1)) { best = t; bestD = along; }
    }
    if (best) {
      this.burst(best.x, best.y ?? 1.3, best.z, 0xff5040);
      if (best.kind === 'enemy') {
        best.hp -= 1;
        if (best.hp <= 0) {
          best.alive = false;
          best.mesh.rotation.z = Math.PI / 2;
          best.mesh.position.y = 0.5;
        }
      }
    }
    return best;
  }
  addTracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0.09 });
  }
  burst(x, y, z, color) {
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vx: (Math.random() - 0.5) * 7, vy: Math.random() * 5 + 1, vz: (Math.random() - 0.5) * 7,
        t: 0.5,
      });
    }
  }
  // Enemy AI: face the player, shoot with poor aim on a timer.
  update(dt, playerPos, onEnemyShot) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 500);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = playerPos.x - e.x, dz = playerPos.z - e.z;
      const d = Math.hypot(dx, dz);
      e.mesh.rotation.y = Math.atan2(dx, dz);
      e.shootT -= dt;
      if (d < 55 && e.shootT <= 0) {
        e.shootT = 1.1 + Math.random() * 1.3;
        const from = new THREE.Vector3(e.x, 1.4, e.z);
        const spread = 0.09;
        const dir = new THREE.Vector3(
          dx / d + (Math.random() - 0.5) * spread,
          (1.4 - playerPos.y) / Math.max(d, 1) + (Math.random() - 0.5) * 0.05,
          dz / d + (Math.random() - 0.5) * spread).normalize();
        this.addTracer(from, from.clone().addScaledVector(dir, 40), 0xff8040);
        if (onEnemyShot) onEnemyShot(d);
      }
    }
    for (const t of this.tracers) {
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.09) * 0.9;
      if (t.t <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); }
    }
    this.tracers = this.tracers.filter((t) => t.t > 0);
    for (const p of this.particles) {
      p.t -= dt;
      p.vy -= 14 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.t <= 0 || p.mesh.position.y < 0.1) { this.scene.remove(p.mesh); }
    }
    this.particles = this.particles.filter((p) => p.t > 0 && p.mesh.position.y >= 0.1);
  }
}
