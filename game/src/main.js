// SOLMAR — Streets of Fortune. Entry point: renderer, lights, the menu
// orbit, the state machine (menu / playing / paused) and the main loop.
// The world itself lives in the modules: city, player and vehicles here;
// combat, wanted, missions, HUD and save are wired in below, and audio
// and screenshots join later.

import * as THREE from 'three';
import { buildCity } from './city.js';
import { createPlayer } from './player.js';
import { createVehicles } from './vehicles.js';
import { createInput } from './input.js';
import { createPedestrians } from './pedestrians.js';
import { createWanted } from './wanted.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createSave } from './save.js';

const el = (id) => document.getElementById(id);
const show = (node, on) => {
  if (node) node.style.display = on ? '' : 'none';
};

// --- renderer ---------------------------------------------------------------
const canvas = el('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec3e8);
scene.fog = new THREE.Fog(0x8ec3e8, 260, 620);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  900,
);

// Sun-soaked light: a warm directional sun with shadows, plus sky fill.
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(180, 260, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -280;
sun.shadow.camera.right = 280;
sun.shadow.camera.top = 280;
sun.shadow.camera.bottom = -280;
sun.shadow.camera.far = 700;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9));

// --- world --------------------------------------------------------------------
const city = buildCity(scene);
const player = createPlayer(scene, city);
const vehicles = createVehicles(scene, city);
const input = createInput(canvas);
const pedestrians = createPedestrians(scene, city);
const wanted = createWanted(scene, city, player, vehicles, {
  onBusted: () => setState('busted'),
  onWasted: () => setState('wasted'),
});
const combat = createCombat(scene, city, {
  player,
  vehicles,
  pedestrians,
  wanted,
  canvas,
  isPlaying: () => world.state === 'playing',
});

// --- game state ---------------------------------------------------------------
const world = {
  state: 'menu', // menu | playing | paused
  money: 250,
  wanted: 0,
  time: 0,
  menuAngle: 0,
};

// Missions, HUD and save (created here, after `world`, since all three
// read it). The HUD hooks are late-bound through `hud` and `save` because
// missions is created first but only calls them on ticks.
let hud;
let save;
const missions = createMissions(scene, city, {
  player,
  vehicles,
  wanted,
  world,
  toast: (text, secs) => hud?.toast(text, secs),
  setObjective: (text) => hud?.setObjective(text),
  onComplete: () => save?.saveNow(),
});
hud = createHud({
  world,
  player,
  vehicles,
  pedestrians,
  wanted,
  combat,
  missions,
  city,
});
save = createSave({ world, player, missions });

function setState(next) {
  world.state = next;
  // Being wasted or busted ends the run but not the progress: save the
  // money and the finished jobs before the screens come up.
  if ((next === 'wasted' || next === 'busted') && save) save.saveNow();
  show(el('screen-start'), next === 'menu');
  show(el('screen-pause'), next === 'paused');
  show(el('screen-wasted'), next === 'wasted');
  show(el('screen-busted'), next === 'busted');
  show(el('hud'), next === 'playing');
  if (next !== 'playing') input.unlock();
}

function lockPointer() {
  // Pointer lock can be refused (headless browsers, iframes); the game
  // still plays with the arrow keys, so a refusal is never fatal.
  try {
    const p = canvas.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // No pointer lock available.
  }
}

function startGame() {
  player.reset();
  pedestrians.reset();
  wanted.reset();
  combat.reset();
  missions.reset();
  save.applyOnStart();
  setState('playing');
  lockPointer();
}

function togglePause() {
  if (world.state === 'playing') setState('paused');
  else if (world.state === 'paused') {
    setState('playing');
    lockPointer();
  }
}

el('start-button')?.addEventListener('click', startGame);
el('resume-button')?.addEventListener('click', togglePause);
el('retry-button')?.addEventListener('click', startGame);
el('retry-busted-button')?.addEventListener('click', startGame);

// Esc leaves pointer lock; that is the pause gesture.
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) hadLock = true;
  else if (hadLock && world.state === 'playing') {
    hadLock = false;
    setState('paused');
  }
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyP' && (world.state === 'playing' || world.state === 'paused')) {
    togglePause();
  }
});
// Hiding the tab pauses the game instead of letting the clock jump.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && world.state === 'playing') setState('paused');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- main loop ------------------------------------------------------------------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  world.time += dt;

  if (world.state === 'menu') {
    // Slow orbit over the tower while the start screen is up.
    world.menuAngle += dt * 0.05;
    const r = 150;
    camera.position.set(
      Math.sin(world.menuAngle) * r,
      72,
      Math.cos(world.menuAngle) * r,
    );
    camera.lookAt(0, 42, 0);
    city.update(dt);
  } else if (world.state === 'playing') {
    player.update(dt, input, camera);
    vehicles.update(dt, input, player, camera);
    const playerSpeed = vehicles.driven
      ? Math.abs(vehicles.driven.speed)
      : player.speed;
    pedestrians.update(dt, player.pos, playerSpeed);
    wanted.update(dt, playerSpeed);
    combat.update(dt, input, camera);
    missions.update(dt);
    hud.update(dt);
    save.update(dt);
    city.update(dt);
  }

  input.endFrame();
  renderer.render(scene, camera);
}

setState('menu');
tick();

// A handle for playtests and the screenshot scripts.
window.__solmar = { world, player, vehicles, city, pedestrians, wanted, combat, missions, hud, save, renderer, scene, camera };
