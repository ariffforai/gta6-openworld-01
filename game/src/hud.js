// HUD for SOLMAR: money, health, wanted stars, objective line, speedometer,
// crosshair, toasts and the circular minimap drawn on a 2D canvas.
import { clamp } from './util.js';
import { CITY_R, BLOCK, GRID } from './city.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      money: document.getElementById('money'),
      missionlabel: document.getElementById('missionlabel'),
      healthfill: document.getElementById('healthfill'),
      armorfill: document.getElementById('armorfill'),
      wanted: document.getElementById('wanted'),
      objective: document.getElementById('objective'),
      minimap: document.getElementById('minimap'),
      speedo: document.getElementById('speedo'),
      ammo: document.getElementById('ammo'),
      crosshair: document.getElementById('crosshair'),
      toast: document.getElementById('toast'),
      hint: document.getElementById('hint'),
      interact: document.getElementById('interact'),
      bigmsg: document.getElementById('bigmsg'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastT = 0;
    this.bigT = 0;
  }
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }
  setMoney(n, district) {
    this.el.money.firstChild.textContent = '$' + n.toLocaleString('en-US');
    this.el.missionlabel.textContent = district || 'SOLMAR';
  }
  setHealth(h, armor) {
    this.el.healthfill.style.width = clamp(h, 0, 100) + '%';
    this.el.healthfill.style.background = h > 50
      ? 'linear-gradient(90deg,#37d67a,#a5f2b0)'
      : h > 25 ? 'linear-gradient(90deg,#f7c948,#ffd98a)' : 'linear-gradient(90deg,#e84a3f,#ff8a7a)';
    this.el.armorfill.style.width = clamp(armor, 0, 100) + '%';
  }
  setWanted(stars) {
    const spans = this.el.wanted.querySelectorAll('.star');
    spans.forEach((s, i) => s.classList.toggle('lit', i < stars));
  }
  setObjective(text) { this.el.objective.textContent = text; }
  setSpeed(mph, driving) {
    this.el.speedo.classList.toggle('hidden', !driving);
    if (driving) this.el.speedo.firstChild.textContent = Math.round(mph);
  }
  setArmed(armed) {
    this.el.crosshair.classList.toggle('hidden', !armed);
    this.el.ammo.classList.toggle('hidden', !armed);
  }
  setHint(text) { this.el.hint.textContent = text || ''; }
  setInteract(text) {
    this.el.interact.classList.toggle('hidden', !text);
    if (text) this.el.interact.textContent = text;
  }
  toast(text, seconds) {
    this.el.toast.textContent = text;
    this.toastT = seconds || 3.5;
  }
  big(text, sub, seconds) {
    this.el.bigmsg.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    this.el.bigmsg.classList.remove('hidden');
    this.bigT = seconds || 2.6;
  }
  tick(dt) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.textContent = '';
    }
    if (this.bigT > 0) {
      this.bigT -= dt;
      if (this.bigT <= 0) this.el.bigmsg.classList.add('hidden');
    }
  }
  // Top-down map: roads, beach, player arrow, traffic, police, peds, marker.
  drawMinimap(state) {
    const ctx = this.mapCtx;
    const S = 190, C = S / 2;
    const scale = S / (CITY_R * 2 + 140);
    const toMap = (x, z) => [C + x * scale, C + z * scale];
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#0d1a2e'; ctx.fillRect(0, 0, S, S);
    // Beach + sea.
    ctx.fillStyle = '#e8d29a';
    const [bx0, by0] = toMap(-CITY_R - 60, CITY_R - 6);
    ctx.fillRect(0, by0, S, S - by0);
    ctx.fillStyle = '#1e7fa8';
    const [, by1] = toMap(0, CITY_R + 70);
    ctx.fillRect(0, by1, S, S - by1);
    // Roads.
    ctx.strokeStyle = '#4a4f5a'; ctx.lineWidth = 5;
    for (let i = -GRID; i <= GRID; i++) {
      const [x0, y0] = toMap(i * BLOCK, -CITY_R - 40);
      const [x1, y1] = toMap(i * BLOCK, CITY_R + 40);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const [zx0, zy0] = toMap(-CITY_R - 40, i * BLOCK);
      const [zx1, zy1] = toMap(CITY_R + 40, i * BLOCK);
      ctx.beginPath(); ctx.moveTo(zx0, zy0); ctx.lineTo(zx1, zy1); ctx.stroke();
    }
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const p of state.peds) dot(p.x, p.z, 1.4, '#c9d6e8');
    for (const c of state.traffic) dot(c.x, c.z, 2, '#ffd23e');
    for (const c of state.police) {
      const [mx, my] = toMap(c.x, c.z);
      ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (state.marker) {
      const [mx, my] = toMap(state.marker.x, state.marker.z);
      const pulse = 5 + Math.sin(state.now * 5) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(mx, my, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Cash stashes still out there, as small gold diamonds.
    if (state.stashes) {
      for (const s of state.stashes) {
        const [mx, my] = toMap(s.x, s.z);
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath();
        ctx.moveTo(mx, my - 3); ctx.lineTo(mx + 3, my); ctx.lineTo(mx, my + 3); ctx.lineTo(mx - 3, my);
        ctx.closePath(); ctx.fill();
      }
    }
    // Player arrow, rotated to heading.
    const [px, py] = toMap(state.player.x, state.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(state.player.heading);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    ctx.restore();
    // North tick.
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', C, 13);
  }
}
