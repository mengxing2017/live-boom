// One trusted audio owner per output window. Plugin frames never own an AudioContext.
export class OutputAudio {
  private generation=0;
  private context: AudioContext | null = null;
  private nodes = new Set<AudioBufferSourceNode>();
  private buffers = new Map<string, AudioBuffer>();
  private speechIds = new Set<string>();
  unlocked = false;
  async unlock() { this.context ??= new AudioContext(); await this.context.resume(); this.unlocked = this.context.state === 'running'; }
  async play(uri: string, volume: number, loop: boolean) {
    if (!this.unlocked || !this.context || !uri.startsWith('data:audio/')) return;
    this.stopEffects(); const generation=this.generation;
    let buffer = this.buffers.get(uri);
    if (!buffer) {
      const raw = atob(uri.slice(uri.indexOf(',') + 1));
      buffer = await this.context.decodeAudioData(Uint8Array.from(raw, c => c.charCodeAt(0)).buffer);
      if (this.buffers.size >= 4) this.buffers.clear(); this.buffers.set(uri, buffer);
    }
    if(generation!==this.generation || this.context.state!=='running')return;
    const node = this.context.createBufferSource(), gain = this.context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume)); node.buffer = buffer; node.loop = loop;
    node.connect(gain); gain.connect(this.context.destination); this.nodes.add(node);
    node.onended = () => { this.nodes.delete(node); node.disconnect(); gain.disconnect(); }; node.start();
  }
  async say(text: string, lang: string, id: string, rate: number, volume: number, voiceName?: string) {
    if (!this.unlocked || !('speechSynthesis' in window) || this.speechIds.has(id) || this.speechIds.size >= 12) return;
    const voices = speechSynthesis.getVoices().filter(v => v.localService && v.lang.toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));
    const voice = voices.find(v => v.name === voiceName) ?? voices[0]; if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 160)); utterance.voice = voice;
    utterance.rate = Math.max(.5, Math.min(2, rate)); utterance.volume = Math.max(0, Math.min(1, volume));
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{this.speechIds.delete(id);resolve();},4000);
      this.speechIds.add(id); utterance.onend=utterance.onerror=()=>{clearTimeout(timer);this.speechIds.delete(id);resolve();};speechSynthesis.speak(utterance);
    });
  }
  stopEffects() { this.generation++; for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } } this.nodes.clear(); }
  stop() { this.stopEffects(); if ('speechSynthesis' in window) speechSynthesis.cancel(); this.speechIds.clear(); }
  dispose() { this.stop(); this.buffers.clear(); void this.context?.close(); }
}
