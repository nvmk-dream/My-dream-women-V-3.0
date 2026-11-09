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
  cachedServerPath: '/tmp/gradio/f94dc4ab4a60d841dea683a286b1be159e9dcdf6e8127ef685919342e9101f26/voice_bae_calms_you.wav',
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

  // Gradio upload reference audio with automatic caching & FileSystem upload support
  async uploadReferenceAudio(fileUri: string, fileName = 'ref.wav'): Promise<string> {
    if (!fileUri) {
      throw new Error('Reference audio URI is missing');
    }

    // Check cached server path
    const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
    const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
    if (cache[fileUri]) {
      return cache[fileUri];
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
      cache[fileUri] = serverPath;
      await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PATH_CACHE, JSON.stringify(cache)).catch(() => {});
    }

    return serverPath;
  }

  // Ensure valid server path with auto recovery
  async ensureServerPath(profile: VoiceProfile): Promise<string> {
    if (profile.cachedServerPath) {
      return profile.cachedServerPath;
    }

    if (profile.id === MASTER_VOICE_1.id) {
      return MASTER_VOICE_1.cachedServerPath || (await this.uploadReferenceAudio(MASTER_VOICE_1.audioUri, 'voice_bae_calms_you.wav'));
    }

    if (profile.id === MASTER_VOICE_2.id) {
      return MASTER_VOICE_2.cachedServerPath || (await this.uploadReferenceAudio(MASTER_VOICE_2.audioUri, 'voice_bae_comfort.wav'));
    }

    if (profile.audioUri) {
      return await this.uploadReferenceAudio(profile.audioUri, `${profile.id}.wav`);
    }

    return MASTER_VOICE_1.cachedServerPath!;
  }

  // IndicF5 Zero-Shot Speech Synthesis
  async synthesizeSpeech(targetText: string, profile: VoiceProfile): Promise<string> {
    let serverPath = await this.ensureServerPath(profile);

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

    let callRes = await fetch(`${GRADIO_BASE}/gradio_api/call/synthesize_speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Auto-recovery if cached server path expired or invalid on Gradio
    if (!callRes.ok && (callRes.status === 404 || callRes.status === 403 || callRes.status === 500)) {
      if (profile.audioUri) {
        // Invalidate cache and re-upload reference audio
        const cacheRaw = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PATH_CACHE).catch(() => null);
        const cache: Record<string, string> = cacheRaw ? JSON.parse(cacheRaw) : {};
        delete cache[profile.audioUri];
        await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PATH_CACHE, JSON.stringify(cache)).catch(() => {});

        serverPath = await this.uploadReferenceAudio(profile.audioUri, `${profile.id}.wav`);
        payload.data[1].path = serverPath;
        payload.data[1].url = `${GRADIO_BASE}/gradio_api/file=${serverPath}`;

        callRes = await fetch(`${GRADIO_BASE}/gradio_api/call/synthesize_speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    }

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
          if (Array.isArray(parsed) && parsed[0]) {
            const item = parsed[0];
            if (item.path) {
              // Direct clean URL from path avoids Hugging Face duplicate gradio_api bug
              generatedAudioUrl = `${GRADIO_BASE}/gradio_api/file=${item.path}`;
            } else if (item.url) {
              // Sanitize duplicate /gradio_api/gradio_api/ if present in url
              generatedAudioUrl = item.url.replace(/\/gradio_api\/gradio_api\//g, '/gradio_api/');
            }
          }
        } catch {}
      }
    }

    // Always ensure url doesn't have duplicate /gradio_api/gradio_api/
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
        const downloadRes = await FileSystem.downloadAsync(cleanUrl, localTarget);
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
      const clean = text
        .replace(/[*_#`~[\]()]/g, '')
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
