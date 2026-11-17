// Deterministic screenshot staging for SOLMAR: ?shot=cover|drive|chase|mission|city
// puts the real game into a scene that shows its systems — driving, a police
// chase, the marina shootout, or the city skyline — and lets it run live for a
// couple of seconds so traffic, police and the camera settle before the shot.
// The same seed always stages the same scene.
import { MISSION_DEFS } from './missions.js';

export function stageShot(name, ctx) {
  const { player, missions, wanted, police, combat, traffic, peds, hud, city, input, startGame } = ctx;
  const safe = (n) => ['cover', 'drive', 'chase', 'mission', 'city'].includes(n) ? n : 'cover';
  const shot = safe(name);

  // Start a fresh game in code (no menu, no pointer lock, no audio).
  player.money = 2450;
  player.health = 100;
  player.armor = 50;
  wanted.clear();
  player.spawn(0, 40, 0);

  if (shot === 'cover' || shot === 'chase') {
    // Jules driving downtown with the Solmar PD on his tail, mid-mission.
    const car = traffic.parked[0] || traffic.cars[0];
    if (car) {
      traffic.removeParked(car);
      car.x = -26; car.z = -60; car.heading = 0; car.speed = 16;
      player.enterCar(car);
    }
    wanted.heat = shot === 'chase' ? 62 : 42;
    wanted.stars = shot === 'chase' ? 3 : 2;
    for (let i = 0; i < (shot === 'chase' ? 4 : 2); i++) {
      police.spawnNear(player.x, player.z, 0);
    }
    missions.start(1);
    missions.stage = 1;
    missions.showStage();
    hud.toast('Nadia: "The coupe is hot. Lose them, then bring it to Old Town."', 6);
    return { autoDrive: true };
  }

  if (shot === 'drive') {
    // A quiet cruise down the beach road at golden hour.
    const car = traffic.parked[1] || traffic.cars[0];
    if (car) {
      traffic.removeParked(car);
      car.x = 52; car.z = 220; car.heading = Math.PI; car.speed = 14;
      player.enterCar(car);
    }
    hud.toast('Coral Beach — the long way home.', 5);
    return { autoDrive: true };
  }

  if (shot === 'mission') {
    // On foot at the pier, pistol out, the Vultures waiting.
    player.spawn(156, 250, 0);
    input.mouseDown = true; // hold the trigger so the pistol stays out
    missions.start(2);
    missions.stage = 1;
    missions.showStage();
    combat.spawnEnemies([
      { x: 150, z: 262 }, { x: 162, z: 272 }, { x: 146, z: 280 }, { x: 168, z: 258 },
    ]);
    hud.toast('Nadia: "It is that kind of meeting."', 5);
    return { autoDrive: false };
  }

  // city: the camera orbit in main.js does the work; just give it a lively street.
  player.spawn(-26, 78, 0);
  missions.start(0);
  return { autoDrive: false };
}
