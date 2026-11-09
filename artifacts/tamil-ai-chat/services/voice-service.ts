import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { ALL_PERSONAS, type Persona } from '../constants/personas';

export interface VoiceProfile {
  id: string;
  name: string;
  characterId?: string;
  isBuiltIn: boolean;
  audioUri: string;
  referenceTranscript: string;
  cachedServerPath?: string;
}

export type VoiceMode = 'universal' | 'per_character';

export const MASTER_VOICE_1: VoiceProfile = {
  id: 'master_bae_calms_you',
  name: 'Bae - Calms You (சமாதானம் & அன்பு விஸ்பர்)',
  isBuiltIn: true,
  audioUri: 'bundled://voice_bae_calms_you.wav',
  referenceTranscript: 'சாரி டா. உன்னை காயப்படுத்தணும்னு நினைக்கல.',
  cachedServerPath: '/tmp/gradio/f94dc4ab4a60d841dea683a286b1be159e9dcdf6e8127ef685919342e9101f26/voice_bae_calms_you.wav',
};

export const MASTER_VOICE_2: VoiceProfile = {
  id: 'master_bae_comfort',
  name: 'Bae Comfort (காலை ஊக்கம் & இன்டர்வியூ ஆறுதல்)',
  isBuiltIn: true,
  audioUri: 'bundled://voice_bae_comfort.wav',
  referenceTranscript: 'குட் மார்னிங். இன்னைக்கு உன்னோட ஜாப் இன்டர்வியூ நல்லா நடக்கும்.',
  cachedServerPath: undefined,
};

const STORAGE_KEYS = {
  VOICE_ENABLED: 'mdw_voice_enabled_v1',
  VOICE_MODE: 'mdw_voice_mode_v1', // 'universal' | 'per_character'
  SELECTED_UNIVERSAL_VOICE: 'mdw_selected_universal_voice_v1',
  CHARACTER_VOICE_MAP: 'mdw_character_voice_map_v1',
  SERVER_PATH_CACHE: 'mdw_server_path_cache_v1',
};

const GRADIO_BASE = 'https://ai4bharat-indicf5.hf.space';

class VoiceService {
  private currentSound: Audio.Sound | null = null;
  private isSynthesizing = false;

  async isVoiceEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.VOICE_ENABLED);
      return val === 'true';
    } catch {
      return false;
    }
  }

  async setVoiceEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.VOICE_ENABLED, String(enabled));
  }

  async getVoiceMode(): Promise<VoiceMode> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.VOICE_MODE);
      return val === 'per_character' ? 'per_character' : 'universal';
    } catch {
      return 'universal';
    }
  }

  async setVoiceMode(mode: VoiceMode): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.VOICE_MODE, mode);
  }

  async getSelectedUniversalVoiceId(): Promise<string> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.SELECTED_UNIVERSAL_VOICE);
      return val || MASTER_VOICE_1.id;
    } catch {
      return MASTER_VOICE_1.id;
    }
  }

  async setSelectedUniversalVoiceId(id: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_UNIVERSAL_VOICE, id);
  }

  async getAllPersonas(): Promise<Persona[]> {
    try {
      const customRaw = await AsyncStorage.getItem('custom_personas_v1').catch(() => null);
      const customs: Persona[] = customRaw ? JSON.parse(customRaw) : [];
      return [...ALL_PERSONAS, ...customs];
    } catch {
      return ALL_PERSONAS;
    }
  }

  async getCharacterVoiceMap(): Promise<Record<string, VoiceProfile>> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.CHARACTER_VOICE_MAP);
      return val ? JSON.parse(val) : {};
    } catch {
      return {};
    }
  }

  async setCharacterVoice(characterId: string, profile: VoiceProfile): Promise<void> {
    const map = await this.getCharacterVoiceMap();
    map[characterId] = profile;
    await AsyncStorage.setItem(STORAGE_KEYS.CHARACTER_VOICE_MAP, JSON.stringify(map));
  }

  async removeCharacterVoice(characterId: string): Promise<void> {
    const map = await this.getCharacterVoiceMap();
    delete map[characterId];
    await AsyncStorage.setItem(STORAGE_KEYS.CHARACTER_VOICE_MAP, JSON.stringify(map));
  }

  async getVoiceForCharacter(characterId: string): Promise<VoiceProfile> {
    const mode = await this.getVoiceMode();
    if (mode === 'universal') {
      const universalId = await this.getSelectedUniversalVoiceId();
      if (universalId === MASTER_VOICE_2.id) return MASTER_VOICE_2;
      return MASTER_VOICE_1;
    }

    // Per-character mode
    const map = await this.getCharacterVoiceMap();
    if (map[characterId]) {
      return map[characterId];
    }

    // Default fallback to master voice 1
    return MASTER_VOICE_1;
  }

  // Gradio upload reference audio
  async uploadReferenceAudio(fileUri: string, fileName = 'ref.wav'): Promise<string> {
    // Check cached server path
    const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
    const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
    if (cache[fileUri]) {
      return cache[fileUri];
    }

    const formData = new FormData();
    formData.append('files', {
      uri: fileUri,
      name: fileName,
      type: 'audio/wav',
    } as any);

    const res = await fetch(`${GRADIO_BASE}/gradio_api/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Upload failed with status ${res.status}`);
    }

    const json = await res.json();
    if (!Array.isArray(json) || !json[0]) {
      throw new Error('Invalid response from IndicF5 upload');
    }

    const serverPath = json[0] as string;
    cache[fileUri] = serverPath;
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PATH_CACHE, JSON.stringify(cache)).catch(() => {});
    return serverPath;
  }

  // IndicF5 Zero-Shot Speech Synthesis
  async synthesizeSpeech(targetText: string, profile: VoiceProfile): Promise<string> {
    let serverPath = profile.cachedServerPath;

    if (!serverPath) {
      // If built-in voice 2
      if (profile.id === MASTER_VOICE_2.id) {
        serverPath = '/tmp/gradio/bae_comfort/voice_bae_comfort.wav';
      } else {
        serverPath = await this.uploadReferenceAudio(profile.audioUri, `${profile.id}.wav`);
      }
    }

    // Call IndicF5 Gradio API
    const payload = {
      data: [
        targetText,
        {
          path: serverPath,
          orig_name: 'ref.wav',
          url: `${GRADIO_BASE}/gradio_api/file=${serverPath}`,
          meta: { _type: 'gradio.FileData' },
        },
        profile.referenceTranscript || 'வணக்கம் அன்பே.',
      ],
    };

    const callRes = await fetch(`${GRADIO_BASE}/gradio_api/call/synthesize_speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!callRes.ok) {
      throw new Error(`Synthesize call failed: ${callRes.status}`);
    }

    const callJson = await callRes.json();
    const eventId = callJson.event_id;
    if (!eventId) throw new Error('No event_id returned');

    // Poll SSE / event endpoint for complete result
    const resultRes = await fetch(`${GRADIO_BASE}/gradio_api/call/synthesize_speech/${eventId}`);
    const text = await resultRes.text();

    // Parse event output to extract generated audio file url
    const lines = text.split('\n');
    let generatedAudioUrl = '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const raw = line.replace('data:', '').trim();
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed[0]?.url) {
            generatedAudioUrl = parsed[0].url;
          } else if (Array.isArray(parsed) && parsed[0]?.path) {
            generatedAudioUrl = `${GRADIO_BASE}/gradio_api/file=${parsed[0].path}`;
          }
        } catch {}
      }
    }

    if (!generatedAudioUrl) {
      throw new Error('Speech synthesis audio output was empty');
    }

    return generatedAudioUrl;
  }

  async stopCurrentSpeech(): Promise<void> {
    if (this.currentSound) {
      try {
        await this.currentSound.stopAsync();
        await this.currentSound.unloadAsync();
      } catch {}
      this.currentSound = null;
    }
  }

  async playAudioUrl(url: string, onFinish?: () => void): Promise<void> {
    await this.stopCurrentSpeech();
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true }
    );
    this.currentSound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        this.stopCurrentSpeech();
        if (onFinish) onFinish();
      }
    });
  }

  async speakText(
    text: string,
    profile: VoiceProfile,
    onStart?: () => void,
    onFinish?: () => void
  ): Promise<void> {
    if (this.isSynthesizing) return;
    this.isSynthesizing = true;
    try {
      // Clean up text for natural speech (remove markdown, emojis, asterisks)
      const clean = text
        .replace(/[*_#`~[\]]/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
        .trim();

      if (!clean) return;

      const audioUrl = await this.synthesizeSpeech(clean, profile);
      if (onStart) onStart();
      await this.playAudioUrl(audioUrl, onFinish);
    } finally {
      this.isSynthesizing = false;
    }
  }
}

export const voiceService = new VoiceService();
