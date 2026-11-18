// SOLMAR player: a third-person walker with sprint and jump, a camera that
// follows behind and lifts over roofs instead of clipping through them.
// Movement is relative to the camera, so W always walks away from the lens.

import * as THREE from 'three';
import { clamp, angleLerp, collideCircle } from './util.js';

const WALK_SPEED = 5;
const SPRINT_SPEED = 8.5;
const JUMP_SPEED = 8.5;
const GRAVITY = 22;
const EYE_HEIGHT = 1.6;
const CAM_DISTANCE = 7;
const CAM_HEIGHT = 1.6;
/** The spawn: the south edge of the east-west road through the centre,
// east of the plaza fountain, looking east down the street towards the
// marina and the sea. */
const SPAWN = { x: 14, z: 31, heading: Math.PI / 2 };

function limb(material, w, h, d, pivotY) {
  const pivot = new THREE.Group();
  pivot.position.y = pivotY;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

/** Build the player figure and its controller. `city` supplies colliders. */
export function createPlayer(scene, city) {
  const group = new THREE.Group();
  group.name = 'player';

  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2e4a6b });
  const trousers = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
  const shoes = new THREE.MeshLambertMaterial({ color: 0x2c2c2c });

  const legL = limb(trousers, 0.22, 0.78, 0.24, 0.82);
  legL.position.x = -0.14;
  const legR = limb(trousers, 0.22, 0.78, 0.24, 0.82);
  legR.position.x = 0.14;
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.36), shoes);
  shoeL.position.set(0, -0.78, 0.05);
  shoeL.castShadow = true;
  legL.add(shoeL);
  const shoeR = shoeL.clone();
  legR.add(shoeR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.66, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  const armL = limb(shirt, 0.17, 0.62, 0.2, 1.44);
  armL.position.x = -0.38;
  const armR = limb(shirt, 0.17, 0.62, 0.2, 1.44);
  armR.position.x = 0.38;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 10), skin);
  head.position.y = 1.66;
  head.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.1, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1c1c1c }),
  );
  cap.position.y = 1.84;

  group.add(legL, legR, torso, armL, armR, head, cap);
  scene.add(group);

  const raycaster = new THREE.Raycaster();
  const player = {
    group,
    pos: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),
    heading: SPAWN.heading,
    camYaw: SPAWN.heading,
    camPitch: 0.15,
    speed: 0,
    velY: 0,
    grounded: true,
    onFoot: true,
    walkPhase: 0,
    health: 100,

    /** Put the player back at the spawn plaza, on foot. */
    reset() {
      player.pos.set(SPAWN.x, 0, SPAWN.z);
      player.heading = SPAWN.heading;
      player.camYaw = SPAWN.heading;
      player.camPitch = 0.15;
      player.velY = 0;
      player.speed = 0;
      player.health = 100;
      player.onFoot = true;
      group.visible = true;
    },

    /**
     * Walk, sprint and jump; then place the third-person camera. `input` is
     * the shared input state and `camera` the render camera. Only runs while
     * the player is on foot; driving is the vehicles module's job.
     */
    update(dt, input, camera) {
      if (!player.onFoot) return;

      // Mouse look (pointer locked) and arrow-key turning as a fallback.
      const mouse = input.consumeMouse();
      player.camYaw -= mouse.dx * 0.0032;
      player.camPitch = clamp(player.camPitch + mouse.dy * 0.0026, 0.06, 1.05);
      if (input.isDown('ArrowLeft')) player.camYaw += dt * 2.4;
      if (input.isDown('ArrowRight')) player.camYaw -= dt * 2.4;

      const axis = input.moveAxis();
      const sprinting = input.isDownAny(['ShiftLeft', 'ShiftRight']);
      const targetSpeed = axis.y !== 0 || axis.x !== 0
        ? (sprinting ? SPRINT_SPEED : WALK_SPEED)
        : 0;
      player.speed = targetSpeed;

      if (targetSpeed > 0) {
        const forwardX = Math.sin(player.camYaw);
        const forwardZ = Math.cos(player.camYaw);
        const rightX = Math.cos(player.camYaw);
        const rightZ = -Math.sin(player.camYaw);
        let mx = forwardX * axis.y + rightX * axis.x;
        let mz = forwardZ * axis.y + rightZ * axis.x;
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
        const next = collideCircle(
          player.pos.x + mx * targetSpeed * dt,
          player.pos.z + mz * targetSpeed * dt,
          0.45,
          city.colliders,
        );
        player.pos.x = clamp(next.x, city.bounds.minX, city.bounds.maxX);
        player.pos.z = clamp(next.z, city.bounds.minZ, city.bounds.maxZ);
        player.heading = angleLerp(
          player.heading,
          Math.atan2(mx, mz),
          Math.min(1, dt * 12),
        );
        player.walkPhase += dt * targetSpeed * 1.6;
      }

      // Jump and gravity.
      if (player.grounded && input.wasPressed('Space')) {
        player.velY = JUMP_SPEED;
        player.grounded = false;
      }
      if (!player.grounded) {
        player.velY -= GRAVITY * dt;
        player.pos.y += player.velY * dt;
        if (player.pos.y <= 0) {
          player.pos.y = 0;
          player.velY = 0;
          player.grounded = true;
        }
      }

      // Animate the limbs from the walk cycle.
      const swing = player.speed > 0 ? Math.sin(player.walkPhase) * 0.6 : 0;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
      if (!player.grounded) {
        legL.rotation.x = 0.5;
        legR.rotation.x = -0.35;
      }

      group.position.copy(player.pos);
      group.rotation.y = player.heading;

      // Camera: behind the player, lifted over roofs instead of clipping.
      // `dir` points from the player towards where the camera sits
      // (behind the view direction, rising with the pitch), so the camera
      // sits at target + dir * distance and the raycast checks that same
      // line for a building in the way.
      const target = new THREE.Vector3(
        player.pos.x,
        player.pos.y + EYE_HEIGHT,
        player.pos.z,
      );
      const dir = new THREE.Vector3(
        -Math.sin(player.camYaw) * Math.cos(player.camPitch),
        Math.sin(player.camPitch),
        -Math.cos(player.camYaw) * Math.cos(player.camPitch),
      ).normalize();
      let distance = CAM_DISTANCE;
      raycaster.set(target, dir);
      raycaster.far = CAM_DISTANCE;
      const hits = raycaster.intersectObjects(city.buildingMeshes, false);
      if (hits.length > 0) distance = Math.max(2.2, hits[0].distance - 0.4);
      camera.position.copy(target).addScaledVector(dir, distance);
      camera.position.y += CAM_HEIGHT * (distance / CAM_DISTANCE);
      if (camera.position.y < 0.6) camera.position.y = 0.6;
      camera.lookAt(target);
    },
  };

  player.reset();
  return player;
}
