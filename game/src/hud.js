// SOLMAR HUD: the live bar (money, health, armour, wanted stars, ammo,
// speed), the circular minimap, the crosshair, toasts and the objective
// line. This module owns every HUD element — main.js only calls update()
// once per tick while playing. The minimap is drawn on the #minimap canvas
// in plain 2D, from the live world: roads, the player arrow, cars,
// pedestrians, police cruisers and mission beacons.

const MAP_SIZE = 336; // the #minimap canvas is 336 x 336
const MAP_RANGE = 640; // world units across the minimap
const MAP_CENTRE = { x: 46, z: 16 }; // middle of the city bounds

/** Create the HUD. `ctx` carries everything it reads: world, player,
 * vehicles, pedestrians, wanted, combat, missions and city (road lines). */
export function createHud(ctx) {
  const { world, player, vehicles, pedestrians, wanted, combat, missions, city } = ctx;
  const el = (id) => document.getElementById(id);
  const minimap = el('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;
  const scale = MAP_SIZE / MAP_RANGE;
  const toX = (x) => (x - MAP_CENTRE.x) * scale + MAP_SIZE / 2;
  const toY = (z) => MAP_SIZE / 2 - (z - MAP_CENTRE.z) * scale;

  // The crosshair: index.html holds no crosshair element, so the HUD
  // builds its own and pins it to the centre of the screen.
  const crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  crosshair.textContent = '+';
  crosshair.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'font-size:26px',
    'font-weight:900',
    'color:rgba(255,255,255,0.92)',
    'text-shadow:0 1px 3px rgba(0,0,0,0.85)',
    'display:none',
  ].join(';');
  el('hud')?.appendChild(crosshair);

  const hud = {
    /** Seconds left on the current toast, 0 when none is showing. */
    toastTime: 0,

    /** Show a message in the middle of the screen for `secs` seconds. */
    toast(text, secs = 3) {
      const node = el('toast');
      if (!node) return;
      node.textContent = text;
      hud.toastTime = secs;
    },

    /** Set the objective line (top left). Nothing overwrites it per-frame. */
    setObjective(text) {
      const node = el('objective-text');
      if (node) node.textContent = text;
    },

    /** Refresh the top bar: money, health, armour, stars, ammo, speed. */
    refreshBar() {
      const money = el('money-value');
      if (money) money.textContent = `$${world.money}`;
      const health = el('health-value');
      if (health) health.textContent = `${Math.round(player.health)}`;
      const armour = el('armour-value');
      if (armour) armour.textContent = `${Math.round(player.armour || 0)}`;
      // The wanted level lives on the wanted system; the world mirrors it.
      world.wanted = wanted.level;
      const stars = el('stars');
      if (stars) {
        stars.textContent = '★'.repeat(world.wanted) + '☆'.repeat(5 - world.wanted);
      }
      const ammo = el('ammo-value');
      if (ammo) {
        ammo.textContent = combat.reloading ? 'RELOADING…' : `AMMO ${combat.ammo}`;
      }
      const speed = el('speed-value');
      if (speed) {
        const kmh = Math.abs(vehicles.driven ? vehicles.driven.speed : player.speed) * 3.6;
        speed.textContent = `${Math.round(kmh)} km/h`;
      }
    },

    /** Draw the circular minimap: roads, dots for everything that moves,
     * mission beacons, and the player arrow on top. */
    drawMinimap() {
      if (!mapCtx) return;
      const half = MAP_SIZE / 2;
      mapCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      mapCtx.save();
      mapCtx.beginPath();
      mapCtx.arc(half, half, half, 0, Math.PI * 2);
      mapCtx.clip();

      // Dark city ground.
      mapCtx.fillStyle = 'rgba(12, 24, 36, 0.9)';
      mapCtx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      // The road grid.
      mapCtx.strokeStyle = 'rgba(200, 210, 220, 0.55)';
      mapCtx.lineWidth = 4;
      mapCtx.beginPath();
      for (const line of city.roadLines) {
        mapCtx.moveTo(toX(line), toY(city.bounds.minZ));
        mapCtx.lineTo(toX(line), toY(city.bounds.maxZ));
        mapCtx.moveTo(toX(city.bounds.minX), toY(line));
        mapCtx.lineTo(toX(city.bounds.maxX), toY(line));
      }
      mapCtx.stroke();

      // Pedestrians: small grey dots.
      mapCtx.fillStyle = '#8a94a0';
      for (const ped of pedestrians.list) {
        mapCtx.beginPath();
        mapCtx.arc(toX(ped.pos.x), toY(ped.pos.z), 2, 0, Math.PI * 2);
        mapCtx.fill();
      }

      // Cars: pale dots, the driven one white and bigger.
      for (const car of vehicles.cars) {
        if (car === vehicles.driven) continue;
        mapCtx.fillStyle = '#c8d2dc';
        mapCtx.beginPath();
        mapCtx.arc(toX(car.group.position.x), toY(car.group.position.z), 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      if (vehicles.driven) {
        mapCtx.fillStyle = '#ffffff';
        mapCtx.beginPath();
        mapCtx.arc(
          toX(vehicles.driven.group.position.x),
          toY(vehicles.driven.group.position.z),
          4, 0, Math.PI * 2,
        );
        mapCtx.fill();
      }

      // Police cruisers: flashing red / blue dots.
      const redOn = Math.floor(wanted.flashTime * 4) % 2 === 0;
      mapCtx.fillStyle = redOn ? '#ff3b30' : '#2f7bff';
      for (const cruiser of wanted.cruisers) {
        mapCtx.beginPath();
        mapCtx.arc(toX(cruiser.group.position.x), toY(cruiser.group.position.z), 4, 0, Math.PI * 2);
        mapCtx.fill();
      }

      // Mission beacons: yellow for a job marker, orange and pulsing for
      // the active step's target. A white halo keeps them readable where
      // they sit on top of a pale road line.
      const pulse = Math.sin(world.time * 4) * 0.5 + 0.5;
      for (const beacon of missions.beacons()) {
        const x = toX(beacon.x);
        const y = toY(beacon.z);
        mapCtx.fillStyle = 'rgba(255,255,255,0.85)';
        mapCtx.beginPath();
        mapCtx.arc(x, y, (beacon.kind === 'step' ? 5 : 4) + 2, 0, Math.PI * 2);
        mapCtx.fill();
        if (beacon.kind === 'step') {
          mapCtx.strokeStyle = 'rgba(255, 159, 28, 0.8)';
          mapCtx.lineWidth = 2;
          mapCtx.beginPath();
          mapCtx.arc(x, y, 7 + pulse * 3, 0, Math.PI * 2);
          mapCtx.stroke();
          mapCtx.fillStyle = '#ff9f1c';
        } else {
          mapCtx.fillStyle = '#ffd23f';
        }
        mapCtx.beginPath();
        mapCtx.arc(x, y, beacon.kind === 'step' ? 5 : 4, 0, Math.PI * 2);
        mapCtx.fill();
      }

      // The player: a white arrow, pointing where they face. While driving
      // the arrow follows the car's yaw instead of the on-foot heading.
      const heading = vehicles.driven ? vehicles.driven.yaw : player.heading;
      mapCtx.save();
      mapCtx.translate(toX(player.pos.x), toY(player.pos.z));
      mapCtx.rotate(Math.PI - heading);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.strokeStyle = 'rgba(0,0,0,0.6)';
      mapCtx.lineWidth = 1.5;
      mapCtx.beginPath();
      mapCtx.moveTo(0, -9);
      mapCtx.lineTo(6, 7);
      mapCtx.lineTo(-6, 7);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.restore();

      mapCtx.restore();

      // The rim of the circle, drawn over the clipped map.
      mapCtx.strokeStyle = 'rgba(255,255,255,0.75)';
      mapCtx.lineWidth = 3;
      mapCtx.beginPath();
      mapCtx.arc(half, half, half - 2, 0, Math.PI * 2);
      mapCtx.stroke();
    },

    /** One tick of HUD work: the bar, the toast timer, the crosshair and
     * the minimap. Called from the main loop while playing. */
    update(dt) {
      hud.refreshBar();
      if (hud.toastTime > 0) {
        hud.toastTime -= dt;
        if (hud.toastTime <= 0) {
          const node = el('toast');
          if (node) node.textContent = '';
        }
      }
      if (crosshair) {
        crosshair.style.display = world.state === 'playing' ? '' : 'none';
      }
      hud.drawMinimap();
    },
  };

  return hud;
}
