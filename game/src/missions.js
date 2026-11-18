// SOLMAR missions: a three-job story for the crew — The Pickup, Hot Wheels
// and The Exchange. Jobs unlock in order; each one is a chain of steps
// marked by a glowing beacon in the world and on the minimap, and pays out
// on completion. Being wasted or busted fails the active job, which can
// then be started again from its marker. Deterministic: fixed beacons and
// payouts, no Math.random anywhere here.

import * as THREE from 'three';
import { dist2 } from './util.js';

const START_RADIUS = 4; // walk into a job marker to start it
const BEACON_RADIUS = 5.5; // reach a beacon to finish a step
const DELIVER_RADIUS = 6; // deliver the car inside this radius
const FREE_ROAM = 'Explore Solmar — find work, steal a car, stay free';

/** The story: three jobs, each with a start marker and a chain of steps. */
const MISSION_DEFS = [
  {
    id: 'pickup',
    title: 'The Pickup',
    payout: 500,
    start: { x: 20, z: 26 },
    startText: 'Meet Rico at the corner',
    steps: [
      { kind: 'reach', x: 234, z: 182, text: 'Pick up the package at the marina end' },
      { kind: 'reach', x: 20, z: 26, text: 'Bring the package back to Rico' },
    ],
  },
  {
    id: 'hotwheels',
    title: 'Hot Wheels',
    payout: 900,
    start: { x: -26, z: -26 },
    startText: 'Meet Dee at the dealership corner',
    steps: [
      { kind: 'steal', text: 'Steal the marked car at the showroom' },
      { kind: 'deliver', x: -182, z: 182, text: 'Drive the marked car to the chop shop' },
    ],
  },
  {
    id: 'exchange',
    title: 'The Exchange',
    payout: 1500,
    start: { x: 78, z: -130 },
    startText: 'Meet Sal at the north crossroads',
    steps: [
      { kind: 'reach', x: 130, z: -182, text: 'Grab the briefcase at the north docks' },
      { kind: 'reach', x: 234, z: 78, text: 'Deliver the briefcase to the exchange — the cops are coming' },
    ],
  },
];

/**
 * Create the mission system. `ctx` carries the world the jobs play in:
 * player, vehicles, wanted, the shared `world` state, and the HUD hooks
 * (`toast`, `setObjective`) plus `onComplete` (the save hook).
 */
export function createMissions(scene, city, ctx) {
  const { player, vehicles, wanted, world } = ctx;

  // One beacon column + ground ring per job, repositioned every tick to
  // whichever marker that job currently needs (its start marker, or the
  // active step's target). A beacon is only visible while its job is
  // available or active.
  const beaconMeshes = MISSION_DEFS.map((def, i) => {
    const group = new THREE.Group();
    const columnMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 26, 20, 1, true),
      columnMat,
    );
    column.position.y = 13;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.9, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(column, ring);
    group.visible = false;
    scene.add(group);
    return { def, group, columnMat, ringMat, phase: i * 2.1 };
  });

  const missions = {
    /** One entry per job: { def, status, step, targetCar }. */
    list: MISSION_DEFS.map((def, i) => ({
      def,
      status: i === 0 ? 'available' : 'locked',
      step: 0,
      targetCar: null,
    })),
    /** The job currently being played, or null. */
    active: null,

    /** The text the HUD objective line should show right now. */
    currentObjective() {
      if (missions.active) {
        const step = missions.active.def.steps[missions.active.step];
        return `${missions.active.def.title} — ${step.text}`;
      }
      const next = missions.list.find((entry) => entry.status === 'available');
      if (next) return `Work: ${next.def.title} — go to the yellow marker`;
      if (missions.list.every((entry) => entry.status === 'done')) {
        return 'All jobs done — Solmar is yours. Enjoy the money.';
      }
      return FREE_ROAM;
    },

    /** Markers for the minimap: start markers and the active step target. */
    beacons() {
      const out = [];
      for (const entry of missions.list) {
        if (entry.status === 'available') {
          out.push({ x: entry.def.start.x, z: entry.def.start.z, kind: 'start' });
        } else if (entry.status === 'active') {
          const step = entry.def.steps[entry.step];
          if (step.kind === 'steal' && entry.targetCar) {
            out.push({
              x: entry.targetCar.group.position.x,
              z: entry.targetCar.group.position.z,
              kind: 'step',
            });
          } else if (step.x !== undefined) {
            out.push({ x: step.x, z: step.z, kind: 'step' });
          }
        }
      }
      return out;
    },

    /** A one-line summary of every job, for playtests and the save file. */
    status() {
      const out = {};
      for (const entry of missions.list) {
        out[entry.def.id] = { status: entry.status, step: entry.step };
      }
      return out;
    },

    /** Save-ready form: just the done flags (availability is derived). */
    serialize() {
      return missions.status();
    },

    /** Restore done flags from a save; availability follows from them. */
    applySave(data) {
      if (!data) return;
      for (const entry of missions.list) {
        const saved = data[entry.def.id];
        entry.status = saved && saved.status === 'done' ? 'done' : 'locked';
        entry.step = 0;
        entry.targetCar = null;
      }
      // A job is available when the one before it is done (the first
      // job is always available unless it is done already).
      missions.list.forEach((entry, i) => {
        if (entry.status !== 'done') {
          entry.status = i === 0 || missions.list[i - 1].status === 'done'
            ? 'available'
            : 'locked';
        }
      });
      missions.active = null;
      ctx.setObjective?.(missions.currentObjective());
    },

    /** Start a job: pick its target car if the first step needs one. */
    startMission(entry) {
      entry.status = 'active';
      entry.step = 0;
      entry.targetCar = null;
      missions.active = entry;
      missions.pickTargetCar(entry);
      ctx.toast?.(`Mission: ${entry.def.title}`, 4);
      ctx.setObjective?.(missions.currentObjective());
    },

    /** The car to steal: the parked car nearest the job's start marker. */
    pickTargetCar(entry) {
      const step = entry.def.steps[entry.step];
      if (!step || step.kind !== 'steal') return;
      let best = null;
      let bestD = Infinity;
      for (const car of vehicles.cars) {
        if (!car.isParked || car === vehicles.driven) continue;
        const d = dist2(
          car.group.position.x, car.group.position.z,
          entry.def.start.x, entry.def.start.z,
        );
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      // Fallback: any car the player is not already driving.
      if (!best) {
        for (const car of vehicles.cars) {
          if (car === vehicles.driven) continue;
          const d = dist2(
            car.group.position.x, car.group.position.z,
            entry.def.start.x, entry.def.start.z,
          );
          if (d < bestD) {
            bestD = d;
            best = car;
          }
        }
      }
      entry.targetCar = best;
    },

    /** Move to the next step, or finish the job when the chain is done. */
    advanceStep(entry) {
      // Grabbing the briefcase tips off the police: one star of heat.
      if (entry.def.id === 'exchange' && entry.step === 0) {
        wanted.addHeat(25);
        ctx.toast?.('The cops are onto you — run!', 4);
      }
      entry.step += 1;
      if (entry.step >= entry.def.steps.length) {
        missions.complete(entry);
        return;
      }
      missions.pickTargetCar(entry);
      ctx.setObjective?.(missions.currentObjective());
    },

    /** Pay out, unlock the next job, and tell the save hook. */
    complete(entry) {
      entry.status = 'done';
      entry.step = entry.def.steps.length;
      entry.targetCar = null;
      missions.active = null;
      world.money += entry.def.payout;
      ctx.toast?.(`$${entry.def.payout} — ${entry.def.title} complete!`, 4);
      // Jobs unlock in order: the next job after this one becomes available.
      const next = missions.list[missions.list.indexOf(entry) + 1];
      if (next && next.status === 'locked') {
        next.status = 'available';
        ctx.toast?.(`New work: ${next.def.title}`, 4);
      }
      ctx.setObjective?.(missions.currentObjective());
      ctx.onComplete?.(entry);
    },

    /**
     * Called when a new run starts (including a retry after being wasted
     * or busted): a job in progress goes back to its marker so it can be
     * tried again; finished jobs stay finished.
     */
    reset() {
      if (missions.active) {
        const failed = missions.active;
        failed.status = 'available';
        failed.step = 0;
        failed.targetCar = null;
        missions.active = null;
        ctx.toast?.('Mission failed — the work is still there', 4);
      }
      ctx.setObjective?.(missions.currentObjective());
    },

    /** Where a job's beacon should stand right now, or null to hide it. */
    beaconPosition(entry) {
      if (entry.status === 'available') {
        return { x: entry.def.start.x, z: entry.def.start.z, active: false };
      }
      if (entry.status !== 'active') return null;
      const step = entry.def.steps[entry.step];
      if (step.kind === 'steal') {
        if (!entry.targetCar) return null;
        return {
          x: entry.targetCar.group.position.x,
          z: entry.targetCar.group.position.z,
          active: true,
        };
      }
      if (step.x === undefined) return null;
      return { x: step.x, z: step.z, active: true };
    },

    /**
     * Start jobs by walking into their markers, and check the active
     * job's current step. Runs every tick while playing.
     */
    update(dt) {
      // Place the beacons and pulse them: active steps pulse harder.
      for (let i = 0; i < missions.list.length; i++) {
        const entry = missions.list[i];
        const mesh = beaconMeshes[i];
        const at = missions.beaconPosition(entry);
        if (!at) {
          mesh.group.visible = false;
          continue;
        }
        mesh.group.visible = true;
        mesh.group.position.set(at.x, 0, at.z);
        const pulse = Math.sin(world.time * 3 + mesh.phase) * 0.5 + 0.5;
        mesh.columnMat.opacity = at.active ? 0.24 + pulse * 0.2 : 0.16 + pulse * 0.1;
        mesh.ringMat.opacity = at.active ? 0.45 + pulse * 0.3 : 0.35 + pulse * 0.15;
      }

      if (missions.active) {
        const entry = missions.active;
        const step = entry.def.steps[entry.step];
        if (step.kind === 'reach') {
          if (dist2(player.pos.x, player.pos.z, step.x, step.z) < BEACON_RADIUS) {
            missions.advanceStep(entry);
          }
        } else if (step.kind === 'steal') {
          if (vehicles.driven && vehicles.driven === entry.targetCar) {
            missions.advanceStep(entry);
          }
        } else if (step.kind === 'deliver') {
          if (
            vehicles.driven === entry.targetCar
            && dist2(player.pos.x, player.pos.z, step.x, step.z) < DELIVER_RADIUS
          ) {
            missions.advanceStep(entry);
          }
        }
        return;
      }

      // No job running: walking into an available job's marker starts it.
      for (const entry of missions.list) {
        if (entry.status !== 'available') continue;
        if (dist2(player.pos.x, player.pos.z, entry.def.start.x, entry.def.start.z) < START_RADIUS) {
          missions.startMission(entry);
          return;
        }
      }
    },
  };

  return missions;
}
