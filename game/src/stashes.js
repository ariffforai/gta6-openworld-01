// Cash stashes for SOLMAR: five glowing cases hidden around the city, each
// worth $150 to whoever walks or drives over it. They reward exploring the
// map between jobs — the minimap marks every stash still out there, and the
// counter in the HUD's money line shows how many are left. Stashes reset
// each session, so a fresh day in Solmar always has five to find.
import * as THREE from 'three';

export const STASH_VALUE = 150;

const STASH_SPOTS = [
  { x: -104, z: -104, note: 'Old Town crossroads' },
  { x: 104, z: 52, note: 'Downtown avenue' },
  { x: 0, z: 208, note: 'Beach road' },
  { x: -156, z: 156, note: 'Marina corner' },
  { x: 52, z: -156, note: 'Palm Row back street' },
];

export class Stashes {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    for (const spot of STASH_SPOTS) {
      const g = new THREE.Group();
      const kase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.8),
        new THREE.MeshLambertMaterial({ color: 0x8a6a2a }));
      kase.position.y = 0.45; kase.castShadow = true;
      g.add(kase);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.14, 0.84),
        new THREE.MeshBasicMaterial({ color: 0xffd23e }));
      lid.position.y = 0.72;
      g.add(lid);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
      g.add(ring);
      g.position.set(spot.x, 0, spot.z);
      scene.add(g);
      this.list.push({ ...spot, mesh: g, taken: false, phase: Math.random() * 6 });
    }
  }
  get remaining() { return this.list.filter((s) => !s.taken).length; }
  get total() { return this.list.length; }
  // Returns the stash just collected, if the player is standing on one.
  update(playerX, playerZ, now) {
    for (const s of this.list) {
      // Bob the lid so a stash catches the eye from down the street.
      s.phase += 0.03;
      s.mesh.children[1].position.y = 0.72 + Math.sin(s.phase) * 0.08;
      if (s.taken) continue;
      if (Math.hypot(playerX - s.x, playerZ - s.z) < 3) {
        s.taken = true;
        s.mesh.visible = false;
        return s;
      }
    }
    return null;
  }
  // Positions for the minimap: every stash still out there.
  markers() {
    return this.list.filter((s) => !s.taken).map((s) => ({ x: s.x, z: s.z }));
  }
}
