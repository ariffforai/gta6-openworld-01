// Synthesised sound for SOLMAR: every sound is made with WebAudio, no audio files.
// Engine hum, gunshots, sirens, pickups, a two-note wanted sting and a looping
// synth bass-and-pad groove. Created lazily on first user gesture.
export class SoundBank {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenOn = false;
    this.musicTimer = null; this.musicStep = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // Engine: a sawtooth through a low-pass, pitch follows speed.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    // Siren: two alternating tones, quiet, panned by the game calling setSiren.
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 720;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.startMusic();
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
  setEngine(speed01, driving) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(driving ? 0.045 + speed01 * 0.05 : 0, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + speed01 * 165, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(380 + speed01 * 900, t, 0.1);
  }
  setSiren(on, dt) {
    if (!this.ctx) return;
    this.sirenOn = on;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.035 : 0, t, 0.2);
    if (on) {
      const phase = (performance.now() / 450) % 2;
      this.sirenOsc.frequency.setTargetAtTime(phase < 1 ? 720 : 960, t, 0.05);
    }
  }
  blip(freq, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, filterFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  gunshot() { this.noise(0.14, 0.5, 2600); this.blip(160, 0.09, 'square', 0.18, 60); }
  enemyShot() { this.noise(0.1, 0.22, 2000); }
  pickup() { this.blip(660, 0.1, 'sine', 0.22); setTimeout(() => this.blip(990, 0.16, 'sine', 0.22), 90); }
  cash() { this.blip(880, 0.09, 'triangle', 0.22); setTimeout(() => this.blip(1174, 0.09, 'triangle', 0.22), 80); setTimeout(() => this.blip(1568, 0.22, 'triangle', 0.22), 160); }
  crash() { this.noise(0.3, 0.5, 900); this.blip(90, 0.25, 'sine', 0.3, 40); }
  wantedSting() { this.blip(220, 0.18, 'sawtooth', 0.2, 330); setTimeout(() => this.blip(330, 0.3, 'sawtooth', 0.2, 220), 170); }
  missionDone() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.22), i * 110)); }
  wasted() { [392, 311, 233, 175].forEach((f, i) => setTimeout(() => this.blip(f, 0.4, 'sawtooth', 0.16), i * 220)); }
  // A slow sunset groove: Am – F – C – G pad roots with a soft bass pulse.
  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    const roots = [110, 87.31, 130.81, 98];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.musicStep++; return; }
      const step = this.musicStep++;
      const bar = Math.floor(step / 4) % 4;
      const root = roots[bar];
      if (step % 4 === 0) this.blip(root, 1.6, 'triangle', 0.05);
      if (step % 2 === 0) this.blip(root / 2, 0.5, 'sine', 0.09);
      if (step % 8 === 6) this.blip(root * 1.5, 0.5, 'sine', 0.045);
      if (step % 16 === 14) this.blip(root * 2, 0.9, 'sine', 0.04);
    }, 340);
  }
}
