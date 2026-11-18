// SOLMAR — missions: a three-job story that unlocks in order. Each job is a
// chain of steps (meet a contact, fetch something, bring it where it belongs).
// A glowing beacon column and a ground ring mark the current target, and
// every step change posts a toast and rewrites the objective line. Getting
// wasted or busted drops the active job back to its contact for a retry.

import * as THREE from 'three';

const ARRIVE_RADIUS = 4.5;

const JOBS = [
  {
    id: 'pickup',
    title: 'The Pickup',
    payout: 500,
    contact: 'Rico',
    color: 0xffc233,
    steps: [
      {
        kind: 'meet', x: 20, z: 26,
        objective: 'Meet Rico at the plaza',
        toast: 'New job: The Pickup — meet Rico at the plaza',
      },
      {
        kind: 'fetch', x: 234, z: 182,
        objective: 'Collect the package at the end of the marina pier',
        toast: 'Rico needs a package from the end of the marina pier',
      },
      {
        kind: 'deliver', x: 20, z: 26,
        objective: 'Bring the package back to Rico',
        toast: 'Package in hand — take it back to Rico',
      },
    ],
  },
  {
    id: 'wheels',
    title: 'Hot Wheels',
    payout: 900,
    contact: 'Dee',
    color: 0x39d353,
    steps: [
      {
        kind: 'meet', x: -26, z: -26,
        objective: 'Meet Dee near the north-west junction',
        toast: 'New job: Hot Wheels — meet Dee near the north-west junction',
      },
      {
        kind: 'steal', x: -26, z: -26,
        objective: 'Steal the marked parked car',
        toast: 'Dee wants a ride — steal the marked parked car',
      },
      {
        kind: 'deliver', x: -182, z: 182, needsCar: true,
        objective: 'Deliver the car to the chop shop',
        toast: 'Got the car — deliver it to the chop shop, south-west',
      },
    ],
  },
  {
    id: 'exchange',
    title: 'The Exchange',
    payout: 1500,
    contact: 'Sal',
    color: 0xc678ff,
    steps: [
      {
        kind: 'meet', x: 78, z: -130,
        objective: 'Meet Sal up north',
        toast: 'New job: The Exchange — meet Sal up north',
      },
      {
        kind: 'fetch', x: 130, z: -182, heat: 25,
        objective: 'Grab the briefcase at the north docks',
        toast: 'The briefcase is at the north docks — grab it quick',
      },
      {
        kind: 'deliver', x: 234, z: 78,
        objective: 'Deliver the briefcase to the exchange point',
        toast: 'Briefcase secured — deliver it to the exchange point',
      },
    ],
  },
];

export function createMissions(scene, deps) {
  const { world, player, vehicles, wanted } = deps;
  const toast = deps.toast || (() => {});
  const setObjective = deps.setObjective || (() => {});

  // The beacon: a tall glowing column plus a ring on the ground.
  const beaconGroup = new THREE.Group();
  const columnMat = new THREE.MeshBasicMaterial({
    color: 0xffc233, transparent: true, opacity: 0.26,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 30, 20, 1, true),
    columnMat,
  );
  column.position.y = 15;
  beaconGroup.add(column);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc233, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.7, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.18;
  beaconGroup.add(ring);
  beaconGroup.visible = false;
  scene.add(beaconGroup);

  const missions = {
    done: { pickup: false, wheels: false, exchange: false },
    jobIndex: -1,
    stepIndex: 0,
    targetCar: null,
    onComplete: null,
    _time: 0,
    _hintShown: false,

    activeJob() {
      return this.jobIndex >= 0 ? JOBS[this.jobIndex] : null;
    },

    currentStep() {
      const job = this.activeJob();
      if (!job || this.stepIndex >= job.steps.length) return null;
      return job.steps[this.stepIndex];
    },

    // The live beacon for the HUD minimap: one entry per active target.
    beacons() {
      const job = this.activeJob();
      const step = this.currentStep();
      if (!job || !step) return [];
      if (step.kind === 'steal' && this.targetCar) {
        const p = this.targetCar.group.position;
        return [{ x: p.x, z: p.z, color: job.color }];
      }
      return [{ x: step.x, z: step.z, color: job.color }];
    },

    reset() {
      this.targetCar = null;
      this.stepIndex = 0;
      this.jobIndex = JOBS.findIndex((job) => !this.done[job.id]);
      this._activateStep(false);
    },

    // Called by the save module on first start: restores done flags from
    // the last session and points the story at the first unfinished job.
    setDoneFlags(flags) {
      if (!flags) return;
      for (const job of JOBS) this.done[job.id] = !!flags[job.id];
      this.targetCar = null;
      this.stepIndex = 0;
      this.jobIndex = JOBS.findIndex((job) => !this.done[job.id]);
      this._activateStep(false);
    },

    // Wasted or busted: the active job falls back to its contact.
    fail() {
      const job = this.activeJob();
      if (!job || this.stepIndex === 0) return;
      this.stepIndex = 0;
      this.targetCar = null;
      this._activateStep(true);
    },

    _activateStep(failed) {
      const job = this.activeJob();
      const step = this.currentStep();
      this._hintShown = false;
      if (!job || !step) {
        beaconGroup.visible = false;
        return;
      }
      if (failed) {
        toast(`The job fell through — meet ${job.contact} to try again`);
      } else {
        toast(step.toast);
      }
      setObjective(`${job.title}: ${step.objective}`);
      columnMat.color.setHex(job.color);
      ringMat.color.setHex(job.color);
      if (step.kind === 'steal') {
        // Pick the nearest parked car to the marker right now; the beacon
        // follows that car from here on. The pick is kept for the rest of
        // the job, so the delivery step can check the player is still in
        // this same car.
        let best = null;
        let bestDist = Infinity;
        for (const car of vehicles.cars) {
          if (!car.isParked) continue;
          const dx = car.group.position.x - step.x;
          const dz = car.group.position.z - step.z;
          const d = dx * dx + dz * dz;
          if (d < bestDist) {
            bestDist = d;
            best = car;
          }
        }
        this.targetCar = best;
      }
      beaconGroup.visible = true;
    },

    _advance() {
      const job = this.activeJob();
      this.stepIndex += 1;
      if (this.stepIndex < job.steps.length) {
        this._activateStep(false);
        return;
      }
      // Job finished: pay out, mark done, open the next job.
      this.done[job.id] = true;
      world.money += job.payout;
      toast(`${job.title} complete — $${job.payout} paid`);
      const next = JOBS.findIndex((j) => !this.done[j.id]);
      this.jobIndex = next;
      this.stepIndex = 0;
      this.targetCar = null;
      if (next >= 0) {
        this._activateStep(false);
      } else {
        beaconGroup.visible = false;
        setObjective('All jobs done — Solmar is yours. Enjoy the city.');
      }
      if (typeof this.onComplete === 'function') this.onComplete(job);
    },

    _distanceTo(x, z) {
      const dx = player.pos.x - x;
      const dz = player.pos.z - z;
      return Math.sqrt(dx * dx + dz * dz);
    },

    update(dt) {
      this._time += dt;
      const job = this.activeJob();
      const step = this.currentStep();
      if (!job || !step) {
        beaconGroup.visible = false;
        return;
      }

      // Pulse the beacon so it reads from across the city.
      const pulse = 1 + 0.16 * Math.sin(this._time * 3.2);
      ring.scale.set(pulse, pulse, 1);
      columnMat.opacity = 0.2 + 0.08 * Math.sin(this._time * 3.2);

      if (step.kind === 'steal') {
        if (this.targetCar) {
          const p = this.targetCar.group.position;
          beaconGroup.position.set(p.x, 0, p.z);
          if (vehicles.driven === this.targetCar) this._advance();
        } else {
          // No parked car was found at activation: keep the beacon on the
          // marker so the player still has somewhere to look.
          beaconGroup.position.set(step.x, 0, step.z);
        }
        return;
      }

      beaconGroup.position.set(step.x, 0, step.z);
      const dist = this._distanceTo(step.x, step.z);
      if (dist >= ARRIVE_RADIUS) return;

      if (step.kind === 'deliver' && step.needsCar && vehicles.driven !== this.targetCar) {
        if (!this._hintShown) {
          this._hintShown = true;
          toast('You need the stolen car for this drop — go back and get it');
        }
        return;
      }
      if (step.heat) wanted.addHeat(step.heat);
      this._advance();
    },
  };

  missions.reset();
  return missions;
}
