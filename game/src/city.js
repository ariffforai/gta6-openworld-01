// SOLMAR city: a procedural 9x9-block sun-soaked city on a fixed seed.
// Five districts, a tower landmark at the centre, a marina pier with a
// lighthouse to the east, Coral Beach and the sea to the south, palms,
// plazas and drifting clouds. Everything is built once from seed 7, so the
// city is identical on every load. Buildings register AABB colliders that
// the player and the cars push against.

import * as THREE from 'three';
import { mulberry32, rand, randInt, pick, clamp } from './util.js';

const BLOCK = 40; // a city block is 40 units square
const ROAD = 12; // roads are 12 units wide
const PITCH = BLOCK + ROAD; // 52 units from one block centre to the next
const HALF = 4 * PITCH + BLOCK / 2 + ROAD / 2; // 240: road centreline to edge

/** Road centrelines, one per gap between blocks plus the two outer roads. */
export const ROAD_LINES = [-234, -182, -130, -78, -26, 26, 78, 130, 182, 234];

/** A canvas texture of a facade: pale base with a grid of windows. */
function facadeTexture(rng, litChance) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2ede4';
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 6; col++) {
      const lit = rng() < litChance;
      ctx.fillStyle = lit ? '#ffd76a' : '#2c3540';
      ctx.fillRect(10 + col * 19, 12 + row * 20, 12, 12);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A canvas texture of asphalt with a dashed centre line running along U. */
function roadTexture(rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#33373d';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#565b63';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(rng() * 256, rng() * 64, 2, 2);
  }
  ctx.fillStyle = '#e8e4d8';
  ctx.fillRect(20, 30, 60, 4);
  ctx.fillRect(148, 30, 60, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One palm tree: a leaning trunk and a crown of flat fronds. */
function makePalm(rng) {
  const palm = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f9e44 });
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.34, 7, 6),
    trunkMat,
  );
  trunk.position.y = 3.5;
  trunk.rotation.z = rand(rng, -0.08, 0.08);
  palm.add(trunk);
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 3.4, 4),
      frondMat,
    );
    const a = (i / 6) * Math.PI * 2;
    frond.position.set(Math.cos(a) * 1.2, 7.1, Math.sin(a) * 1.2);
    frond.rotation.z = Math.cos(a) * 1.15;
    frond.rotation.x = -Math.sin(a) * 1.15;
    frond.scale.set(1, 1, 0.22);
    palm.add(frond);
  }
  palm.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return palm;
}

/** Which district a block (bx, bz, each -4..4) belongs to. */
function districtOf(bx, bz) {
  if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) return 'downtown';
  if (bz === 4) return 'beachfront';
  if (bx === 4) return 'marina';
  if (bx === -4) return 'oldtown';
  if (bz === -4) return 'north';
  return 'residential';
}

const DISTRICT_HEIGHT = {
  downtown: [26, 64],
  marina: [16, 34],
  beachfront: [12, 24],
  oldtown: [8, 15],
  north: [14, 28],
  residential: [10, 22],
};

const DISTRICT_TINT = {
  downtown: 0xcfd8e6,
  marina: 0xf0e2c8,
  beachfront: 0xf6e8d8,
  oldtown: 0xe0cfa8,
  north: 0xd8e0d0,
  residential: 0xe8ddce,
};

/** Build the whole city into `scene`. Returns colliders, roads and bounds. */
export function buildCity(scene) {
  const rng = mulberry32(7);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const colliders = [];
  const buildingMeshes = [];
  const clouds = [];
  let lighthouseBeam = null;

  const addCollider = (cx, cz, hw, hd) => {
    colliders.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
  };

  // --- ground, sea and beach ---------------------------------------------
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0x7fae62 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  group.add(grass);

  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 12, HALF * 2 + 12),
    new THREE.MeshLambertMaterial({ color: 0x9aa0a3 }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = 0;
  slab.receiveShadow = true;
  group.add(slab);

  const seaMat = new THREE.MeshLambertMaterial({ color: 0x2e7fa8 });
  const seaSouth = new THREE.Mesh(new THREE.PlaneGeometry(900, 454), seaMat);
  seaSouth.rotation.x = -Math.PI / 2;
  seaSouth.position.set(0, 0.02, 296 + 227);
  group.add(seaSouth);
  const seaEast = new THREE.Mesh(new THREE.PlaneGeometry(354, 742), seaMat);
  seaEast.rotation.x = -Math.PI / 2;
  seaEast.position.set(246 + 177, 0.02, -75);
  group.add(seaEast);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, 50),
    new THREE.MeshLambertMaterial({ color: 0xe8d8a0 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.06, 271);
  sand.receiveShadow = true;
  group.add(sand);

  // --- roads ---------------------------------------------------------------
  // Two shared materials (one per orientation) so the dashed centre line
  // runs along each road's length without a texture clone per road.
  const roadTexH = roadTexture(rng);
  roadTexH.repeat.set(8, 1);
  const roadTexV = roadTexture(rng);
  roadTexV.repeat.set(8, 1);
  const roadMatH = new THREE.MeshLambertMaterial({ map: roadTexH });
  const roadMatV = new THREE.MeshLambertMaterial({ map: roadTexV });
  for (const line of ROAD_LINES) {
    const roadH = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 12, ROAD),
      roadMatH,
    );
    roadH.rotation.x = -Math.PI / 2;
    roadH.position.set(0, 0.04, line);
    roadH.receiveShadow = true;
    group.add(roadH);
    const roadV = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 12, ROAD),
      roadMatV,
    );
    roadV.rotation.x = -Math.PI / 2;
    roadV.rotation.z = Math.PI / 2;
    roadV.position.set(line, 0.04, 0);
    roadV.receiveShadow = true;
    group.add(roadV);
  }

  // --- buildings -----------------------------------------------------------
  const facades = [
    facadeTexture(mulberry32(11), 0.25),
    facadeTexture(mulberry32(23), 0.4),
    facadeTexture(mulberry32(47), 0.15),
  ];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });

  const addBuilding = (cx, cz, w, d, h, tint) => {
    // Clone the facade texture per building and repeat it so the windows
    // stay the same size on a 10-unit house and a 60-unit tower.
    const tex = pick(rng, facades).clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(w / 14)), Math.max(1, Math.round(h / 14)));
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: tint });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    buildingMeshes.push(mesh);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.8, d * 0.92), roofMat);
    roof.position.set(cx, h + 0.4, cz);
    roof.castShadow = true;
    group.add(roof);
    addCollider(cx, cz, w / 2, d / 2);
  };

  for (let bz = -4; bz <= 4; bz++) {
    for (let bx = -4; bx <= 4; bx++) {
      if (bx === 0 && bz === 0) continue; // the tower plaza
      const district = districtOf(bx, bz);
      const [hMin, hMax] = DISTRICT_HEIGHT[district];
      const tint = DISTRICT_TINT[district];
      const cx = bx * PITCH;
      const cz = bz * PITCH;
      const layout = randInt(rng, 0, 2);
      if (layout === 0) {
        // One big building filling most of the block.
        addBuilding(cx, cz, rand(rng, 26, 32), rand(rng, 26, 32), rand(rng, hMin, hMax), tint);
      } else if (layout === 1) {
        // Two buildings side by side.
        const w = rand(rng, 13, 16);
        addBuilding(cx - 9, cz, w, rand(rng, 26, 32), rand(rng, hMin, hMax), tint);
        addBuilding(cx + 9, cz, w, rand(rng, 26, 32), rand(rng, hMin, hMax), tint);
      } else {
        // Four small buildings, one per quadrant.
        for (const [ox, oz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
          if (rng() < 0.2) continue; // sometimes a courtyard stays open
          addBuilding(cx + ox, cz + oz, rand(rng, 13, 16), rand(rng, 13, 16), rand(rng, hMin, hMax), tint);
        }
      }
    }
  }

  // --- Solmar Tower and the central plaza ----------------------------------
  const towerTex = facades[1].clone();
  towerTex.needsUpdate = true;
  towerTex.wrapS = THREE.RepeatWrapping;
  towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(2, 9);
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xb8c8dc, map: towerTex });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 120, 26), towerMat);
  tower.position.set(0, 60, 0);
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);
  buildingMeshes.push(tower);
  addCollider(0, 0, 13, 13);
  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 2.2, 22, 8),
    new THREE.MeshLambertMaterial({ color: 0x8a94a6 }),
  );
  spire.position.set(0, 131, 0);
  spire.castShadow = true;
  group.add(spire);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );
  beacon.position.set(0, 143, 0);
  group.add(beacon);

  // A fountain in the plaza, south of the tower.
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6.6, 1.2, 20),
    new THREE.MeshLambertMaterial({ color: 0x8a94a6 }),
  );
  basin.position.set(0, 0.6, 34);
  basin.castShadow = true;
  group.add(basin);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 20),
    new THREE.MeshLambertMaterial({ color: 0x4db2e8 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 1.25, 34);
  group.add(water);
  addCollider(0, 34, 6.6, 6.6);

  // --- marina pier and lighthouse ------------------------------------------
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x9c7d54 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(90, 1, 16), pierMat);
  pier.position.set(246 + 45, 0.6, 60);
  pier.castShadow = true;
  pier.receiveShadow = true;
  group.add(pier);
  for (let i = 0; i < 6; i++) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 2.4, 6),
      pierMat,
    );
    post.position.set(252 + i * 16, -0.4, 60 + (i % 2 === 0 ? 7 : -7));
    group.add(post);
  }
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xf2ede4 });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const lighthouse = new THREE.Group();
  lighthouse.position.set(342, 0, 60);
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 4, 12), bandMat);
  lhBase.position.y = 2;
  const lhTower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 22, 12), lightMat);
  lhTower.position.y = 15;
  const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 3, 12), bandMat);
  lhBand.position.y = 20;
  const lhLamp = new THREE.Mesh(
    new THREE.SphereGeometry(2, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
  );
  lhLamp.position.y = 27;
  lighthouse.add(lhBase, lhTower, lhBand, lhLamp);
  lighthouse.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  group.add(lighthouse);
  addCollider(342, 60, 6, 6);
  lighthouseBeam = new THREE.Mesh(
    new THREE.ConeGeometry(6, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2b0,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  lighthouseBeam.rotation.z = Math.PI / 2;
  lighthouseBeam.position.set(342, 27, 60);
  group.add(lighthouseBeam);

  // --- palms -----------------------------------------------------------------
  const palmSpots = [];
  for (let i = 0; i < 14; i++) palmSpots.push([-220 + i * 34, 254]);
  for (let i = 0; i < 6; i++) palmSpots.push([-30 + i * 12, 46]);
  for (const [x, z] of [[260, 44], [300, 76], [270, 76], [320, 44]]) palmSpots.push([x, z]);
  for (const [x, z] of palmSpots) {
    const palm = makePalm(rng);
    palm.position.set(x + rand(rng, -2, 2), 0, z + rand(rng, -2, 2));
    palm.rotation.y = rand(rng, 0, Math.PI * 2);
    group.add(palm);
  }

  // --- streetlights ------------------------------------------------------------
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const line of ROAD_LINES) {
    for (const along of [-156, -52, 52, 156]) {
      for (const [x, z] of [[line + 7, along], [along, line + 7]]) {
        if (Math.abs(x) > HALF + 4 || Math.abs(z) > HALF + 4) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7, 6), poleMat);
        pole.position.set(x, 3.5, z);
        group.add(pole);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat);
        lamp.position.set(x, 7.1, z);
        group.add(lamp);
      }
    }
  }

  // --- clouds ------------------------------------------------------------------
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Group();
    const puffs = randInt(rng, 3, 5);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(rng, 4, 9), 10, 8), cloudMat);
      s.position.set(p * rand(rng, 5, 8) - puffs * 3, rand(rng, -1, 1), rand(rng, -4, 4));
      s.scale.y = 0.55;
      cloud.add(s);
    }
    cloud.position.set(rand(rng, -320, 320), rand(rng, 70, 100), rand(rng, -320, 320));
    group.add(cloud);
    clouds.push(cloud);
  }

  return {
    group,
    colliders,
    buildingMeshes,
    roadLines: ROAD_LINES,
    bounds: { minX: -HALF - 20, maxX: 352, minZ: -HALF - 20, maxZ: 292 },
    /** Drift the clouds and sweep the lighthouse beam. */
    update(dt) {
      for (const cloud of clouds) {
        cloud.position.x += dt * 1.5;
        if (cloud.position.x > 360) cloud.position.x = -360;
      }
      if (lighthouseBeam) lighthouseBeam.rotation.y += dt * 0.6;
    },
  };
}
