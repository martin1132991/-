
export class AudioService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterGain: GainNode | null = null;

  constructor() {
    // Initialize on user interaction usually, but we prep the class
  }

  private init() {
    if (!this.ctx) {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = 0.3; // Default volume
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMute(mute: boolean) {
    this.isMuted = mute;
    if (this.masterGain) {
      this.masterGain.gain.value = mute ? 0 : 0.3;
    }
  }

  toggleMute() {
    this.setMute(!this.isMuted);
    return this.isMuted;
  }

  // --- Sound Generators ---

  playClick() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playSelect() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(500, this.ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playCardSlide() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    // Use white noise buffer for "swish" sound
    const bufferSize = this.ctx.sampleRate * 0.2; // 200ms
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + 0.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start();
  }

  playTakeRow() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  playAlert() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, this.ctx.currentTime);
    osc.frequency.setValueAtTime(300, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playFanfare() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major Arpeggio
    let time = this.ctx.currentTime;

    notes.forEach((note, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.type = 'triangle';
      osc.frequency.value = note;
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.3, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(time);
      osc.stop(time + 0.4);
      time += 0.1;
    });
  }
}

export const audioService = new AudioService();
