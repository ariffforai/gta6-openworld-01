// SOLMAR screenshot staging: deterministic `?shot=` states (seed 7) that
// pose the player, the camera and the traffic for the four dossier
// screenshots — cover (street chase), chase (police pursuit), mission
// (pier shootout) and city (skyline). Each shot puts the world in a fixed
// staged pose and flips `window.__shotReady` once a few frames have
// rendered, so the screenshot tool can wait on the flag instead of a
// wall-clock guess. Nothing here touches the screenshot files themselves;
// regeneration is a separate step.

import * as THREE from 'three';

const CRUISE_SPEED = 16;
const READY_FRAMES = 4;
const CHASE_FALLBACK_FRAMES = 200;

// The marina pier beacon sits at the end of the pier; the player stands
// just short of it and looks south-east down the pier at the beacon.
const PIER_BEACON = { x: 234, z: 182 };
const MISSION_PLAYER = { x: 222, z: 168 };
// Four walkers staged on the pier road (x = 234) around the player.
const MISSION_PEDS = [
  { x: 229, z: 176, heading: 0 },
  { x: 229, z: 160, heading: Math.PI },
  { x: 229, z: 188, heading: 0 },
  { x: 239, z: 172, heading: Math.PI },
];
// The skyline shot looks down on Solmar Tower (centre plaza, 0, 0)
// from high over the south-east of the city.
const CITY_CAMERA = {
  pos: new THREE.Vector3(150, 175, 250),
  look: new THREE.Vector3(0, 45, 0),
};

const SHOTS = {
  // Driving south down a Downtown street toward the beach and the sea.
  cover: { kind: 'drive', wanted: 0 },
  // Same drive, but at 3 stars with cruisers closing in behind.
  chase: { kind: 'drive', wanted: 3 },
  // On foot at the marina pier, mission 1's package beacon lit.
  mission: { kind: 'pier' },
  // High aerial over the tower and the Downtown grid.
  city: { kind: 'aerial' },
};

export function createShots(deps) {
  const { world, player, vehicles, pedestrians, wanted, missions } = deps;

  const shots = {
    active: null,
    ready: false,
    frames: 0,
    // A fixed camera pose that overrides the follow camera while set.
    cameraPose: null,

    names() {
      return Object.keys(SHOTS);
    },

    has(name) {
      return Object.prototype.hasOwnProperty.call(SHOTS, name);
    },

    reset() {
      shots.active = null;
      shots.ready = false;
      shots.frames = 0;
      shots.cameraPose = null;
      window.__shotReady = false;
    },

    /** Pose the player somewhere the normal camera can see them. */
    _placePlayer(x, z, heading) {
      player.pos.set(x, 0, z);
      player.group.position.copy(player.pos);
      player.heading = heading;
      player.camYaw = heading;
      player.camPitch = 0.15;
      player.speed = 0;
      player.onFoot = true;
      player.group.visible = true;
      player.group.rotation.y = heading;
    },

    /** Put the player in a parked car and cruise it down a road. */
    _stageDrive() {
      const car = vehicles.cars.find((c) => c.isParked);
      if (!car) return false;
      // Snap the car onto the Downtown road line x = 26, facing south
      // (+Z, yaw 0) toward the beach, so the chase camera looks down a
      // long straight street at the sea. Start far enough south that the
      // beach and the sea are already in frame when the shot is taken.
      car.group.position.set(26, 0, 130);
      car.group.rotation.y = 0;
      car.yaw = 0;
      car.speed = 0;
      // Step the player up to the door and get in for real, so the
      // driven-car state (and the chase camera) is exactly as in play.
      // The door is 2 units away, inside the 3.6-unit enter range.
      shots._placePlayer(24, 130, Math.PI / 2);
      vehicles.enterCooldown = 0;
      vehicles.tryEnter(player);
      if (!vehicles.driven) return false;
      vehicles.driven.speed = CRUISE_SPEED;
      return true;
    },

    /** Stage the pier shootout: mission 1 at the package step. */
    _stagePier() {
      shots._placePlayer(
        MISSION_PLAYER.x,
        MISSION_PLAYER.z,
        Math.atan2(
          PIER_BEACON.x - MISSION_PLAYER.x,
          PIER_BEACON.z - MISSION_PLAYER.z,
        ),
      );
      // Jump the story to the package step so the beacon column and the
      // objective line match the shot; the job itself is untouched.
      missions.jobIndex = 0;
      missions.stepIndex = 1;
      missions._activateStep(false);
      // Walkers on the pier road, strolling past the player.
      for (let i = 0; i < MISSION_PEDS.length; i += 1) {
        const ped = pedestrians.list[i];
        if (!ped) break;
        const spot = MISSION_PEDS[i];
        ped.pos.set(spot.x, 0, spot.z);
        ped.group.position.copy(ped.pos);
        ped.heading = spot.heading;
        ped.group.rotation.y = spot.heading;
        ped.state = 'walk';
        ped.stateTime = 0;
        ped.line = 234;
        ped.side = -5;
        ped.northSouth = true;
      }
    },

    apply(name) {
      if (!shots.has(name)) return false;
      const spec = SHOTS[name];
      shots.reset();
      shots.active = name;
      world.state = 'playing';
      if (spec.kind === 'drive') {
        wanted.reset();
        shots._stageDrive();
        if (spec.wanted > 0) {
          // 3 stars: 60 heat, one cruiser per star, spawned on the
          // next wanted tick and chasing from the nearest road.
          wanted.addHeat(spec.wanted * 20);
        }
      } else if (spec.kind === 'pier') {
        wanted.reset();
        shots._stagePier();
      } else if (spec.kind === 'aerial') {
        wanted.reset();
        shots._placePlayer(14, 31, Math.PI / 2);
        shots.cameraPose = {
          pos: CITY_CAMERA.pos.clone(),
          look: CITY_CAMERA.look.clone(),
        };
      }
      return true;
    },

    /** Per-tick: hold the staged pose and flip the ready flag. */
    update(dt) {
      if (!shots.active) return;
      shots.frames += 1;
      const spec = SHOTS[shots.active];
      if (spec.kind === 'drive' && vehicles.driven) {
        // Keep the cruise speed up: without input the car coasts down.
        vehicles.driven.speed = CRUISE_SPEED;
      }
      if (shots.ready) return;
      let staged = shots.frames >= READY_FRAMES;
      if (shots.active === 'chase') {
        // Wait until at least one cruiser has actually spawned, unless
        // the fallback frame count is hit first.
        staged = staged
          && (wanted.cruisers.length > 0 || shots.frames >= CHASE_FALLBACK_FRAMES);
      }
      if (staged) {
        shots.ready = true;
        window.__shotReady = true;
      }
    },
  };

  return shots;
}
