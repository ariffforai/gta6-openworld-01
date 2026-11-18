// SOLMAR audio: every sound is synthesised live with WebAudio — no audio
// files, no network, nothing fetched. The engine hum follows the driven
// car's speed, a two-tone siren runs while the player is wanted, gunshots
// and crashes are shaped noise, payouts chime, and a low bass-and-hat
// groove plays on the menu and while driving around. Sound only starts
// after a user gesture (the start button), per browser autoplay rules,
// and M toggles mute. All variation comes from a seeded noise buffer and
// fixed note patterns, never from Math.random or the clock.

import { mulberry32 } from './util.js';

const NOISE_SEED = 7;
const MASTER_LEVEL = 0.5;
const ENGINE_BASE = 52;
const ENGINE_TOP = 196;
const SIREN_BASE = 720;
const SIREN_SWING = 190;

// A 16-step bass groove in A minor (MIDI notes, 0 = rest), one bar looped.
const BASS_LINE = [45, 0, 45, 0, 48, 0, 45, 0, 43, 0, 43, 0, 50, 0, 48, 47];
const STEP_SECONDS = 0.24;
// Hats tick on the off-beats of the same 16-step bar.
const HAT_STEPS = [2, 6, 10, 14];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  // Persistent loops, built once the context exists.
  let engineOsc = null;
  let engineSub = null;
  let engineFilter = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenLfo = null;
  let sirenGain = null;

  // Music sequencer state, advanced from update() only.
  let musicStep = 0;
  let stepTimer = 0;

  const audio = {
    muted: false,
    // Counters so playtests can prove a sound fired without listening.
    stats: { shots: 0, crashes: 0, chimes: 0, unlocks: 0 },

    get ready() {
      return !!ctx && ctx.state === 'running';
    },

    /** 'missing' | 'suspended' | 'running' — for playtests and debugging. */
    get contextState() {
      return ctx ? ctx.state : 'missing';
    },

    /** Create (or resume) the context. Call from a user gesture only. */
    unlock() {
      audio.stats.unlocks += 1;
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
      } catch {
        ctx = null;
        return;
      }
      master = ctx.createGain();
      master.gain.value = audio.muted ? 0 : MASTER_LEVEL;
      master.connect(ctx.destination);

      // One seeded noise buffer, reused by every noise-based sound.
      const rng = mulberry32(NOISE_SEED);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = rng() * 2 - 1;

      // Engine: a sawtooth plus a sub-octave square through one lowpass.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = ENGINE_BASE;
      engineSub = ctx.createOscillator();
      engineSub.type = 'square';
      engineSub.frequency.value = ENGINE_BASE / 2;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineFilter.Q.value = 1.2;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineSub.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineSub.start();

      // Siren: a square wave whose pitch swings up and down on an LFO,
      // the classic two-tone wail, kept quiet behind the engine.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = SIREN_BASE;
      sirenLfo = ctx.createOscillator();
      sirenLfo.type = 'sine';
      sirenLfo.frequency.value = 0.55;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = SIREN_SWING;
      sirenLfo.connect(lfoGain);
      lfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      sirenLfo.start();
    },

    setMuted(mute) {
      audio.muted = !!mute;
      if (master) {
        master.gain.setTargetAtTime(
          audio.muted ? 0 : MASTER_LEVEL,
          ctx.currentTime,
          0.02,
        );
      }
    },

    toggleMute() {
      audio.setMuted(!audio.muted);
      return audio.muted;
    },

    /** Silence the loops at once (pause, wasted, busted). */
    silence() {
      if (!ctx) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(0, t, 0.03);
      sirenGain.gain.setTargetAtTime(0, t, 0.03);
    },

    /** Per-tick driver: engine from speed, siren from wanted level. */
    update(dt, opts) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const speed01 = Math.max(0, Math.min(1, opts.speed01 || 0));
      const driving = !!opts.driving;
      const engineLevel = driving ? 0.035 + 0.085 * speed01 : 0;
      engineGain.gain.setTargetAtTime(engineLevel, t, 0.08);
      const freq = ENGINE_BASE + speed01 * (ENGINE_TOP - ENGINE_BASE);
      engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
      engineSub.frequency.setTargetAtTime(freq / 2, t, 0.08);
      engineFilter.frequency.setTargetAtTime(420 + speed01 * 1300, t, 0.1);
      const sirenLevel = (opts.wantedLevel || 0) >= 1 ? 0.035 : 0;
      sirenGain.gain.setTargetAtTime(sirenLevel, t, 0.15);
      if (opts.music) audio._musicStep(dt);
    },

    /** Advance the groove one frame; schedules notes due this frame. */
    _musicStep(dt) {
      if (!ctx) return;
      stepTimer += dt;
      while (stepTimer >= STEP_SECONDS) {
        stepTimer -= STEP_SECONDS;
        audio._playStep(musicStep);
        musicStep = (musicStep + 1) % BASS_LINE.length;
      }
    },

    _playStep(step) {
      const now = ctx.currentTime;
      const note = BASS_LINE[step];
      if (note > 0) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(note);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + STEP_SECONDS * 0.95);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + STEP_SECONDS);
      }
      if (HAT_STEPS.indexOf(step) >= 0) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 6000;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(now, 0.31);
        src.stop(now + 0.06);
      }
    },

    /** A pistol shot: a short band-passed noise crack plus a low thump. */
    gunshot() {
      audio.stats.shots += 1;
      if (!ctx) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 950;
      filter.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(now, 0.11);
      src.stop(now + 0.18);

      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(170, now);
      thump.frequency.exponentialRampToValueAtTime(58, now + 0.09);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.32, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      thump.connect(thumpGain);
      thumpGain.connect(master);
      thump.start(now);
      thump.stop(now + 0.12);
    },

    /** A hard impact: low sine drop plus a low-passed noise thud. */
    crash(strength) {
      const s = Math.max(0.2, Math.min(1, strength || 0.6));
      audio.stats.crashes += 1;
      if (!ctx) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.42 * s, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(now, 0.53);
      src.stop(now + 0.32);

      const drop = ctx.createOscillator();
      drop.type = 'sine';
      drop.frequency.setValueAtTime(78, now);
      drop.frequency.exponentialRampToValueAtTime(32, now + 0.26);
      const dropGain = ctx.createGain();
      dropGain.gain.setValueAtTime(0.5 * s, now);
      dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      drop.connect(dropGain);
      dropGain.connect(master);
      drop.start(now);
      drop.stop(now + 0.32);
    },

    /** Two bright notes for a payout or a completed job. */
    chime() {
      audio.stats.chimes += 1;
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [659.25, 880.0];
      for (let i = 0; i < notes.length; i += 1) {
        const at = now + i * 0.1;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = notes[i];
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.55);
        osc.connect(gain);
        gain.connect(master);
        osc.start(at);
        osc.stop(at + 0.6);
      }
    },
  };

  return audio;
}
