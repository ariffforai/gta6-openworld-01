// Vehicles for SOLMAR: build a car from boxes (body, cabin, wheels, lights),
// arcade driving physics, traffic that follows the road grid, and police cars
// that chase and ram the player.
import * as THREE from 'three';
import { clamp, lerp, angleDiff, mulberry32, dist2 } from './util.js';
import { BLOCK, GRID, CITY_R } from './city.js';

export const CAR_COLORS = [
  { name: 'Sunset Red', color: 0xc23b2e }, { name: 'Ocean Blue', color: 0x2e6fc2 },
  { name: 'Taxi Yellow', color: 0xf7c948 }, { name: 'Mint', color: 0x4fc2a1 },
  { name: 'Pearl White', color: 0xe8e4da }, { name: 'Midnight', color: 0x22242e },
  { name: 'Coral', color: 0xff7f50 }, { name: 'Grape', color: 0x7a4fb8 },
];
const POLICE_COLOR = 0x1a1d24;

export function makeCarMesh(colorHex, isPolice) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x14161c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.55; body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.58, 2.1), glassMat);
  cabin.position.set(0, 1.1, -0.25); cabin.castShadow = true;
  g.add(cabin);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.5), bodyMat);
  nose.position.set(0, 0.45, 2.3); g.add(nose);
  // Headlights / tail lights.
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
  for (const sx of [-0.65, 0.65]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), hl);
    h.position.set(sx, 0.62, 2.56); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), tl);
    t.position.set(sx, 0.62, -2.24); g.add(t);
  }
  if (isPolice) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.2, 4.42),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    stripe.position.y = 0.72; g.add(stripe);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    bar.position.set(0, 1.5, -0.25); g.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    bar2.position.set(0.62, 1.5, -0.25); g.add(bar2);
    const decal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    decal.position.set(-1.02, 0.62, 0); g.add(decal);
  }
  // Wheels.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.38, wz);
    g.add(w); wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}

export class Car {
  constructor(scene, x, z, heading, colorHex, isPolice) {
    this.scene = scene;
    this.isPolice = !!isPolice;
    this.mesh = makeCarMesh(colorHex, isPolice);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0;               // units per second, forward
    this.steer = 0;               // current steering angle
    this.maxSpeed = isPolice ? 34 : 28;
    this.accel = isPolice ? 16 : 13;
    this.alive = true;
    this.health = 100;
    this.target = null;           // traffic waypoint {x,z}
    this.wait = 0;
    this.stolen = false;
    this.colorName = '';
  }
  get pos() { return { x: this.x, z: this.z }; }
  // Arcade step: throttle -1..1, steerInput -1..1, handbrake bool.
  drive(throttle, steerInput, handbrake, dt, colliders) {
    const maxSpd = this.maxSpeed * (handbrake ? 0.55 : 1);
    if (throttle > 0) this.speed += this.accel * throttle * dt;
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= 22 * dt;          // brake
      else this.speed -= 8 * dt;                             // reverse
    }
    // Drag + rolling resistance.
    this.speed -= this.speed * (handbrake ? 1.6 : 0.35) * dt;
    this.speed = clamp(this.speed, -10, maxSpd);
    const steerTarget = steerInput * 0.55 * clamp(Math.abs(this.speed) / 8, 0, 1);
    this.steer = lerp(this.steer, steerTarget, 1 - Math.exp(-8 * dt));
    if (Math.abs(this.speed) > 0.05) {
      this.heading += (this.steer * this.speed * 0.055) * dt * (this.speed < 0 ? -1 : 1);
    }
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    // Building collision: slide along the wall, lose speed.
    let hit = false;
    for (const b of colliders) {
      if (nx > b.minX - 1.2 && nx < b.maxX + 1.2 && nz > b.minZ - 1.2 && nz < b.maxZ + 1.2) { hit = true; break; }
    }
    if (hit) {
      this.speed *= 0.4;
      // Try moving on x only, then z only, to slide.
      let okX = true, okZ = true;
      for (const b of colliders) {
        if (nx > b.minX - 1.2 && nx < b.maxX + 1.2 && this.z > b.minZ - 1.2 && this.z < b.maxZ + 1.2) okX = false;
        if (this.x > b.minX - 1.2 && this.x < b.maxX + 1.2 && nz > b.minZ - 1.2 && nz < b.maxZ + 1.2) okZ = false;
      }
      if (okX) this.x = nx;
      if (okZ) this.z = nz;
      return true;
    }
    this.x = nx; this.z = nz;
    return false;
  }
  syncMesh(dt) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Wheel spin + front steer visual.
    const wheels = this.mesh.userData.wheels;
    if (wheels) {
      for (let i = 0; i < wheels.length; i++) {
        wheels[i].rotation.x += this.speed * dt * 2.2;
        if (i < 2) wheels[i].rotation.y = this.steer * 0.8;
      }
    }
    // Body roll and pitch with speed.
    this.mesh.rotation.z = -this.steer * clamp(Math.abs(this.speed) / 30, 0, 1) * 0.06;
  }
}

export class Traffic {
  constructor(scene, city, rng) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.cars = [];
    this.parked = [];
  }
  randomRoadSpot() {
    const rng = this.rng;
    const vertical = rng() < 0.5;
    const road = (Math.floor(rng() * (GRID * 2 + 1)) - GRID) * BLOCK;
    const along = (rng() * 2 - 1) * (GRID * BLOCK + 10);
    const lane = (rng() < 0.5 ? -2.6 : 2.6);
    if (vertical) return { x: road + lane, z: along, heading: lane > 0 ? 0 : Math.PI };
    return { x: along, z: road + lane, heading: lane > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }
  spawnTraffic(n) {
    for (let i = 0; i < n; i++) {
      const s = this.randomRoadSpot();
      const c = CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)];
      const car = new Car(this.scene, s.x, s.z, s.heading, c.color, false);
      car.colorName = c.name;
      car.speed = 8 + this.rng() * 6;
      car.target = this.nextWaypoint(car);
      this.cars.push(car);
    }
  }
  spawnParked(n) {
    for (let i = 0; i < n; i++) {
      const s = this.randomRoadSpot();
      // Parked cars sit at the road edge, parallel to the street.
      const side = this.rng() < 0.5 ? -4.6 : 4.6;
      const vertical = Math.abs(Math.sin(s.heading)) < 0.5;
      const x = vertical ? s.x + (this.rng() < 0.5 ? side : -side) : s.x;
      const z = vertical ? s.z : s.z + (this.rng() < 0.5 ? side : -side);
      const c = CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)];
      const car = new Car(this.scene, x, z, s.heading, c.color, false);
      car.colorName = c.name;
      this.parked.push(car);
    }
  }
  nextWaypoint(car) {
    // Drive to the next intersection along the current heading, then turn.
    const rng = this.rng;
    const ahead = 60 + rng() * 90;
    const fx = car.x + Math.sin(car.heading) * ahead;
    const fz = car.z + Math.cos(car.heading) * ahead;
    const near = this.city.nearestRoadPoint(fx, fz);
    return { x: clamp(near.x, -CITY_R, CITY_R), z: clamp(near.z, -CITY_R, CITY_R) };
  }
  update(dt, playerCar, colliders, onCrash) {
    for (const car of this.cars) {
      if (!car.target) car.target = this.nextWaypoint(car);
      const dx = car.target.x - car.x, dz = car.target.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d < 6) {
        // At the waypoint: turn left, right or straight, then pick a new one.
        const turn = [0, Math.PI / 2, -Math.PI / 2][Math.floor(this.rng() * 3)];
        car.heading += turn;
        car.target = this.nextWaypoint(car);
      } else {
        const want = Math.atan2(dx, dz);
        const diff = angleDiff(car.heading, want);
        const steer = clamp(diff * 1.4, -1, 1);
        car.drive(0.55, steer, false, dt, colliders);
        car.speed = clamp(car.speed, 6, 13);
      }
      // Keep traffic off the player's car: gentle avoidance.
      if (playerCar) {
        const dd = dist2(car.x, car.z, playerCar.x, playerCar.z);
        if (dd < 36) {
          const push = Math.sqrt(dd) || 1;
          car.x += (car.x - playerCar.x) / push * dt * 6;
          car.z += (car.z - playerCar.z) / push * dt * 6;
        }
      }
      car.syncMesh(dt);
    }
    for (const car of this.parked) car.syncMesh(dt);
  }
  nearestParked(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const car of this.parked) {
      const d = dist2(x, z, car.x, car.z);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }
  removeParked(car) {
    const i = this.parked.indexOf(car);
    if (i >= 0) this.parked.splice(i, 1);
  }
}

export class Police {
  constructor(scene, city, rng) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.cars = [];
    this.flashT = 0;
  }
  desiredCount(wanted) { return Math.min(wanted * 2, 8); }
  spawnNear(x, z, heading) {
    const a = this.rng() * Math.PI * 2;
    const r = 55 + this.rng() * 30;
    const px = clamp(x + Math.cos(a) * r, -CITY_R, CITY_R);
    const pz = clamp(z + Math.sin(a) * r, -CITY_R, CITY_R);
    const spot = this.city.nearestRoadPoint(px, pz);
    const car = new Car(this.scene, spot.x, spot.z, heading, POLICE_COLOR, true);
    this.cars.push(car);
    return car;
  }
  update(dt, player, colliders, onRam) {
    // player: {x, z, speed, inCar, car}
    const px = player.x, pz = player.z;
    for (const car of this.cars) {
      const dx = px - car.x, dz = pz - car.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      const diff = angleDiff(car.heading, want);
      const steer = clamp(diff * 1.8, -1, 1);
      const throttle = d > 10 ? 1 : 0.7;
      const crashed = car.drive(throttle, steer, false, dt, colliders);
      if (crashed && d < 12 && onRam) onRam(0.2);
      if (d < 3.4) {
        // Ram: shove the player's car and slow the police car.
        if (player.car) {
          player.car.speed = Math.max(player.car.speed - 6, 2);
          const push = Math.atan2(player.car.x - car.x, player.car.z - car.z);
          player.car.x += Math.sin(push) * 0.8;
          player.car.z += Math.cos(push) * 0.8;
          if (onRam) onRam(1);
        }
        car.speed *= 0.5;
      }
      car.syncMesh(dt);
    }
    this.flashT += dt;
  }
  clear() {
    for (const car of this.cars) this.scene.remove(car.mesh);
    this.cars = [];
  }
  removeFar(px, pz, maxD) {
    this.cars = this.cars.filter((car) => {
      const d = dist2(car.x, car.z, px, pz);
      if (d > maxD * maxD) { this.scene.remove(car.mesh); return false; }
      return true;
    });
  }
}
