export const RINGTONES = [
  { id: 'classic', label: 'Classic Bell', emoji: '🔔' },
  { id: 'whatsapp', label: 'WhatsApp Ping', emoji: '💬' },
  { id: 'melody', label: 'Melody', emoji: '🎵' },
  { id: 'cute', label: 'Cute Tune', emoji: '🎶' },
  { id: 'alert', label: 'Sharp Alert', emoji: '🎺' },
  { id: 'silent', label: 'Silent', emoji: '🔕' },
] as const;

export type RingtoneId = typeof RINGTONES[number]['id'];

export function playRingtone(id: string) {
  if (id === 'silent' || typeof window === 'undefined') return;
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, start: number, dur: number, vol = 0.3, type: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.04);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };

    if (id === 'classic') {
      tone(880, 0, 0.15);
      tone(1100, 0.18, 0.15);
      tone(880, 0.36, 0.15);
      tone(1100, 0.54, 0.2);
    } else if (id === 'whatsapp') {
      tone(1318, 0, 0.08, 0.25);
      tone(1318, 0.12, 0.08, 0.25);
    } else if (id === 'melody') {
      tone(523, 0, 0.12);
      tone(659, 0.15, 0.12);
      tone(784, 0.3, 0.12);
      tone(1047, 0.45, 0.2);
    } else if (id === 'cute') {
      tone(784, 0, 0.1);
      tone(988, 0.12, 0.1);
      tone(1175, 0.24, 0.1);
      tone(988, 0.36, 0.1);
      tone(1175, 0.48, 0.18);
    } else if (id === 'alert') {
      tone(1480, 0, 0.08, 0.4, 'square');
      tone(1480, 0.1, 0.08, 0.4, 'square');
      tone(1976, 0.2, 0.15, 0.35, 'square');
    }

    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Audio may be blocked by the browser or unavailable on the platform.
  }
}
