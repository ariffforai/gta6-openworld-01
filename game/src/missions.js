// Missions for SOLMAR: a four-job story arc for Jules Marek, each mission a
// small state machine of stages with a beacon, a map marker and a payout.
// The story is original: Nadia Voss, the fixer; the Vultures, the rival crew;
// the Coral Beach safehouse and the marina yacht. Free roam continues after
// the last job. A timed stage counts down in game time: run out of time and
// the job fails, but the story waits — press T to try it again.
import * as THREE from 'three';
import { clamp } from './util.js';

// The mission-2 target coupe parks on the marina road (z = 156) at the
// road's edge, x = 120 — on open road, never inside a block, so Jules can
// always walk up to it and steal it. main.js places the car here too.
export const COUPE_SPOT = { x: 120, z: 160.6, heading: Math.PI / 2 };

export const MISSION_DEFS = [
  {
    id: 0, name: 'The Pickup', pay: 500,
    intro: 'Nadia: "Jules. A package is waiting on Palm Row. Pick it up, bring it to my garage. No drama."',
    stages: [
      { text: 'Pick up the package on Palm Row', x: 78, z: -104, kind: 'pickup', radius: 4 },
      { text: 'Deliver the package to Nadia\'s garage', x: -52, z: -26, kind: 'deliver', radius: 5 },
    ],
    outro: 'Nadia: "Clean. You still drive like you mean it. There is more work, if you want it."',
  },
  {
    id: 1, name: 'Hot Wheels', pay: 900,
    intro: 'Nadia: "A client wants a Coral coupe — the red one parked by the marina. Take it. The cops will notice. Make them not notice."',
    stages: [
      { text: 'Steal the red Coral coupe at the marina', x: COUPE_SPOT.x, z: COUPE_SPOT.z, kind: 'steal', radius: 5, wanted: 2 },
      { text: 'Deliver the coupe to the chop shop in Old Town', x: -130, z: -104, kind: 'deliver', radius: 5 },
    ],
    outro: 'Nadia: "Sold before you parked it. The Vultures saw you, though. Watch your back at the beach."',
  },
  {
    id: 2, name: 'The Exchange', pay: 1500,
    intro: 'Nadia: "The Vultures want the case back. Meet them at the pier — and Jules? Bring the pistol. It is that kind of meeting."',
    stages: [
      { text: 'Drive to the pier at Coral Beach', x: 156, z: 270, kind: 'goto', radius: 6 },
      { text: 'Deal with the Vultures — all of them', x: 156, z: 270, kind: 'shootout', radius: 40, enemies: 4 },
      { text: 'Grab the case and get to the safehouse', x: -26, z: 234, kind: 'deliver', radius: 5, wanted: 3 },
    ],
    outro: 'Nadia: "The case is ours, the Vultures are done, and Solmar is yours again. Drinks are on me, Jules."',
  },
  {
    id: 3, name: 'The Getaway', pay: 2000,
    intro: 'Nadia: "Last one, Jules — a courier is waiting in Downtown with the ledger. Get him to the marina yacht before the PD locks the city down. Fast."',
    stages: [
      { text: 'Pick up the courier in Downtown', x: -52, z: 52, kind: 'goto', radius: 5 },
      { text: 'Get the courier to the marina yacht — fast', x: 156, z: 268, kind: 'timed', radius: 6, wanted: 3, timeLimit: 90 },
    ],
    outro: 'Nadia: "Done. The ledger is gone, the yacht is gone, and you are still here. Solmar is yours, Jules."',
  },
];

export class Missions {
  constructor(scene) {
    this.scene = scene;
    this.index = 0;          // current mission
    this.stage = 0;
    this.active = false;
    this.done = [false, false, false, false];
    this.beacon = null;
    this.marker = null;      // {x, z} current objective
    this.onStage = null;     // callbacks set by main: {start, complete, stageDone}
    this.timedStage = -1;    // which stage the running timer belongs to
    this.stageStartT = 0;    // game time the timed stage began
    this.timeLeft = 0;       // seconds left on a timed stage
    this.buildBeacon();
  }
  buildBeacon() {
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    pillar.position.y = 30;
    g.add(pillar);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
    g.add(ring);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.9),
      new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    diamond.position.y = 4.5;
    g.add(diamond);
    g.userData.diamond = diamond;
    g.userData.ring = ring;
    g.visible = false;
    this.scene.add(g);
    this.beacon = g;
  }
  get current() { return MISSION_DEFS[this.index]; }
  get stageDef() { return this.current ? this.current.stages[this.stage] : null; }
  get allDone() { return this.index >= MISSION_DEFS.length; }
  start(index) {
    this.index = index; this.stage = 0; this.active = true;
    this.timedStage = -1; this.timeLeft = 0;
    this.showStage();
    return this.current.intro;
  }
  showStage() {
    const s = this.stageDef;
    if (!s) return;
    this.marker = { x: s.x, z: s.z };
    this.beacon.position.set(s.x, 0, s.z);
    this.beacon.visible = true;
  }
  // A timed stage ran out: the job fails, but the story waits for a retry.
  fail() {
    const m = this.current;
    this.active = false;
    this.beacon.visible = false;
    this.marker = null;
    this.timedStage = -1;
    return { type: 'missionFailed', mission: m };
  }
  // Called every frame while a mission is active. Returns an event string or null.
  update(playerX, playerZ, enemiesAlive, now) {
    if (!this.active) return null;
    const s = this.stageDef;
    if (!s) return null;
    // Beacon pulse.
    const d = this.beacon.userData.diamond;
    d.rotation.y += 0.03;
    d.position.y = 4.5 + Math.sin(now * 2.2) * 0.5;
    const dist = Math.hypot(playerX - s.x, playerZ - s.z);
    if (s.kind === 'steal') return null; // completes when the target car is entered
    if (s.kind === 'shootout') {
      if (enemiesAlive === 0) return this.advance();
      return null;
    }
    // Timed stages (a getaway with a deadline) count down in game time.
    if (s.timeLimit != null) {
      if (this.timedStage !== this.stage) {
        this.timedStage = this.stage;
        this.stageStartT = now;
      }
      this.timeLeft = s.timeLimit - (now - this.stageStartT);
      if (this.timeLeft <= 0) return this.fail();
    }
    if (dist < s.radius) return this.advance();
    return null;
  }
  advance() {
    const m = this.current;
    this.stage++;
    if (this.stage >= m.stages.length) {
      this.active = false;
      this.beacon.visible = false;
      this.marker = null;
      this.done[m.id] = true;
      return { type: 'missionComplete', mission: m };
    }
    this.showStage();
    return { type: 'stageComplete', mission: m, stage: this.stageDef };
  }
  objectiveText(playerX, playerZ) {
    if (this.allDone) return 'All jobs done — Solmar is yours. Free roam.';
    if (!this.active) return 'Press T to take the next job from Nadia';
    const s = this.stageDef;
    const d = Math.round(Math.hypot(playerX - s.x, playerZ - s.z));
    const timer = s.timeLimit != null ? `  ·  ${Math.max(0, Math.ceil(this.timeLeft))}s left` : '';
    return `${this.current.name}: ${s.text}  ·  ${d}m${timer}`;
  }
  saveState() { return { index: this.index, done: this.done }; }
  loadState(st) {
    if (!st) return;
    this.index = clamp(st.index ?? 0, 0, MISSION_DEFS.length);
    this.done = st.done ?? [false, false, false, false];
    this.active = false;
    this.beacon.visible = false;
    this.marker = null;
    this.timedStage = -1;
  }
}
