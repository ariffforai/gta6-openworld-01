// SOLMAR combat: a pistol fired with the mouse (F works too), with a
// tracer, a muzzle flash, and hit detection against pedestrians, cars,
// police cruisers and the buildings. Shots are loud: every round adds
// heat, hitting a pedestrian adds more. 12-round magazine, R reloads.
// Deterministic spread comes from the shot counter, never Math.random.

import * as THREE from 'three';

const MAG_SIZE = 12;
const FIRE_INTERVAL = 0.22; // seconds between shots
const RELOAD_TIME = 1.4;
const RANGE = 150;
const SHOT_HEAT = 6;
const PED_HIT_HEAT = 15;
const CAR_HIT_HEAT = 4;
const TRACER_LIFE = 0.09;
const TRACER_COUNT = 6;

/**
 * Create the pistol. `ctx` carries the world the shots interact with:
 * player, vehicles, pedestrians, wanted, the canvas (for mouse clicks)
 * and `isPlaying` (true only while the game is actually running).
 */
export function createCombat(scene, city, ctx) {
  const { player, vehicles, pedestrians, wanted, canvas } = ctx;

  // The pistol rides in the player's right hand.
  const gun = new THREE.Group();
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.42), gunMat);
  barrel.position.set(0, 0, 0.16);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.1), gunMat);
  grip.position.set(0, -0.14, -0.02);
  gun.add(barrel, grip);
  gun.position.set(0.38, 1.18, 0.3);
  gun.visible = false;
  player.group.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, 0.42);
  gun.add(muzzle);

  // Muzzle flash: a brief point light plus a small additive quad.
  const flashLight = new THREE.PointLight(0xffc861, 0, 9, 1.8);
  scene.add(flashLight);
  const flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  scene.add(flashQuad);

  // A small pool of tracer lines, reused so shots never allocate.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }),
    );
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = RANGE;
  const buildingSet = new Set(city.buildingMeshes);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const muzzlePos = new THREE.Vector3();
  const endPoint = new THREE.Vector3();
  const screenCentre = new THREE.Vector2(0, 0);

  const combat = {
    ammo: MAG_SIZE,
    magSize: MAG_SIZE,
    reloading: false,
    reloadTimer: 0,
    cooldown: 0,
    triggerHeld: false,
    shotsFired: 0,
    tracerIndex: 0,
    flashTime: 0,

    /** The raycast targets for this shot, nearest first. */
    targets() {
      const out = [];
      for (const ped of pedestrians.list) {
        if (ped.state === 'down') continue;
        ped.group.traverse((child) => {
          if (child.isMesh) out.push(child);
        });
      }
      for (const car of vehicles.cars) {
        car.group.traverse((child) => {
          if (child.isMesh) out.push(child);
        });
      }
      for (const cruiser of wanted.cruisers) {
        cruiser.group.traverse((child) => {
          if (child.isMesh) out.push(child);
        });
      }
      for (const mesh of city.buildingMeshes) out.push(mesh);
      return out;
    },

    /** Fire one round from the muzzle, down the camera's line of sight. */
    fire(camera) {
      if (combat.reloading || combat.cooldown > 0) return;
      if (combat.ammo <= 0) {
        combat.startReload();
        return;
      }
      combat.ammo -= 1;
      combat.cooldown = FIRE_INTERVAL;
      combat.shotsFired += 1;
      ctx.onShot?.();
      wanted.addHeat(SHOT_HEAT);
      // The shot itself is loud: pedestrians near the shooter run.
      pedestrians.scare(player.pos.x, player.pos.z, 26);

      muzzle.getWorldPosition(muzzlePos);

      // Deterministic spread from the shot counter: a small fixed wobble
      // that never depends on the clock or Math.random.
      const wobbleX = Math.sin(combat.shotsFired * 12.9898) * 0.006
        + Math.cos(combat.shotsFired * 4.1414) * 0.004;
      const wobbleY = Math.cos(combat.shotsFired * 7.77) * 0.005;
      raycaster.setFromCamera(new THREE.Vector2(wobbleX, wobbleY), camera);

      const hits = raycaster.intersectObjects(combat.targets(), false);
      let hitPoint = null;
      if (hits.length > 0) {
        hitPoint = hits[0].point;
        const hit = hits[0].object;
        if (hit.userData.pedIndex !== undefined) {
          const ped = pedestrians.list[hit.userData.pedIndex];
          pedestrians.knockDown(ped);
          wanted.addHeat(PED_HIT_HEAT);
          pedestrians.scare(hitPoint.x, hitPoint.z, 26);
        } else if (hit.userData.cruiser) {
          wanted.damageCruiser(hit.userData.cruiser);
        } else if (!buildingSet.has(hit)) {
          // A traffic or parked car: a glancing hit still draws the law.
          wanted.addHeat(CAR_HIT_HEAT);
        }
        // Hitting a building wall just chips the concrete: no extra heat.
      }
      if (!hitPoint) {
        // No mesh in the way: the round ends where it meets the ground.
        const groundHit = raycaster.ray.intersectPlane(ground, endPoint);
        hitPoint = groundHit ? endPoint.clone() : null;
      }
      if (!hitPoint) {
        // Aimed at the sky: draw the tracer out to full range.
        hitPoint = raycaster.ray.at(RANGE, new THREE.Vector3());
      }

      // Tracer from the muzzle to the hit point, fading fast.
      const tracer = tracers[combat.tracerIndex];
      combat.tracerIndex = (combat.tracerIndex + 1) % TRACER_COUNT;
      const pos = tracer.line.geometry.attributes.position;
      pos.setXYZ(0, muzzlePos.x, muzzlePos.y, muzzlePos.z);
      pos.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z);
      pos.needsUpdate = true;
      tracer.line.material.opacity = 0.9;
      tracer.life = TRACER_LIFE;

      // Muzzle flash at the gun tip.
      flashLight.position.copy(muzzlePos);
      flashLight.intensity = 7;
      flashQuad.position.copy(muzzlePos);
      flashQuad.material.opacity = 0.95;
      combat.flashTime = 0.06;
    },

    /** Start a reload (R, or automatically on an empty magazine). */
    startReload() {
      if (combat.reloading || combat.ammo === MAG_SIZE) return;
      combat.reloading = true;
      combat.reloadTimer = RELOAD_TIME;
    },

    /** Back to a full magazine, tracers cleared. */
    reset() {
      combat.ammo = MAG_SIZE;
      combat.reloading = false;
      combat.reloadTimer = 0;
      combat.cooldown = 0;
      combat.triggerHeld = false;
      combat.flashTime = 0;
      for (const tracer of tracers) {
        tracer.life = 0;
        tracer.line.material.opacity = 0;
      }
      flashLight.intensity = 0;
      flashQuad.material.opacity = 0;
    },

    /**
     * Per-tick: reload timing, fire while the trigger is held, fade the
     * tracers and the flash. Only runs while the player is on foot.
     */
    update(dt, input, camera) {
      gun.visible = player.onFoot;
      combat.cooldown = Math.max(0, combat.cooldown - dt);

      if (combat.reloading) {
        combat.reloadTimer -= dt;
        if (combat.reloadTimer <= 0) {
          combat.reloading = false;
          combat.ammo = MAG_SIZE;
        }
      }

      const trigger = combat.triggerHeld || input.isDown('KeyF');
      if (trigger && player.onFoot && ctx.isPlaying()) {
        combat.fire(camera);
      }
      if (input.wasPressed('KeyR')) combat.startReload();

      // Fade the tracers and the flash out over their short lives.
      for (const tracer of tracers) {
        if (tracer.life <= 0) continue;
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.9;
      }
      if (combat.flashTime > 0) {
        combat.flashTime -= dt;
        const t = Math.max(0, combat.flashTime / 0.06);
        flashLight.intensity = 7 * t;
        flashQuad.material.opacity = 0.95 * t;
        flashQuad.lookAt(camera.position);
        if (combat.flashTime <= 0) {
          flashLight.intensity = 0;
          flashQuad.material.opacity = 0;
        }
      }
    },
  };

  // Mouse fire: hold the button to keep shooting. Clicks on the canvas
  // only — a click on a menu button must never fire the pistol.
  window.addEventListener('mousedown', (event) => {
    if (event.target === canvas) combat.triggerHeld = true;
  });
  window.addEventListener('mouseup', () => {
    combat.triggerHeld = false;
  });
  window.addEventListener('blur', () => {
    combat.triggerHeld = false;
  });

  return combat;
}
