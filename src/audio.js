// Procedural music + sound effects with the Web Audio API (no audio files needed).

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const TRACKS = {
  explore: {
    bpm: 116,
    chords: [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67], [59, 62, 67], [57, 60, 65], [59, 62, 67]],
    bass: [36, 43, 45, 41, 36, 43, 41, 43],
    melody: [
      [76, 0, 79, 0, 84, 0, 79, 76],
      [74, 0, 79, 0, 83, 81, 79, 0],
      [72, 0, 76, 0, 81, 0, 79, 76],
      [77, 76, 74, 72, 74, 0, 0, 0],
      [76, 0, 79, 0, 84, 0, 86, 84],
      [83, 0, 81, 79, 81, 0, 79, 0],
      [77, 0, 81, 0, 84, 83, 81, 79],
      [79, 0, 77, 0, 74, 0, 71, 0],
    ],
    kick: [0, 8, 10],
    snare: [4, 12],
    hatEvery: 2,
    bassPattern: [0, 3, 6, 8, 11, 14],
  },
  boss: {
    bpm: 142,
    chords: [[57, 60, 64], [57, 60, 65], [55, 59, 62], [56, 59, 64], [57, 60, 64], [57, 60, 65], [55, 59, 62], [56, 59, 64]],
    bass: [33, 29, 31, 28, 33, 29, 31, 28],
    melody: [
      [69, 72, 76, 72, 81, 76, 72, 69],
      [69, 72, 77, 72, 81, 77, 72, 69],
      [71, 74, 79, 74, 83, 79, 74, 71],
      [68, 71, 76, 71, 80, 76, 71, 68],
      [81, 0, 79, 0, 76, 0, 72, 74],
      [77, 0, 76, 0, 72, 0, 69, 72],
      [74, 0, 79, 0, 83, 0, 86, 83],
      [80, 0, 83, 0, 88, 0, 0, 0],
    ],
    kick: [0, 4, 8, 12, 14],
    snare: [4, 12],
    hatEvery: 1,
    bassPattern: [0, 2, 4, 6, 8, 10, 12, 14],
  },
};

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.5;
    this.sfxVol = 0.8;
    this.track = 'explore';
    this.pending = null;
    this.step = 0;
    this.loop = 0;
    this.last = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVol;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);

    // Small hall reverb shared by music and effects.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    const nlen = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    const real = new Float32Array(32), imag = new Float32Array(32);
    for (let n = 1; n < 32; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25); // 25% pulse
    this.pulse = ctx.createPeriodicWave(real, imag);

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  setMusicVolume(v) {
    this.musicVol = v;
    if (this.music) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v) {
    this.sfxVol = v;
    if (this.sfx) this.sfx.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setTrack(name) {
    if (name !== this.track) this.pending = name;
  }

  // ---------------------------------------------------------------- sequencer
  _schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (this.step % 16 === 0 && this.pending) {
        this.track = this.pending;
        this.pending = null;
        this.step = 0;
        this.loop = 0;
      }
      this._playStep(this.step, this.nextTime);
      const tr = TRACKS[this.track];
      this.nextTime += 60 / tr.bpm / 4;
      this.step++;
      if (this.step >= 16 * tr.chords.length) {
        this.step = 0;
        this.loop++;
      }
    }
  }

  _playStep(step, t) {
    const tr = TRACKS[this.track];
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const sixteenth = 60 / tr.bpm / 4;
    const chord = tr.chords[bar];
    const boss = this.track === 'boss';

    if (s === 0) this._pad(chord, t, sixteenth * 16);
    if (tr.bassPattern.includes(s)) {
      const root = tr.bass[bar];
      this._bass(mtof(root + (s === 6 || s === 14 ? 12 : 0)), t, sixteenth * (boss ? 1.6 : 2.2));
    }
    // Arpeggio.
    const arpNotes = [chord[0], chord[1], chord[2], chord[0] + 12];
    const arpIdx = boss ? s % 4 : [0, 1, 2, 3, 2, 1][s % 6] ?? 0;
    if (boss || s % 2 === 0) this._arp(mtof(arpNotes[arpIdx] + 12), t, sixteenth * 0.9, boss ? 0.035 : 0.04);

    // Melody (every other pass in explore so it doesn't get tiring).
    const playMelody = boss || this.loop % 2 === 0;
    if (s % 2 === 0) {
      const line = tr.melody[bar];
      const i = s / 2;
      const note = line[i];
      if (note) {
        let hold = 1;
        while (i + hold < 8 && line[i + hold] === 0) hold++;
        const dur = sixteenth * 2 * hold * 0.85;
        if (playMelody) this._lead(mtof(note), t, dur, boss ? 0.075 : 0.07);
        else if (i % 2 === 0) this._bell(mtof(note), t, dur, 0.045);
      }
    }
    // Drums.
    if (tr.kick.includes(s)) this._kick(t, boss ? 1 : 0.8);
    if (tr.snare.includes(s)) this._snare(t, boss ? 0.5 : 0.38);
    if (s % tr.hatEvery === 0) this._hat(t, s % 4 === 2 ? 0.12 : 0.06);
    if (boss && s === 15 && bar % 2 === 1) this._snare(t, 0.3);
  }

  _env(g, t, a, peak, dur, rel = 0.08) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * 0.6, t + a, dur * 0.4);
    g.gain.setTargetAtTime(0.0001, t + dur, rel);
  }

  _pad(chord, t, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.track === 'boss' ? 1400 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.25);
    g.gain.setTargetAtTime(0.0001, t + dur - 0.1, 0.15);
    lp.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const n of chord) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.6);
      }
    }
  }

  _bass(f, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(250, t + dur);
    lp.Q.value = 4;
    const g = ctx.createGain();
    this._env(g, t, 0.005, 0.22, dur, 0.04);
    o.connect(lp);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(this.music);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.3); o2.stop(t + dur + 0.3);
  }

  _arp(f, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _lead(f, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.pulse);
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.008, t + Math.min(dur, 0.4));
    vib.connect(vg).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    this._env(g, t, 0.01, vol, dur, 0.06);
    o.connect(lp).connect(g);
    g.connect(this.music);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(this.reverb);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.4); vib.stop(t + dur + 0.4);
  }

  _bell(f, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 3.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.7); o2.stop(t + dur + 0.7);
  }

  _kick(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.35);
  }

  _noise(t, dur, type, freq, vol, dest, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return { src, f, g };
  }

  _snare(t, vol) {
    this._noise(t, 0.16, 'bandpass', 1900, vol, this.music, 0.7);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, vol) {
    this._noise(t, 0.04, 'highpass', 7500, vol, this.music);
  }

  // ---------------------------------------------------------------- sound effects
  _tone(type, f0, f1, dur, vol, t = this.ctx.currentTime, dest = this.sfx) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  play(name, opt = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Throttle very frequent sounds.
    const minGap = { coin: 0.045, enemyHit: 0.04, step: 0.05, hurt: 0.15 }[name] ?? 0;
    if (minGap && this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    const t = now;
    const v = opt.vol ?? 1;
    switch (name) {
      case 'punch':
        this._tone('sine', 180, 50, 0.14, 0.6 * v);
        this._noise(t, 0.08, 'lowpass', 1400, 0.35 * v, this.sfx);
        break;
      case 'slice':
        this._noise(t, 0.22, 'bandpass', 3000, 0.4 * v, this.sfx, 2).f.frequency.exponentialRampToValueAtTime(800, t + 0.2);
        this._tone('triangle', 2400, 2200, 0.25, 0.06 * v);
        break;
      case 'blast':
        this._tone('square', 900, 180, 0.18, 0.18 * v);
        this._tone('sine', 300, 80, 0.2, 0.3 * v);
        break;
      case 'laser': {
        const o = this._tone('sawtooth', 1600, 400, 0.35, 0.12 * v);
        o.detune.value = 10;
        this._tone('sine', 2200, 600, 0.3, 0.1 * v);
        break;
      }
      case 'dash':
        this._noise(t, 0.3, 'bandpass', 600, 0.5 * v, this.sfx, 1.5).f.frequency.exponentialRampToValueAtTime(3500, t + 0.25);
        break;
      case 'jump':
        this._tone('square', 300, 700, 0.15, 0.08 * v);
        break;
      case 'land':
        this._noise(t, 0.08, 'lowpass', 500, 0.25 * v, this.sfx);
        break;
      case 'coin': {
        const p = opt.pitch ?? 1;
        this._tone('square', 988 * p, 988 * p, 0.07, 0.07 * v, t);
        this._tone('square', 1319 * p, 1319 * p, 0.22, 0.07 * v, t + 0.07);
        break;
      }
      case 'heal':
        [523, 659, 784, 1047].forEach((f, i) => this._tone('sine', f, f, 0.18, 0.12 * v, t + i * 0.06));
        break;
      case 'enemyHit':
        this._tone('triangle', 520 + Math.random() * 200, 200, 0.1, 0.25 * v);
        this._noise(t, 0.06, 'highpass', 2500, 0.2 * v, this.sfx);
        break;
      case 'hurt':
        this._tone('sawtooth', 400, 120, 0.25, 0.18 * v);
        this._noise(t, 0.12, 'lowpass', 900, 0.3 * v, this.sfx);
        break;
      case 'enemyShoot':
        this._tone('square', 500, 250, 0.2, 0.08 * v);
        break;
      case 'explosion': {
        const big = opt.big ? 1 : 0.6;
        this._noise(t, 1.2 * big, 'lowpass', 1200, 0.9 * v * big, this.sfx).f.frequency.exponentialRampToValueAtTime(120, t + 1.0 * big);
        this._tone('sine', 120, 30, 0.6 * big, 0.8 * v * big);
        break;
      }
      case 'slam':
        this._tone('sine', 90, 28, 0.7, 1.0 * v);
        this._noise(t, 0.6, 'lowpass', 700, 0.8 * v, this.sfx);
        break;
      case 'rocket':
        this._noise(t, 0.6, 'bandpass', 400, 0.6 * v, this.sfx, 1).f.frequency.exponentialRampToValueAtTime(2500, t + 0.5);
        break;
      case 'superReady':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone('square', f, f, 0.12, 0.06 * v, t + i * 0.07));
        break;
      case 'super':
        this._tone('sawtooth', 200, 1200, 0.5, 0.15 * v);
        this._tone('square', 400, 1600, 0.5, 0.08 * v);
        this._noise(t, 0.6, 'bandpass', 1200, 0.3 * v, this.sfx);
        break;
      case 'starSlice':
        [1568, 1976, 2349, 3136].forEach((f, i) => this._tone('triangle', f, f, 0.3, 0.1 * v, t + i * 0.05));
        this._noise(t, 0.5, 'bandpass', 4000, 0.4 * v, this.sfx, 1).f.frequency.exponentialRampToValueAtTime(600, t + 0.45);
        break;
      case 'buy':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this._tone('square', f, f, 0.16, 0.08 * v, t + i * 0.09));
        break;
      case 'error':
        this._tone('square', 200, 150, 0.2, 0.1 * v);
        break;
      case 'click':
        this._tone('square', 800, 800, 0.04, 0.05 * v);
        break;
      case 'bossRoar': {
        const o = this._tone('sawtooth', 110, 55, 1.1, 0.35 * v);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 18;
        const lg = this.ctx.createGain();
        lg.gain.value = 25;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 1.2);
        this._noise(t, 1.0, 'lowpass', 600, 0.4 * v, this.sfx);
        break;
      }
      case 'victory':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this._tone('square', f, f, 0.25, 0.08 * v, t + i * 0.11));
        this._tone('sine', 1047, 1047, 1.2, 0.1 * v, t + 0.66);
        break;
      case 'death':
        [523, 494, 466, 440, 392].forEach((f, i) => this._tone('triangle', f, f, 0.3, 0.15 * v, t + i * 0.18));
        break;
      case 'alert':
        this._tone('square', 700, 1100, 0.08, 0.05 * v);
        break;
      default:
        break;
    }
  }

  // Sustained beam hum for Bob's super laser.
  startHum() {
    if (!this.ctx || this.hum) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 110;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 220.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lg = ctx.createGain();
    lg.gain.value = 600;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lfo.connect(lg).connect(lp.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.1);
    o.connect(lp); o2.connect(lp);
    lp.connect(g).connect(this.sfx);
    o.start(); o2.start(); lfo.start();
    this.hum = { o, o2, lfo, g };
  }

  stopHum() {
    if (!this.hum) return;
    const { o, o2, lfo, g } = this.hum;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.05);
    for (const n of [o, o2, lfo]) n.stop(t + 0.3);
    this.hum = null;
  }
}
