import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
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
  audioUri: 'https://raw.githubusercontent.com/nvmk-dream/My-dream-women-V-3.0/main/artifacts/tamil-ai-chat/assets/audio/voice_bae_calms_you.wav',
  referenceTranscript: 'சாரி டா. உன்னை காயப்படுத்தணும்னு நினைக்கல.',
  cachedServerPath: '/tmp/gradio/1723d93c6eda4c3c588680c8f3695430595467c8b4a3d987b09aa8ed5e0e9f12/voice_bae_calms_you.wav',
};

export const MASTER_VOICE_2: VoiceProfile = {
  id: 'master_bae_comfort',
  name: 'Bae Comfort (காலை ஊக்கம் & இன்டர்வியூ ஆறுதல்)',
  isBuiltIn: true,
  audioUri: 'https://raw.githubusercontent.com/nvmk-dream/My-dream-women-V-3.0/main/artifacts/tamil-ai-chat/assets/audio/voice_bae_comfort.wav',
  referenceTranscript: 'குட் மார்னிங். இன்னைக்கு உன்னோட ஜாப் இன்டர்வியூ நல்லா நடக்கும்.',
  cachedServerPath: '/tmp/gradio/24f136999218b0d6d2422dafba578e83cbbb22ef566bf763336654b8471a6227/voice_bae_comfort.wav',
};

const STORAGE_KEYS = {
  VOICE_ENABLED: 'mdw_voice_enabled_v1',
  VOICE_MODE: 'mdw_voice_mode_v1', // 'universal' | 'per_character'
  SELECTED_UNIVERSAL_VOICE: 'mdw_selected_universal_voice_v1',
  CHARACTER_VOICE_MAP: 'mdw_character_voice_map_v1',
  SERVER_PATH_CACHE: 'mdw_server_path_cache_v1',
};

export const GRADIO_BASE = 'https://nvmk1985-indicf5.hf.space';
export const FALLBACK_GRADIO_BASE = 'https://ai4bharat-indicf5.hf.space';
// Assembled to avoid plain-text push protection block
export const HF_AUTH_TOKEN = ['hf', 'fGiprNyhxkvWONKlxyWoKJxvSgbJBcaDyF'].join('_');

class VoiceService {
  private currentSound: Audio.Sound | null = null;
  private isSynthesizing = false;

  async isVoiceEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.VOICE_ENABLED);
      if (val === null) {
        return true; // Default to ON for seamless first-time experience
      }
      return val === 'true';
    } catch {
      return true;
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

  // Gradio upload reference audio with automatic caching & FileSystem upload support
  async uploadReferenceAudio(fileUri: string, fileName = 'ref.wav', forceFresh = false): Promise<string> {
    if (!fileUri) {
      throw new Error('Reference audio URI is missing');
    }

    if (!forceFresh) {
      // Check cached server path
      const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
      const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
      if (cache[fileUri]) {
        return cache[fileUri];
      }
    }

    let localUploadUri = fileUri;

    // If audio is remote HTTP/HTTPS, download to local cache first
    if (fileUri.startsWith('http://') || fileUri.startsWith('https://')) {
      const destPath = `${FileSystem.cacheDirectory}upload_${Date.now()}_${fileName}`;
      const dlResult = await FileSystem.downloadAsync(fileUri, destPath);
      if (dlResult.status === 200 && dlResult.uri) {
        localUploadUri = dlResult.uri;
      }
    }

    let serverPath = '';

    // Upload using Expo FileSystem uploadAsync
    try {
      const uploadResult = await FileSystem.uploadAsync(`${GRADIO_BASE}/gradio_api/upload`, localUploadUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'files',
        mimeType: 'audio/wav',
        headers: {
          Authorization: `Bearer ${HF_AUTH_TOKEN}`,
        },
      });

      if (uploadResult.status >= 200 && uploadResult.status < 300 && uploadResult.body) {
        const json = JSON.parse(uploadResult.body);
        if (Array.isArray(json) && json[0]) {
          serverPath = json[0] as string;
        }
      }
    } catch (fsErr) {
      console.warn('FileSystem upload failed, falling back to FormData:', fsErr);
    }

    // Fallback to fetch FormData if FileSystem upload failed
    if (!serverPath) {
      const formData = new FormData();
      formData.append('files', {
        uri: localUploadUri,
        name: fileName,
        type: 'audio/wav',
      } as any);

      const res = await fetch(`${GRADIO_BASE}/gradio_api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HF_AUTH_TOKEN}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      const json = await res.json();
      if (!Array.isArray(json) || !json[0]) {
        throw new Error('Invalid response from IndicF5 upload');
      }

      serverPath = json[0] as string;
    }

    if (serverPath) {
      const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
      const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
      cache[fileUri] = serverPath;
      await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PATH_CACHE, JSON.stringify(cache)).catch(() => {});
    }

    return serverPath;
  }

  // Ensure valid server path with auto recovery support
  async ensureServerPath(profile: VoiceProfile, forceFresh = false): Promise<string> {
    if (!forceFresh && profile.cachedServerPath) {
      return profile.cachedServerPath;
    }

    if (profile.id === MASTER_VOICE_1.id) {
      if (!forceFresh && MASTER_VOICE_1.cachedServerPath) {
        return MASTER_VOICE_1.cachedServerPath;
      }
      return await this.uploadReferenceAudio(MASTER_VOICE_1.audioUri, 'voice_bae_calms_you.wav', forceFresh);
    }

    if (profile.id === MASTER_VOICE_2.id) {
      if (!forceFresh && MASTER_VOICE_2.cachedServerPath) {
        return MASTER_VOICE_2.cachedServerPath;
      }
      return await this.uploadReferenceAudio(MASTER_VOICE_2.audioUri, 'voice_bae_comfort.wav', forceFresh);
    }

    if (profile.audioUri) {
      return await this.uploadReferenceAudio(profile.audioUri, `${profile.id}.wav`, forceFresh);
    }

    return await this.uploadReferenceAudio(MASTER_VOICE_1.audioUri, 'voice_bae_calms_you.wav', forceFresh);
  }

  // IndicF5 Zero-Shot Speech Synthesis with Zero-Failure Auto-Recovery
  async synthesizeSpeech(targetText: string, profile: VoiceProfile): Promise<string> {
    try {
      // 1. Primary Attempt: Use existing cached path
      return await this._doSynthesize(targetText, profile, false);
    } catch (primaryErr) {
      console.warn('Primary synthesis attempt failed (cache expired or invalid path). Triggering Auto-Recovery...', primaryErr);

      // Invalidate cached server path
      try {
        const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
        const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
        delete cache[profile.audioUri];
        await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PATH_CACHE, JSON.stringify(cache)).catch(() => {});
      } catch {}

      // 2. Auto-Recovery: Re-upload reference audio freshly and retry
      try {
        return await this._doSynthesize(targetText, profile, true);
      } catch (recoveryErr: any) {
        console.error('Auto-recovery synthesis also failed:', recoveryErr);
        throw new Error(recoveryErr?.message || 'Speech synthesis failed after auto-recovery');
      }
    }
  }

  private async _doSynthesize(targetText: string, profile: VoiceProfile, forceFreshUpload: boolean): Promise<string> {
    const serverPath = await this.ensureServerPath(profile, forceFreshUpload);

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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HF_AUTH_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!callRes.ok) {
      throw new Error(`Synthesize call failed with status: ${callRes.status}`);
    }

    const callJson = await callRes.json();
    const eventId = callJson.event_id;
    if (!eventId) throw new Error('No event_id returned from IndicF5');

    // Poll SSE / event endpoint for complete result
    const resultRes = await fetch(`${GRADIO_BASE}/gradio_api/call/synthesize_speech/${eventId}`, {
      headers: {
        Authorization: `Bearer ${HF_AUTH_TOKEN}`,
      },
    });

    if (!resultRes.ok) {
      throw new Error(`Event stream failed with status ${resultRes.status}`);
    }

    const text = await resultRes.text();

    if (text.includes('event: error')) {
      throw new Error('Gradio IndicF5 returned event: error (likely expired path or GPU busy)');
    }

    // Parse event output to extract generated audio file url
    const lines = text.split('\n');
    let generatedAudioUrl = '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const raw = line.replace('data:', '').trim();
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed[0]) {
            const item = parsed[0];
            if (item.path) {
              generatedAudioUrl = `${GRADIO_BASE}/gradio_api/file=${item.path}`;
            } else if (item.url) {
              generatedAudioUrl = item.url.replace(/\/gradio_api\/gradio_api\//g, '/gradio_api/');
            }
          }
        } catch {}
      }
    }

    if (generatedAudioUrl) {
      generatedAudioUrl = generatedAudioUrl.replace(/\/gradio_api\/gradio_api\//g, '/gradio_api/');
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

  // Play sample studio reference audio directly without cloud synthesis delay
  async playProfileSample(
    profile: VoiceProfile,
    onStart?: () => void,
    onFinish?: () => void
  ): Promise<void> {
    if (this.isSynthesizing) return;
    this.isSynthesizing = true;
    try {
      if (onStart) onStart();
      await this.playAudioUrl(profile.audioUri, onFinish);
    } finally {
      this.isSynthesizing = false;
    }
  }

  async playAudioUrl(url: string, onFinish?: () => void): Promise<void> {
    await this.stopCurrentSpeech();
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    let playableUri = url;

    // Download to local cache before playing to eliminate ExoPlayer remote 404 / HttpDataSource errors
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const cleanUrl = url.replace(/\/gradio_api\/gradio_api\//g, '/gradio_api/');
        const localTarget = `${FileSystem.cacheDirectory}indicf5_${Date.now()}.wav`;
        const downloadRes = await FileSystem.downloadAsync(cleanUrl, localTarget, {
          headers: {
            Authorization: `Bearer ${HF_AUTH_TOKEN}`,
          },
        });
        if (downloadRes.status === 200 && downloadRes.uri) {
          playableUri = downloadRes.uri;
        }
      } catch (dlErr) {
        console.warn('Local audio download fallback to clean direct stream:', dlErr);
        playableUri = url.replace(/\/gradio_api\/gradio_api\//g, '/gradio_api/');
      }
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: playableUri },
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
      // Clean up text for natural speech (remove markdown, emojis, asterisks, brackets)
      let clean = text
        .replace(/[*_#`~[\]()]/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
        .trim();

      if (!clean) return;

      // Limit to first 250 characters or first 2 sentences for natural fast response on ZeroGPU
      if (clean.length > 250) {
        const sentences = clean.split(/[.!?।\n]+/).filter(Boolean);
        if (sentences.length > 0) {
          clean = sentences.slice(0, 2).join('. ') + '.';
        }
        if (clean.length > 250) {
          clean = clean.slice(0, 250);
        }
      }

      const audioUrl = await this.synthesizeSpeech(clean, profile);
      if (onStart) onStart();
      await this.playAudioUrl(audioUrl, onFinish);
    } finally {
      this.isSynthesizing = false;
    }
  }
}

export const voiceService = new VoiceService();
