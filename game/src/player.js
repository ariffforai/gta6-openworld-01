// The player for SOLMAR: Jules Marek, on foot and behind the wheel. On foot
// he walks, sprints and jumps with a third-person camera; near a car, E steals
// it and he drives with arcade physics until E steps out again.
import * as THREE from 'three';
import { clamp, angleLerp, damp, collideCircleBox } from './util.js';
import { CITY_R } from './city.js';

export function makePlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0x2e4a6b });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1c1410 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.9, 0.3), jeans);
  legs.position.y = 0.45; g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.66, 0.34), jacket);
  torso.position.y = 1.23; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.34), skin);
  head.position.y = 1.75; g.add(head);
  const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.36), hair);
  hairM.position.y = 1.96; g.add(hairM);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), jacket);
  armL.position.set(-0.37, 1.25, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.37; g.add(armR);
  // Pistol in the right hand, visible when armed.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x14161c }));
  gun.position.set(0.37, 0.95, 0.28); gun.visible = false;
  g.add(gun);
  g.userData.armL = armL; g.userData.armR = armR; g.userData.gun = gun; g.userData.legs = legs;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.mesh = makePlayerMesh();
    scene.add(this.mesh);
    this.x = 0; this.z = 40; this.y = 0;
    this.heading = 0;         // facing direction
    this.camYaw = 0;          // camera orbit yaw
    this.camPitch = 0.32;
    this.camDist = 9;
    this.vy = 0;
    this.speed = 0;
    this.walkPhase = 0;
    this.health = 100;
    this.armor = 0;
    this.money = 0;
    this.inCar = false;
    this.car = null;
    this.armed = false;       // pistol out (on foot only)
    this.hurtT = 0;
  }
  get pos() { return { x: this.x, z: this.z, y: this.y + 1.4 }; }
  spawn(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading; this.camYaw = heading;
    this.y = 0; this.vy = 0;
    this.exitCar();
  }
  enterCar(car) {
    this.inCar = true;
    this.car = car;
    car.stolen = true;
    this.mesh.visible = false;
    this.camDist = 11;
    this.camYaw = car.heading;
    car.syncMesh(0);
  }
  exitCar() {
    if (!this.inCar || !this.car) { this.inCar = false; this.car = null; return; }
    // Step out on the driver's side.
    const side = this.car.heading + Math.PI / 2;
    this.x = this.car.x + Math.sin(side) * 2.2;
    this.z = this.car.z + Math.cos(side) * 2.2;
    this.heading = this.car.heading;
    this.camYaw = this.car.heading;
    this.car.speed = 0;
    this.car = null;
    this.inCar = false;
    this.mesh.visible = true;
    this.camDist = 9;
    this.y = 0; this.vy = 0;
  }
  damage(amount, now) {
    if (this.hurtT > 0) return false;
    this.hurtT = 0.5;
    let left = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, left * 0.6);
      this.armor -= absorbed; left -= absorbed;
    }
    this.health = Math.max(0, this.health - left);
    return true;
  }
  heal(amount) { this.health = clamp(this.health + amount, 0, 100); }
  update(dt, input, colliders) {
    this.hurtT = Math.max(0, this.hurtT - dt);
    const mouse = input.consumeMouse();
    this.camYaw -= mouse.dx * 0.0032;
    this.camPitch = clamp(this.camPitch + mouse.dy * 0.0024, 0.05, 1.1);
    if (this.inCar && this.car) {
      this.updateDriving(dt, input, colliders);
      return;
    }
    // On foot: WASD relative to the camera yaw.
    const fwd = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const mx = Math.sin(this.camYaw) * fwd + Math.cos(this.camYaw) * strafe;
    const mz = Math.cos(this.camYaw) * fwd - Math.sin(this.camYaw) * strafe;
    const len = Math.hypot(mx, mz);
    const targetSpeed = len > 0 ? (sprint ? 9 : 5.2) : 0;
    this.speed = damp(this.speed, targetSpeed, 10, dt);
    if (len > 0) {
      const nx = mx / len, nz = mz / len;
      this.heading = angleLerp(this.heading, Math.atan2(nx, nz), 1 - Math.exp(-12 * dt));
      let px = this.x + nx * this.speed * dt;
      let pz = this.z + nz * this.speed * dt;
      // Building collision, axis-separated so he slides along walls.
      let blockedX = false, blockedZ = false;
      for (const b of colliders) {
        const hitX = collideCircleBox(px, this.z, 0.6, b);
        const hitZ = collideCircleBox(this.x, pz, 0.6, b);
        if (hitX) blockedX = true;
        if (hitZ) blockedZ = true;
      }
      if (!blockedX) this.x = px;
      if (!blockedZ) this.z = pz;
      this.x = clamp(this.x, -CITY_R - 20, CITY_R + 60);
      this.z = clamp(this.z, -CITY_R - 20, CITY_R + 70);
      this.walkPhase += dt * this.speed * 2.2;
    }
    // Jump.
    if (input.hit('Space') && this.y <= 0.01) this.vy = 7.5;
    if (this.y > 0 || this.vy !== 0) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }
    // Aim with the right mouse button (held) or always show the pistol on foot
    // during the shootout; crosshair follows the armed flag in main.
    this.armed = input.mouseDown || input.down('KeyF');
    this.mesh.userData.gun.visible = this.armed;
    this.syncMesh(dt);
  }
  updateDriving(dt, input, colliders) {
    const throttle = input.axis('KeyS', 'KeyW');
    const steer = input.axis('KeyA', 'KeyD');
    const handbrake = input.down('Space');
    const crashed = this.car.drive(throttle, steer, handbrake, dt, colliders);
    if (crashed && Math.abs(this.car.speed) > 6) this.damage(4, 0);
    this.car.syncMesh(dt);
    this.x = this.car.x; this.z = this.car.z;
    this.heading = this.car.heading;
    // Chase camera follows the car's heading when driving forward.
    if (this.car.speed > 2) {
      this.camYaw = angleLerp(this.camYaw, this.car.heading, 1 - Math.exp(-2.2 * dt));
    }
    this.speed = Math.abs(this.car.speed);
  }
  syncMesh(dt) {
    this.mesh.position.set(this.x, this.y + 0.25, this.z);
    this.mesh.rotation.y = this.heading;
    const swing = Math.sin(this.walkPhase) * 0.55 * clamp(this.speed / 5, 0, 1);
    this.mesh.userData.armL.rotation.x = this.armed ? -1.2 : swing;
    this.mesh.userData.armR.rotation.x = this.armed ? -1.2 : -swing;
    this.mesh.userData.legs.rotation.x = swing * 0.7;
    // Hurt flash: tint the jacket red briefly.
    const flash = this.hurtT > 0.25;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.setHex(flash ? 0x661111 : 0x000000);
      }
    });
  }
  // Third-person camera: returns the desired camera position + look target.
  cameraTarget(out) {
    const cx = this.x - Math.sin(this.camYaw) * this.camDist * Math.cos(this.camPitch);
    const cz = this.z - Math.cos(this.camYaw) * this.camDist * Math.cos(this.camPitch);
    const cy = (this.inCar ? 2.2 : 1.8) + this.y + Math.sin(this.camPitch) * this.camDist;
    out.position.set(cx, cy, cz);
    out.lookAt.set(this.x, (this.inCar ? 1.6 : 1.5) + this.y, this.z);
    return out;
  }
}
