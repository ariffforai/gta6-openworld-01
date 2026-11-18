// SOLMAR — HUD: the top bar (money, health, armour, wanted stars, ammo,
// speed), a live circular minimap, a crosshair, toasts and the objective
// line. The HUD owns every one of these elements; nothing else writes them.

export function createHud(deps) {
  const { world, player, vehicles, city, pedestrians, wanted, combat } = deps;
  const getBeacons = deps.getBeacons || (() => []);

  const el = (id) => document.getElementById(id);
  const moneyEl = el('money-value');
  const healthEl = el('health-value');
  const armourEl = el('armour-value');
  const starsEl = el('stars');
  const ammoEl = el('ammo-value');
  const speedEl = el('speed-value');
  const objectiveEl = el('objective-text');
  const toastEl = el('toast');
  const mapCanvas = el('minimap');
  const mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;

  // The crosshair is built here in JS: two thin bars centred on screen.
  const crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  crosshair.style.position = 'fixed';
  crosshair.style.left = '50%';
  crosshair.style.top = '50%';
  crosshair.style.width = '18px';
  crosshair.style.height = '18px';
  crosshair.style.marginLeft = '-9px';
  crosshair.style.marginTop = '-9px';
  crosshair.style.pointerEvents = 'none';
  crosshair.style.zIndex = '30';
  crosshair.style.display = 'none';
  const barH = document.createElement('div');
  barH.style.position = 'absolute';
  barH.style.left = '0';
  barH.style.top = '8px';
  barH.style.width = '18px';
  barH.style.height = '2px';
  barH.style.background = 'rgba(255,255,255,0.9)';
  barH.style.boxShadow = '0 0 3px rgba(0,0,0,0.8)';
  const barV = document.createElement('div');
  barV.style.position = 'absolute';
  barV.style.left = '8px';
  barV.style.top = '0';
  barV.style.width = '2px';
  barV.style.height = '18px';
  barV.style.background = 'rgba(255,255,255,0.9)';
  barV.style.boxShadow = '0 0 3px rgba(0,0,0,0.8)';
  crosshair.appendChild(barH);
  crosshair.appendChild(barV);
  document.body.appendChild(crosshair);

  let toastTimer = 0;
  // Start with the toast hidden until the first message arrives.
  if (toastEl && !toastEl.textContent) toastEl.style.display = 'none';

  function refresh() {
    if (moneyEl) moneyEl.textContent = `$${world.money}`;
    if (healthEl) healthEl.textContent = `${Math.round(player.health)}`;
    if (armourEl) armourEl.textContent = `${Math.round(player.armour || 0)}`;
    world.wanted = wanted.level;
    if (starsEl) {
      starsEl.textContent = '★'.repeat(world.wanted) + '☆'.repeat(5 - world.wanted);
    }
    if (ammoEl) {
      ammoEl.textContent = combat.reloading ? 'RELOADING…' : `AMMO ${combat.ammo}`;
    }
    if (speedEl) {
      const kmh = Math.abs(vehicles.driven ? vehicles.driven.speed : player.speed) * 3.6;
      speedEl.textContent = `${Math.round(kmh)} km/h`;
    }
  }

  function drawMinimap() {
    if (!mapCtx || !mapCanvas) return;
    const W = mapCanvas.width;
    const H = mapCanvas.height;
    const b = city.bounds;
    const scale = Math.min(W / (b.maxX - b.minX), H / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * scale) / 2;
    const oy = (H - (b.maxZ - b.minZ) * scale) / 2;
    const toX = (x) => ox + (x - b.minX) * scale;
    const toY = (z) => oy + (z - b.minZ) * scale;

    mapCtx.save();
    mapCtx.clearRect(0, 0, W, H);
    // Clip everything to the circle.
    mapCtx.beginPath();
    mapCtx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    mapCtx.clip();
    mapCtx.fillStyle = '#0e2233';
    mapCtx.fillRect(0, 0, W, H);

    // Road grid.
    mapCtx.strokeStyle = 'rgba(255,255,255,0.30)';
    mapCtx.lineWidth = 3;
    mapCtx.beginPath();
    for (const line of city.roadLines) {
      mapCtx.moveTo(toX(line), 0);
      mapCtx.lineTo(toX(line), H);
      mapCtx.moveTo(0, toY(line));
      mapCtx.lineTo(W, toY(line));
    }
    mapCtx.stroke();

    // Pedestrians: small pale dots.
    mapCtx.fillStyle = '#b0bec5';
    for (const ped of pedestrians.list) {
      mapCtx.fillRect(toX(ped.pos.x) - 1.5, toY(ped.pos.z) - 1.5, 3, 3);
    }

    // Cars: traffic amber, parked grey, the driven car white and bigger.
    for (const car of vehicles.cars) {
      const x = toX(car.group.position.x);
      const y = toY(car.group.position.z);
      if (car === vehicles.driven) {
        mapCtx.fillStyle = '#ffffff';
        mapCtx.fillRect(x - 3, y - 3, 6, 6);
      } else if (car.isTraffic) {
        mapCtx.fillStyle = '#ffd54f';
        mapCtx.fillRect(x - 2, y - 2, 4, 4);
      } else {
        mapCtx.fillStyle = '#78909c';
        mapCtx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    // Police cruisers flash red / blue.
    const flashRed = Math.floor(world.time * 3) % 2 === 0;
    for (const cruiser of wanted.cruisers) {
      if (cruiser.disabled) continue;
      mapCtx.fillStyle = flashRed ? '#ff5252' : '#448aff';
      const x = toX(cruiser.group.position.x);
      const y = toY(cruiser.group.position.z);
      mapCtx.fillRect(x - 3, y - 3, 6, 6);
    }

    // Mission beacons: a white pulsing halo around a coloured core.
    for (const beacon of getBeacons()) {
      const x = toX(beacon.x);
      const y = toY(beacon.z);
      const pulse = 8 + 2.5 * Math.sin(world.time * 4);
      mapCtx.beginPath();
      mapCtx.arc(x, y, pulse, 0, Math.PI * 2);
      mapCtx.fillStyle = 'rgba(255,255,255,0.55)';
      mapCtx.fill();
      mapCtx.beginPath();
      mapCtx.arc(x, y, 4, 0, Math.PI * 2);
      mapCtx.fillStyle = `#${beacon.color.toString(16).padStart(6, '0')}`;
      mapCtx.fill();
    }

    // Player arrow: points along the heading, or the car's yaw while driving.
    // Canvas y grows downwards with +z, so the arrow's rotation is PI - yaw:
    // yaw 0 faces +z (down), yaw PI/2 faces +x (right), yaw PI faces -z (up).
    const yaw = vehicles.driven ? vehicles.driven.yaw : player.heading;
    const px = toX(player.pos.x);
    const py = toY(player.pos.z);
    mapCtx.translate(px, py);
    mapCtx.rotate(Math.PI - yaw);
    mapCtx.beginPath();
    mapCtx.moveTo(0, -8);
    mapCtx.lineTo(5.5, 6);
    mapCtx.lineTo(0, 3);
    mapCtx.lineTo(-5.5, 6);
    mapCtx.closePath();
    mapCtx.fillStyle = '#ffffff';
    mapCtx.fill();
    mapCtx.strokeStyle = 'rgba(0,0,0,0.7)';
    mapCtx.lineWidth = 1;
    mapCtx.stroke();
    mapCtx.restore();

    // Crisp ring around the circle.
    mapCtx.beginPath();
    mapCtx.arc(W / 2, H / 2, W / 2 - 1.5, 0, Math.PI * 2);
    mapCtx.strokeStyle = 'rgba(255,255,255,0.65)';
    mapCtx.lineWidth = 2;
    mapCtx.stroke();
  }

  const hud = {
    // The objective line is only ever written through here.
    setObjective(text) {
      if (!objectiveEl) return;
      objectiveEl.textContent = text;
      objectiveEl.dataset.locked = '1';
    },

    toast(text) {
      if (!toastEl) return;
      toastEl.textContent = text;
      toastEl.style.display = '';
      toastTimer = 3;
    },

    update(dt) {
      refresh();
      drawMinimap();
      crosshair.style.display = world.state === 'playing' ? 'block' : 'none';
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0 && toastEl) toastEl.style.display = 'none';
      }
    },
  };

  return hud;
}
