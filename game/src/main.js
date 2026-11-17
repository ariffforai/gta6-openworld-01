// SOLMAR — Streets of Fortune. Boot, the fixed-step loop, screens, missions,
// wanted level, police, shooting, saving and the deterministic ?shot= states
// used for the entry's screenshots.
import * as THREE from 'three';
import { City, CITY_R, BLOCK } from './city.js';
import { Traffic, Police, CAR_COLORS } from './vehicles.js';
import { Pedestrians } from './pedestrians.js';
import { Player } from './player.js';
import { Combat } from './combat.js';
import { Missions, MISSION_DEFS } from './missions.js';
import { Wanted } from './wanted.js';
import { HUD } from './hud.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';
import { loadSave, writeSave, clearSave, saveLabel } from './save.js';
import { mulberry32, clamp, dist2 } from './util.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const SEED = Number.isInteger(seedParam) ? seedParam : 20261118;
const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const canvas = document.getElementById('scene');
const status = document.getElementById('status');
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const endEl = document.getElementById('endcard');
const endTitle = document.getElementById('endtitle');
const endText = document.getElementById('endtext');
const saveInfo = document.getElementById('saveinfo');
const btnStart = document.getElementById('btn-start');
const btnContinue = document.getElementById('btn-continue');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnRetry = document.getElementById('btn-retry');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 8, -14);

const rng = mulberry32(SEED);
const city = new City(scene, SEED);
const traffic = new Traffic(scene, city, mulberry32(SEED + 11));
const police = new Police(scene, city, mulberry32(SEED + 23));
const peds = new Pedestrians(scene, city, mulberry32(SEED + 37));
const player = new Player(scene);
const combat = new Combat(scene);
const missions = new Missions(scene);
const wanted = new Wanted();
const hud = new HUD();
const audio = new SoundBank();
const input = new Input(canvas);

traffic.spawnTraffic(14);
traffic.spawnParked(9);
peds.spawn(26);

// The mission-1 target: a red Coral coupe parked by the marina.
const coupe = traffic.parked.find((c) => c.colorName === 'Sunset Red') || traffic.parked[0];
if (coupe) {
  coupe.mesh.position.set(130, 0, 130);
  coupe.x = 130; coupe.z = 130; coupe.heading = Math.PI / 2;
  coupe.mesh.rotation.y = coupe.heading;
  coupe.isTarget = true;
  coupe.colorName = 'Coral coupe';
}

let state = 'menu';           // menu | playing | paused | over
let now = 0;
let elapsed = 0;              // wall time since start, for the shot timer
let shotFrames = 0;
let policeSpawnT = 0;
let saveT = 0;
let camPos = new THREE.Vector3(0, 8, -14);
let camLook = new THREE.Vector3(0, 1.5, 0);
let shotScript = null;        // {throttle, steer, frames} for staged screenshots
const camTarget = { position: new THREE.Vector3(), lookAt: new THREE.Vector3() };

function announce(msg) { status.textContent = msg; }

// Pointer lock can fail in headless browsers: never let it break the game.
function lockPointer() {
  try {
    const r = canvas.requestPointerLock?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* pointer lock unavailable */ }
}

function saveGame() {
  writeSave({
    money: player.money,
    health: player.health,
    armor: player.armor,
    x: player.x, z: player.z,
    missions: missions.saveState(),
    savedAt: new Date().toISOString(),
  });
}

function applySave(s) {
  player.money = s.money || 0;
  player.health = s.health ?? 100;
  player.armor = s.armor || 0;
  missions.loadState(s.missions);
  player.spawn(s.x ?? 0, s.z ?? 40, 0);
}

function startGame(fresh) {
  audio.ensure();
  if (fresh) {
    clearSave();
    player.money = 0; player.health = 100; player.armor = 0;
    missions.loadState({ index: 0, done: [false, false, false] });
    player.spawn(0, 40, 0);
  } else {
    const s = loadSave();
    if (s) applySave(s);
    else player.spawn(0, 40, 0);
  }
  wanted.clear();
  menuEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.show();
  document.body.classList.add('playing');
  state = 'playing';
  hud.toast('Welcome to Solmar. Press T to take a job from Nadia.', 5);
  hud.setHint('WASD move · E enter car · T next job · M mute · P pause');
  announce('Playing. Welcome to Solmar.');
  lockPointer();
}

function endGame(kind) {
  state = 'over';
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  audio.wasted();
  if (kind === 'wasted') {
    endTitle.textContent = 'WASTED';
    endText.textContent = 'Jules went down in the streets of Solmar. The hospital patched him up — for a price.';
  } else {
    endTitle.textContent = 'BUSTED';
    endText.textContent = 'The Solmar PD pinned Jules down. A night in the cells, a fine, and a long walk home.';
  }
  endEl.classList.remove('hidden');
  announce(kind === 'wasted' ? 'Wasted.' : 'Busted.');
}

function retry() {
  player.money = Math.floor(player.money * 0.9);
  player.health = 100;
  player.armor = 0;
  wanted.clear();
  police.clear();
  combat.clearEnemies();
  player.spawn(-26, 234, 0);   // safehouse by Coral Beach
  endEl.classList.add('hidden');
  document.body.classList.add('playing');
  state = 'playing';
  hud.toast('Back on your feet. The city is still yours.', 4);
  saveGame();
}

function nearestCar(maxD) {
  let best = null, bd = maxD * maxD;
  const all = [...traffic.parked, ...traffic.cars, ...police.cars];
  for (const c of all) {
    const d = dist2(player.x, player.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function tryEnterCar() {
  if (player.inCar) { player.exitCar(); hud.toast('On foot.', 1.5); return; }
  const car = nearestCar(4.5);
  if (!car) return;
  if (car.isPolice) { hud.toast('That is a police cruiser — stealing it is a bad idea.', 3); return; }
  const wasParked = traffic.parked.includes(car);
  if (wasParked) traffic.removeParked(car);
  const wasTraffic = traffic.cars.includes(car);
  if (wasTraffic) {
    traffic.cars.splice(traffic.cars.indexOf(car), 1);
    if (wanted.addCrime(14, now)) audio.wantedSting();
  }
  player.enterCar(car);
  audio.setEngine(0, true);
  if (missions.active && missions.stageDef?.kind === 'steal' && car.isTarget) {
    wanted.heat = Math.max(wanted.heat, 35);
    wanted.stars = 2;
    audio.wantedSting();
    hud.big('CAR STOLEN', 'The Solmar PD is on you — lose them', 2.5);
    advanceMission();
  } else if (missions.active && missions.stageDef?.kind === 'steal') {
    hud.toast('Nadia wanted the red Coral coupe, not this one.', 3);
  } else {
    hud.toast(`You took the ${car.colorName || 'car'}.`, 2);
  }
}

function advanceMission() {
  const ev = missions.advance();
  handleMissionEvent(ev);
}

function handleMissionEvent(ev) {
  if (!ev) return;
  if (ev.type === 'stageComplete') {
    audio.pickup();
    const s = ev.stage;
    hud.toast(s.text, 4);
    if (s.wanted) {
      wanted.heat = Math.max(wanted.heat, s.wanted === 2 ? 35 : 55);
      wanted.stars = s.wanted;
      audio.wantedSting();
    }
    if (s.kind === 'shootout') {
      combat.spawnEnemies([
        { x: 150, z: 262 }, { x: 162, z: 272 }, { x: 146, z: 280 }, { x: 168, z: 258 },
      ]);
      hud.big('THE VULTURES', 'Take them all down', 2.5);
    }
  } else if (ev.type === 'missionComplete') {
    const m = ev.mission;
    player.money += m.pay;
    audio.missionDone();
    audio.cash();
    hud.big('JOB DONE', `+$${m.pay}  ·  ${m.name}`, 3);
    hud.toast(m.outro, 6);
    missions.index = Math.min(missions.index + 1, MISSION_DEFS.length);
    saveGame();
  }
}

function takeJob() {
  if (missions.active) { hud.toast('Finish the current job first.', 2.5); return; }
  if (missions.allDone) { hud.toast('All jobs done — Solmar is yours. Free roam.', 3); return; }
  const intro = missions.start(missions.index);
  hud.toast(intro, 7);
  audio.pickup();
}

function shoot() {
  if (player.inCar) return;
  if (combat.fireCooldown > 0) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  const targets = [];
  // Pass the live objects (not copies) so hits decrement real health.
  for (const e of combat.enemies) targets.push(Object.assign(e, { kind: 'enemy', y: 1.3, radius: 1.15 }));
  for (const p of peds.peds) targets.push(Object.assign(p, { kind: 'ped', y: 1.2, radius: 0.9 }));
  for (const c of police.cars) targets.push(Object.assign(c, { kind: 'police', y: 0.8, radius: 2.4 }));
  for (const c of traffic.cars) targets.push(Object.assign(c, { kind: 'traffic', y: 0.8, radius: 2.4 }));
  const hit = combat.playerShoot(origin, dir, targets);
  audio.gunshot();
  if (!shotName) wanted.addCrime(4, now);
  peds.scare(player.x, player.z, 30);
  if (!hit) return;
  if (hit.kind === 'ped') {
    peds.knockDown(hit.x, hit.z, 1.5);
    if (!shotName) {
      wanted.addCrime(30, now);
      hud.toast('You shot a civilian! The police are coming.', 3);
      audio.wantedSting();
    }
  } else if (hit.kind === 'enemy') {
    if (!hit.alive) hud.toast('Vulture down.', 1.5);
  } else if (hit.kind === 'police' || hit.kind === 'traffic') {
    hit.health -= 34;
    wanted.addCrime(10, now);
    if (hit.health <= 0) {
      hit.alive = false;
      hit.speed = 0;
      combat.burst(hit.x, 1, hit.z, 0xff8040);
      if (hit.kind === 'police') {
        police.cars.splice(police.cars.indexOf(hit), 1);
        scene.remove(hit.mesh);
        hud.toast('Police cruiser disabled.', 2);
      } else {
        traffic.cars.splice(traffic.cars.indexOf(hit), 1);
        scene.remove(hit.mesh);
      }
    }
  }
}

function updatePolice(dt) {
  // In staged screenshot mode the police stay as staged: they chase, but no
  // new spawns, no heat changes and no bust — the shot must not end the game.
  if (!shotName) {
    const want = police.desiredCount(wanted.stars);
    policeSpawnT -= dt;
    if (wanted.stars > 0 && police.cars.length < want && policeSpawnT <= 0) {
      policeSpawnT = 1.4;
      police.spawnNear(player.x, player.z, player.heading);
    }
    let seen = false;
    for (const c of police.cars) {
      if (dist2(c.x, c.z, player.x, player.z) < 60 * 60) seen = true;
    }
    wanted.update(dt, seen, !player.inCar);
    if (wanted.busted) endGame('busted');
  }
  police.removeFar(player.x, player.z, 260);
  police.update(dt, player, city.colliders, (hard) => {
    if (hard >= 1 && !shotName) {
      if (player.damage(6, now)) audio.crash();
    }
  });
}

function step(dt) {
  now += dt;
  city.update(dt, now);
  if (state !== 'playing') return;
  // Global keys.
  if (input.hit('KeyM')) hud.toast(audio.toggleMute() ? 'Sound muted (M to unmute)' : 'Sound on', 2);
  if (input.hit('KeyC')) player.camDist = player.camDist > 10 ? 8 : 13;
  if (input.hit('KeyP') || input.hit('Escape')) { pauseGame(); return; }
  if (input.hit('KeyT')) takeJob();
  if (input.hit('KeyE')) tryEnterCar();

  player.update(dt, input, city.colliders);
  if (state !== 'playing') return; // endGame may have fired inside player.update

  // Shooting: hold the mouse on foot.
  if (!player.inCar && input.mouseDown) shoot();
  else combat.fireCooldown = Math.max(0, combat.fireCooldown - dt);

  // Car vs car: the player's car shoves traffic.
  if (player.inCar && player.car) {
    for (const c of traffic.cars) {
      const d2 = dist2(player.car.x, player.car.z, c.x, c.z);
      if (d2 < 3.4 * 3.4 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (3.4 - d) / 2;
        const nx = (player.car.x - c.x) / d, nz = (player.car.z - c.z) / d;
        player.car.x += nx * push; player.car.z += nz * push;
        c.x -= nx * push; c.z -= nz * push;
        if (Math.abs(player.car.speed) > 10) { player.car.speed *= 0.7; audio.crash(); }
      }
    }
    // Hitting pedestrians with the car.
    const runOver = peds.peds.find((p) => p.alive && dist2(player.car.x, player.car.z, p.x, p.z) < 2.2 * 2.2);
    if (runOver) {
      peds.knockDown(runOver.x, runOver.z, 2);
      if (!shotName) {
        if (wanted.addCrime(22, now)) audio.wantedSting();
        hud.toast('You hit a pedestrian!', 2.5);
      }
    }
  } else {
    // On foot: traffic that runs into the player hurts him.
    for (const c of traffic.cars) {
      if (Math.abs(c.speed) > 3 && dist2(player.x, player.z, c.x, c.z) < 1.6 * 1.6) {
        if (player.damage(14, now)) {
          audio.crash();
          player.x += Math.sin(c.heading) * 2;
          player.z += Math.cos(c.heading) * 2;
        }
      }
    }
  }

  traffic.update(dt, player.inCar ? player.car : null, city.colliders);
  peds.update(dt, player.x, player.z, player.speed);
  updatePolice(dt);
  combat.update(dt, player.pos, (d) => {
    const chance = d < 25 ? 0.3 : d < 45 ? 0.14 : 0.05;
    if (!shotName && Math.random() < chance && player.damage(7, now)) audio.enemyShot();
  });

  // Mission logic.
  const ev = missions.update(player.x, player.z, combat.aliveCount(), now);
  handleMissionEvent(ev);

  // Health regen (slow) and death.
  if (player.health < 100) player.health = Math.min(100, player.health + dt * 1.2);
  if (player.health <= 0) { endGame('wasted'); return; }

  // HUD.
  hud.setMoney(player.money, city.districtAt(player.x, player.z));
  hud.setHealth(player.health, player.armor);
  hud.setWanted(wanted.stars);
  hud.setObjective(missions.objectiveText(player.x, player.z));
  hud.setSpeed(Math.abs(player.speed) * 2.24, player.inCar);
  hud.setArmed(!player.inCar);
  const near = player.inCar ? null : nearestCar(4.5);
  hud.setInteract(near ? `Press E — steal the ${near.isTarget ? 'red Coral coupe' : near.colorName || 'car'}` : '');
  hud.tick(dt);
  hud.drawMinimap({
    player, peds: peds.peds.filter((p) => p.alive),
    traffic: [...traffic.cars, ...traffic.parked], police: police.cars,
    marker: missions.marker, now,
  });
  audio.setEngine(player.inCar ? clamp(Math.abs(player.speed) / 30, 0, 1) : 0, player.inCar);
  audio.setSiren(wanted.stars > 0, dt);

  // Autosave every 20 s while playing.
  saveT += dt;
  if (saveT > 20) { saveT = 0; saveGame(); }

  // Camera. Never let it sit inside a building: lift it above the roof.
  if (shotName === 'city') {
    camPos.set(-140 + Math.sin(now * 0.05) * 20, 150, -140 + Math.cos(now * 0.05) * 20);
    camLook.set(0, 0, 40);
  } else {
    player.cameraTarget(camTarget);
    const k = 1 - Math.exp(-10 * dt);
    camPos.lerp(camTarget.position, k);
    camLook.lerp(camTarget.lookAt, k);
  }
  for (const b of city.colliders) {
    if (camPos.x > b.minX - 0.5 && camPos.x < b.maxX + 0.5 &&
        camPos.z > b.minZ - 0.5 && camPos.z < b.maxZ + 0.5 && camPos.y < b.h + 2) {
      camPos.y = b.h + 2;
    }
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function pauseGame() {
  state = 'paused';
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  pauseEl.classList.remove('hidden');
  announce('Paused.');
}
function resumeGame() {
  pauseEl.classList.add('hidden');
  document.body.classList.add('playing');
  state = 'playing';
  lockPointer();
  announce('Playing.');
}

btnStart.addEventListener('click', () => startGame(true));
btnContinue.addEventListener('click', () => startGame(false));
btnResume.addEventListener('click', resumeGame);
btnRestart.addEventListener('click', () => { clearSave(); window.location.reload(); });
btnRetry.addEventListener('click', retry);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing' && !shotName) pauseGame();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Save button on the menu.
const saved = loadSave();
if (saved) {
  btnContinue.classList.remove('hidden');
  saveInfo.textContent = saveLabel(saved);
}

// The loop: fixed 1/60 s steps, paint every frame.
let last = performance.now();
let acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, MAX_FRAME);
  last = t;
  elapsed += dt;
  if (state === 'playing' || state === 'menu') {
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 5) { step(STEP); acc -= STEP; guard++; }
    if (guard >= 5) acc = 0;
  }
  if (state === 'menu') {
    // Slow cinematic orbit behind the menu.
    const a = elapsed * 0.05;
    camera.position.set(Math.sin(a) * 120, 55, Math.cos(a) * 120);
    camera.lookAt(0, 10, 30);
  }
  renderer.render(scene, camera);
  input.endFrame();
  // Screenshot mode: stage, run the world a little, then signal readiness.
  if (shotName) {
    shotFrames++;
    if (shotFrames === 100) window.__shotReady = true;
  }
}

if (shotName) {
  shotScript = stageShot(shotName, {
    player, missions, wanted, police, combat, traffic, peds, hud, city, input,
    startGame, SEED,
  });
  // Run the staged scene live for a couple of seconds so traffic, police and
  // the camera settle before the screenshot. Auto-drive holds W through the
  // normal input path so the car drives like a player would.
  if (shotScript?.autoDrive) {
    input.keys['KeyW'] = true;
  }
  state = 'playing';
  menuEl.classList.add('hidden');
  hud.show();
  document.body.classList.add('playing');
}
requestAnimationFrame(frame);
