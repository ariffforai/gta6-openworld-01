// SOLMAR city: a sun-soaked coastal grid city, built procedurally from boxes and
// canvas textures. Roads run on a 52-unit grid; blocks hold buildings, plazas,
// palms and lamps. Exports the colliders, the road graph traffic follows, and
// the named districts the HUD and minimap draw from.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

export const BLOCK = 52;          // block pitch (road centre to road centre)
export const ROAD_W = 12;         // road width
export const GRID = 4;            // roads at -4..4 * BLOCK
export const CITY_R = GRID * BLOCK + 26;

const PALETTE = {
  ground: 0x8a7f6a, sidewalk: 0xb9b0a0, road: 0x2e3138, sand: 0xe8d29a,
  water: 0x1e7fa8, skyTop: 0x3f8fd2, skyBot: 0xffd9a0,
};

// One canvas texture with lit windows, tinted per building.
function buildingTexture(rng, base, litRatio) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  const cols = 6, rows = 14;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng() < litRatio;
      g.fillStyle = lit ? (rng() < 0.5 ? '#ffd98a' : '#bfe3ff') : 'rgba(20,28,44,0.85)';
      g.fillRect(8 + x * 19, 12 + y * 17, 13, 10);
    }
  }
  // Roof edge + ground floor awning strip.
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 128, 6);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 236, 128, 20);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3138'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f7c948';
  g.fillRect(62, 0, 4, 128);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(10, 0, 3, 128); g.fillRect(115, 0, 3, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function palmTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#2f7d32'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.beginPath(); g.moveTo(32, 34);
    g.quadraticCurveTo(32 + Math.cos(a) * 18, 34 + Math.sin(a) * 18 - 8,
      32 + Math.cos(a) * 28, 34 + Math.sin(a) * 26);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class City {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.colliders = [];   // {minX,maxX,minZ,maxZ} building boxes
    this.roadsX = []; this.roadsZ = [];
    for (let i = -GRID; i <= GRID; i++) { this.roadsX.push(i * BLOCK); this.roadsZ.push(i * BLOCK); }
    this.districts = [
      { name: 'Old Town', x: -130, z: -130, r: 90 },
      { name: 'Palm Row', x: 60, z: -110, r: 100 },
      { name: 'Downtown', x: -20, z: 30, r: 110 },
      { name: 'Marina Bay', x: 120, z: 150, r: 110 },
      { name: 'Coral Beach', x: 0, z: 265, r: 160 },
    ];
    this.build();
  }
  districtAt(x, z) {
    let best = 'Solmar'; let bd = 1e9;
    for (const d of this.districts) {
      const dd = (x - d.x) ** 2 + (z - d.z) ** 2;
      if (dd < bd) { bd = dd; best = d.name; }
    }
    return best;
  }
  addCollider(x, z, w, d, h) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h || 30 });
  }
  build() {
    const rng = this.rng;
    const scene = this.scene;
    // Sky: gradient dome + sun + fog + hemisphere light.
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(PALETTE.skyTop) }, bot: { value: new THREE.Color(PALETTE.skyBot) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bot, top, pow(h, 0.8)), 1.0); }',
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));
    scene.fog = new THREE.Fog(0xf2c98f, 220, 780);
    const sun = new THREE.DirectionalLight(0xffe8c0, 2.4);
    sun.position.set(180, 260, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -280; sun.shadow.camera.right = 280;
    sun.shadow.camera.top = 280; sun.shadow.camera.bottom = -280;
    sun.shadow.camera.far = 800;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x9fd4ff, 0x8a6f4d, 0.9));
    // Ground + sand + sea.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshLambertMaterial({ color: PALETTE.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true;
    scene.add(ground);
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 90),
      new THREE.MeshLambertMaterial({ color: PALETTE.sand }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, CITY_R + 32);
    sand.receiveShadow = true;
    scene.add(sand);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 500),
      new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.92 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.0, CITY_R + 320);
    scene.add(sea);
    // Roads: one long plane per street, textured with dashes.
    const roadTex = roadTexture();
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    for (const x of this.roadsX) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, CITY_R * 2 + 80), roadMat.clone());
      r.material.map = roadTex.clone();
      r.material.map.repeat.set(1, (CITY_R * 2 + 80) / 16);
      r.material.map.needsUpdate = true;
      r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 2;
      r.position.set(x, 0.04, 0); r.receiveShadow = true;
      scene.add(r);
    }
    for (const z of this.roadsZ) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, CITY_R * 2 + 80), roadMat.clone());
      r.material.map = roadTex.clone();
      r.material.map.repeat.set(1, (CITY_R * 2 + 80) / 16);
      r.material.map.needsUpdate = true;
      r.rotation.x = -Math.PI / 2;
      r.position.set(0, 0.04, z); r.receiveShadow = true;
      scene.add(r);
    }
    // Blocks: sidewalks, buildings, plazas, palms, lamps.
    const facadeCols = ['#c98f5f', '#7fa3b8', '#b8a88f', '#9a8fb8', '#d8b25e', '#8fb8a0', '#c97f7f', '#6f8fb8'];
    const palmTex = palmTexture();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const crownMat = new THREE.MeshBasicMaterial({ map: palmTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let bx = -GRID; bx < GRID; bx++) {
      for (let bz = -GRID; bz < GRID; bz++) {
        const cx = bx * BLOCK + BLOCK / 2;
        const cz = bz * BLOCK + BLOCK / 2;
        // Sidewalk slab.
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(BLOCK - ROAD_W + 2, 0.3, BLOCK - ROAD_W + 2),
          new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk }));
        sw.position.set(cx, 0.12, cz); sw.receiveShadow = true;
        scene.add(sw);
        const kind = rng();
        if (kind < 0.12) {
          // Plaza: planters + benches, no building.
          this.addPlaza(cx, cz, rng);
          continue;
        }
        // 1–2 buildings per block.
        const n = rng() < 0.45 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const w = 14 + rng() * 12, d = 14 + rng() * 12;
          const h = 9 + rng() * rng() * 42;
          const ox = n === 2 ? (k === 0 ? -9 : 9) : 0;
          const oz = n === 2 ? (k === 0 ? -9 : 9) : 0;
          const bx0 = cx + ox, bz0 = cz + oz;
          const base = facadeCols[Math.floor(rng() * facadeCols.length)];
          const tex = buildingTexture(rng, base, 0.28 + rng() * 0.3);
          const mat = new THREE.MeshLambertMaterial({ map: tex });
          const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          b.position.set(bx0, h / 2 + 0.25, bz0);
          b.castShadow = true; b.receiveShadow = true;
          scene.add(b);
          // Flat roof cap.
          const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
            new THREE.MeshLambertMaterial({ color: 0x3a3f47 }));
          roof.position.set(bx0, h + 0.5, bz0);
          scene.add(roof);
          this.addCollider(bx0, bz0, w, d, h);
        }
        // Palms + lamps around the block edges.
        const palmSpots = 2 + Math.floor(rng() * 3);
        for (let p = 0; p < palmSpots; p++) {
          const edge = Math.floor(rng() * 4);
          const t = -14 + rng() * 28;
          let px = cx, pz = cz;
          if (edge === 0) { px = cx + t; pz = cz - 17; }
          if (edge === 1) { px = cx + t; pz = cz + 17; }
          if (edge === 2) { px = cx - 17; pz = cz + t; }
          if (edge === 3) { px = cx + 17; pz = cz + t; }
          this.addPalm(scene, px, pz, trunkMat, crownMat, rng);
        }
        if (rng() < 0.6) {
          const lx = cx + (rng() < 0.5 ? -19 : 19), lz = cz + (rng() < 0.5 ? -19 : 19);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lampMat);
          pole.position.set(lx, 3.2, lz); scene.add(pole);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampHeadMat);
          head.position.set(lx, 6.3, lz); scene.add(head);
        }
      }
    }
    // Solmar Tower: the landmark skyscraper in Downtown.
    const towerTex = buildingTexture(rng, '#5f7fa8', 0.55);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 110, 26),
      new THREE.MeshLambertMaterial({ map: towerTex }));
    tower.position.set(-26, 55.2, 78); tower.castShadow = true;
    scene.add(tower);
    this.addCollider(-26, 78, 26, 26, 110);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4040 }));
    beacon.position.set(-26, 111, 78); scene.add(beacon);
    this.towerBeacon = beacon;
    // Marina pier + lighthouse on the beach.
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 60),
      new THREE.MeshLambertMaterial({ color: 0x8a6a45 }));
    pier.position.set(156, 0.6, CITY_R + 55); pier.castShadow = true;
    scene.add(pier);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 22, 10),
      new THREE.MeshLambertMaterial({ color: 0xf2ead8 }));
    light.position.set(190, 11, CITY_R + 30); light.castShadow = true;
    scene.add(light);
    const lightTop = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3, 10),
      new THREE.MeshLambertMaterial({ color: 0xc23b2e }));
    lightTop.position.set(190, 23, CITY_R + 30); scene.add(lightTop);
    this.addCollider(190, CITY_R + 30, 7, 7, 24);
    // A yacht anchored off the pier — the getaway boat in the final job.
    const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 15),
      new THREE.MeshLambertMaterial({ color: 0xf2ead8 }));
    hull.position.set(176, 0.8, CITY_R + 96); hull.castShadow = true;
    scene.add(hull);
    const yachtCabin = new THREE.Mesh(new THREE.BoxGeometry(4, 1.8, 7),
      new THREE.MeshLambertMaterial({ color: 0x2e6fc2 }));
    yachtCabin.position.set(176, 2.4, CITY_R + 94);
    scene.add(yachtCabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0x8a6a45 }));
    mast.position.set(176, 6.5, CITY_R + 96);
    scene.add(mast);
    // Beach umbrellas.
    for (let i = 0; i < 8; i++) {
      const ux = -180 + i * 52 + rng() * 20;
      const uz = CITY_R + 26 + rng() * 24;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pole.position.set(ux, 1.5, uz); scene.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 10),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0xff7f50 : 0x40b8ff }));
      top.position.set(ux, 3.2, uz); scene.add(top);
    }
    // Clouds: a few soft white blobs drifting slowly.
    this.clouds = [];
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(9 + rng() * 9, 8, 6), cloudMat);
        s.position.set(j * 12 - 18 + rng() * 6, rng() * 3, rng() * 8 - 4);
        s.scale.y = 0.45;
        g.add(s);
      }
      g.position.set(-500 + rng() * 1000, 150 + rng() * 60, -500 + rng() * 900);
      scene.add(g);
      this.clouds.push(g);
    }
  }
  addPlaza(cx, cz, rng) {
    const planterMat = new THREE.MeshLambertMaterial({ color: 0x5f8f4f });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.4), planterMat);
      p.position.set(cx - 10 + i * 10, 0.9, cz - 8 + rng() * 4);
      p.castShadow = true;
      this.scene.add(p);
    }
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 1.4), benchMat);
      b.position.set(cx - 8 + i * 16, 0.8, cz + 10);
      this.scene.add(b);
    }
  }
  addPalm(scene, x, z, trunkMat, crownMat, rng) {
    const h = 5 + rng() * 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 6), trunkMat);
    trunk.position.set(x, h / 2 + 0.2, z);
    trunk.rotation.z = (rng() - 0.5) * 0.16;
    trunk.castShadow = true;
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), crownMat);
    crown.position.set(x, h + 0.6, z);
    crown.rotation.x = -Math.PI / 2;
    crown.rotation.z = rng() * Math.PI;
    scene.add(crown);
  }
  update(dt, t) {
    for (let i = 0; i < this.clouds.length; i++) {
      this.clouds[i].position.x += dt * 1.6;
      if (this.clouds[i].position.x > 560) this.clouds[i].position.x = -560;
    }
    if (this.towerBeacon) {
      const s = 0.8 + Math.sin(t * 3) * 0.4;
      this.towerBeacon.material.color.setRGB(1, 0.25 * s, 0.25 * s);
    }
  }
  // Nearest point on a road centreline (used to keep traffic on streets).
  nearestRoadPoint(x, z) {
    let bx = this.roadsX[0], bz = z, best = Infinity;
    for (const rx of this.roadsX) { const d = Math.abs(x - rx); if (d < best) { best = d; bx = rx; } }
    let bz2 = this.roadsZ[0], best2 = Infinity;
    for (const rz of this.roadsZ) { const d = Math.abs(z - rz); if (d < best2) { best2 = d; bz2 = rz; } }
    if (best <= best2) return { x: bx, z, axis: 'z' };
    return { x, z: bz2, axis: 'x' };
  }
}
