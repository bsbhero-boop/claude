// WebAudio로 합성하는 효과음. 외부 음원 파일 없이 동작한다.

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  volume = 0.8;
  private crowdLevel = 0.25;
  private crowdTarget = 0.25;

  /** 사용자 입력 이후 호출해야 소리가 난다 */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // 3초짜리 핑크 노이즈 버퍼
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    this.noiseBuf = buf;
    this.startCrowd();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private startCrowd() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start();
    this.crowdGain = g;
    this.crowdFilter = f;
  }

  /** 관중 소리 기본 세기 (0..1) */
  crowd(level: number) {
    this.crowdTarget = level;
  }

  update(dt: number) {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return;
    this.crowdLevel += (this.crowdTarget - this.crowdLevel) * Math.min(1, dt * 2);
    const t = this.ctx.currentTime;
    const wobble = 0.85 + 0.15 * Math.sin(t * 0.7) * Math.sin(t * 0.31);
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel * 0.55 * wobble, t, 0.1);
    this.crowdFilter.frequency.setTargetAtTime(450 + this.crowdLevel * 700, t, 0.2);
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', attack = 0.005, when = 0) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
    return { f, g, t };
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(power = 0.5) {
    this.tone(140 + power * 60, 0.09 + power * 0.05, 'sine', 0.35 + power * 0.4, 45);
    this.noise(0.05, 2500, 1, 0.15 + power * 0.2, 'highpass');
  }

  pass() {
    this.kick(0.25);
  }

  whistle(count = 1, long = false) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      const when = i * (long ? 0.55 : 0.32);
      const dur = long && i === count - 1 ? 0.9 : 0.22;
      const ctx = this.ctx;
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const lg = ctx.createGain();
      lg.gain.value = 180;
      lfo.connect(lg);
      lg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
    }
  }

  roar(size = 1) {
    this.noise(2.8 * size, 900, 0.5, 0.5 * size, 'bandpass', 0.15);
    this.noise(2.2 * size, 1800, 0.8, 0.22 * size, 'bandpass', 0.2);
  }

  ooh() {
    const n = this.noise(1.4, 500, 2, 0.32, 'bandpass', 0.15);
    if (n && this.ctx) {
      n.f.frequency.setValueAtTime(380, n.t);
      n.f.frequency.linearRampToValueAtTime(700, n.t + 0.5);
      n.f.frequency.linearRampToValueAtTime(420, n.t + 1.3);
    }
  }

  post() {
    this.tone(520, 0.5, 'triangle', 0.25, 480);
    this.tone(1310, 0.35, 'sine', 0.12, 1250);
  }

  net() {
    this.noise(0.4, 3000, 0.7, 0.25, 'highpass', 0.01);
  }

  tackle() {
    this.noise(0.12, 900, 1, 0.3, 'lowpass');
    this.tone(90, 0.12, 'sine', 0.3, 50);
  }

  charge() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 1.2);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.2);
    g.gain.setValueAtTime(0.18, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    o.connect(f);
    f.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + 1.4);
    this.noise(1.3, 6000, 2, 0.08, 'bandpass', 0.6);
  }

  boom(size = 1) {
    this.tone(70, 0.7 * size, 'sine', 0.6, 30);
    this.noise(0.6 * size, 400, 0.6, 0.5, 'lowpass', 0.005);
    this.noise(0.25, 3000, 0.5, 0.25, 'highpass', 0.002);
  }

  thunder() {
    this.noise(0.15, 4000, 0.4, 0.5, 'highpass', 0.001);
    this.noise(1.6, 180, 0.7, 0.55, 'lowpass', 0.05, 0.05);
  }

  whoosh() {
    const n = this.noise(0.6, 600, 1.5, 0.3, 'bandpass', 0.15);
    if (n) {
      n.f.frequency.setValueAtTime(300, n.t);
      n.f.frequency.exponentialRampToValueAtTime(3000, n.t + 0.5);
    }
  }

  freeze() {
    this.tone(2400, 0.5, 'sine', 0.12, 3800);
    this.tone(3200, 0.6, 'triangle', 0.08, 1600, 0.05);
    this.noise(0.5, 7000, 3, 0.12, 'bandpass', 0.01);
  }

  roarTiger() {
    const n = this.noise(1.0, 220, 3, 0.55, 'bandpass', 0.05);
    if (n) {
      n.f.frequency.setValueAtTime(160, n.t);
      n.f.frequency.linearRampToValueAtTime(420, n.t + 0.3);
      n.f.frequency.linearRampToValueAtTime(140, n.t + 0.95);
    }
    this.tone(85, 0.9, 'sawtooth', 0.12, 60);
  }

  click() {
    this.tone(880, 0.05, 'square', 0.06, 660);
  }

  select() {
    this.tone(660, 0.08, 'triangle', 0.12, 990);
    this.tone(990, 0.12, 'triangle', 0.08, 1320, 0.06);
  }

  perfect() {
    this.tone(1320, 0.12, 'triangle', 0.14, 1760);
    this.tone(1760, 0.18, 'sine', 0.1, 2640, 0.07);
  }

  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((f, i) => this.tone(f, i === notes.length - 1 ? 0.8 : 0.18, 'square', 0.07, undefined, i * 0.16));
    notes.forEach((f, i) => this.tone(f / 2, i === notes.length - 1 ? 0.8 : 0.18, 'triangle', 0.08, undefined, i * 0.16));
  }

  cardFlip() {
    this.noise(0.08, 2000, 1, 0.2, 'bandpass');
  }
}

export const audio = new AudioEngine();
