import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Alert, ActivityIndicator, ScrollView, Dimensions, StatusBar, Switch,
  Linking, ImageBackground, Modal, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ALL_PERSONAS, Persona } from '../constants/personas';
import { listCloudinaryImages, getPhotoStyles, PhotoStyleRecord, getCloudinaryMeta } from '../services/api';
import { NativeModules, Platform } from 'react-native';

const { width } = Dimensions.get('window');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type FaceSwapBridge = {
  openFaceSwap: () => Promise<boolean>;
};

// ── Progress Bar Component ────────────────────────────────────────────────────
function ProgressBar({ progress, statusMsg }: { progress: number; statusMsg: string }) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  return (
    <View style={pb.container}>
      <View style={pb.row}>
        <Text style={pb.statusTxt} numberOfLines={2}>{statusMsg}</Text>
        <Text style={pb.pct}>{Math.round(clampedProgress)}%</Text>
      </View>
      <View style={pb.track}>
        <View style={[pb.fill, { width: `${clampedProgress}%` }]} />
      </View>
      <View style={pb.stepsRow}>
        {['Connecting', 'Processing', 'Enhancing', 'Done'].map((label, i) => {
          const stepPct = [0, 40, 75, 98][i];
          const active = clampedProgress >= stepPct;
          return (
            <View key={label} style={pb.step}>
              <View style={[pb.dot, active && pb.dotActive]} />
              <Text style={[pb.stepLabel, active && pb.stepLabelActive]}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const pb = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)', borderRadius: 20, padding: 16,
    marginBottom: 16, borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.98)',
    shadowColor: '#E91E8C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 5,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 8 },
  statusTxt: { color: '#18204E', fontSize: 13, flex: 1, lineHeight: 18, fontWeight: '700' },
  pct: { color: '#9333EA', fontSize: 22, fontWeight: '900', minWidth: 50, textAlign: 'right' },
  track: {
    height: 10, borderRadius: 6, backgroundColor: '#EDE9FE',
    overflow: 'hidden', marginBottom: 12,
  },
  fill: {
    height: '100%', borderRadius: 6,
    backgroundColor: '#9333EA',
  },
  stepsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#CBD5E1' },
  dotActive: { backgroundColor: '#9333EA' },
  stepLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '600' },
  stepLabelActive: { color: '#7C3AED', fontWeight: '800' },
});

// ── HuggingFace Space Gradio helper ──────────────────────────────────────────
async function callGradioSpace(
  host: string,
  endpoint: string,
  data: any[],
  hfToken?: string,
  timeoutMs = 180000,
  onStatus?: (msg: string) => void,
  onProgress?: (pct: number) => void,
): Promise<string | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

  const MAX_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      onProgress?.(5 + attempt * 2);

      let submitRes: Response;
      try {
        submitRes = await fetch(
          `https://${host}.hf.space/gradio_api/call/${endpoint}`,
          { method: 'POST', headers, body: JSON.stringify({ data }), signal: AbortSignal.timeout(30000) },
        );
      } catch {
        if (attempt < MAX_ATTEMPTS - 1) {
          onStatus?.('Preparing AI...');
          onProgress?.(8);
          await sleep(5000);
          continue;
        }
        return null;
      }

      if (!submitRes.ok) {
        if (submitRes.status === 503) {
          onStatus?.('AI model is starting. This may take 1-3 minutes.');
          onProgress?.(12);
          await sleep(10000);
          continue;
        }
        return null;
      }

      const submitJson: any = await submitRes.json();
      const eventId = submitJson?.event_id;
      if (!eventId) return null;

      onStatus?.('Queued in AI processing...');
      onProgress?.(15);

      const pollStart = Date.now();
      while (Date.now() - pollStart < timeoutMs) {
        await sleep(3000);

        let pollRes: Response;
        try {
          pollRes = await fetch(
            `https://${host}.hf.space/gradio_api/call/${endpoint}/${eventId}`,
            { headers, signal: AbortSignal.timeout(60000) },
          );
        } catch {
          continue;
        }

        if (!pollRes.ok) {
          if (pollRes.status === 503) {
            onStatus?.('AI model is starting. This may take 1-3 minutes.');
            onProgress?.(18);
            await sleep(10000);
            continue;
          }
          return null;
        }

        const text = await pollRes.text();
        const lines = text.split('\n');
        let resultData: any = null;
        let shouldRetry = false;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('event: queue_full') || lines[i].includes('queue_position')) {
            onStatus?.('AI server is busy. Waiting in queue...');
            onProgress?.(20);
            shouldRetry = true;
            break;
          }
          if (lines[i].startsWith('event: process_generating')) {
            const dl = lines[i + 1] || '';
            if (dl.startsWith('data: ')) {
              try {
                const genData: any = JSON.parse(dl.slice(6));
                if (genData?.progress_data?.length > 0) {
                  const p = genData.progress_data[0];
                  const pct = p?.index && p?.length
                    ? 20 + Math.round((p.index / p.length) * 50)
                    : 35;
                  onProgress?.(pct);
                  onStatus?.('Generating result...');
                } else {
                  onProgress?.(35);
                  onStatus?.('Generating result...');
                }
              } catch { onProgress?.(35); }
            }
          }
          if (lines[i].startsWith('event: process_starts')) {
            onStatus?.('Generating result...');
            onProgress?.(25);
          }
          if (lines[i].startsWith('event: complete')) {
            onProgress?.(70);
            const dl = lines[i + 1] || '';
            if (dl.startsWith('data: ')) {
              try { resultData = JSON.parse(dl.slice(6)); } catch { }
            }
            break;
          }
          if (lines[i].startsWith('event: error')) {
            const errLine = lines[i + 1] || '';
            const errText = errLine.toLowerCase();
            if (
              errText.includes('loading') || errText.includes('queue') ||
              errText.includes('cold') || errText.includes('starting') ||
              errText.includes('busy')
            ) {
              onStatus?.('AI server is busy. Waiting in queue...');
              onProgress?.(20);
              shouldRetry = true;
            }
            break;
          }
        }

        if (shouldRetry) {
          await sleep(5000);
          continue;
        }

        if (!resultData || !Array.isArray(resultData) || resultData.length === 0) return null;

        const first = resultData[0];
        if (!first) return null;
        if (typeof first === 'string' && (first.startsWith('http') || first.startsWith('data:'))) return first;
        if (first?.url) return first.url as string;
        if (first?.path) return `https://${host}.hf.space/gradio_api/file=${first.path}`;
        return null;
      }
      return null;
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        onStatus?.('Preparing AI...');
        onProgress?.(8);
        await sleep(5000);
      }
    }
  }
  return null;
}

function imgObj(dataUri: string) {
  return { url: dataUri, meta: { _type: 'gradio.FileData' } };
}

const SWAP_SPACES = [
  {
    label: 'ReActor (InsightFace + InSwapper128 + CodeFormer)',
    host: 'Gourieff-ReActor',
    endpoint: 'predict',
    buildData: (face: object, target: object) => [
      face, target, '0', '0', 'CodeFormer', 1, 0.5, 100, null,
      false, false, false, -1, 'inswapper_128.onnx', 'No', 'No',
    ],
  },
  {
    label: 'InSwapper (InsightFace inswapper_128)',
    host: 'felixrosberg-face-swap',
    endpoint: 'predict',
    buildData: (face: object, target: object) => [target, face],
  },
  {
    label: 'FaceFusion InSwapper (InsightFace)',
    host: 'neural-image-face-swap',
    endpoint: 'predict',
    buildData: (face: object, target: object) => [face, target],
  },
];

async function upscaleWithGFPGAN(imgDataUri: string, hfToken?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;
    const res = await fetch('https://Xintao-GFPGAN.hf.space/gradio_api/call/predict', {
      method: 'POST', headers,
      body: JSON.stringify({ data: [imgObj(imgDataUri), 'v1.4', 2] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const eid = j?.event_id; if (!eid) return null;
    const poll = await fetch(
      `https://Xintao-GFPGAN.hf.space/gradio_api/call/predict/${eid}`,
      { headers, signal: AbortSignal.timeout(120000) },
    );
    if (!poll.ok) return null;
    const txt = await poll.text();
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('event: complete')) {
        const dl = lines[i + 1] || ''; if (!dl.startsWith('data: ')) break;
        const rd: any = JSON.parse(dl.slice(6));
        const f = Array.isArray(rd) ? rd[0] : rd;
        if (!f) break;
        if (typeof f === 'string') return f;
        if (f?.url) return f.url;
        if (f?.path) return `https://Xintao-GFPGAN.hf.space/gradio_api/file=${f.path}`;
        break;
      }
    }
  } catch {}
  return null;
}

async function upscaleWithESRGAN(imgDataUri: string, hfToken?: string): Promise<string | null> {
  const ESRGAN_SPACES = ['sberbank-ai-Real-ESRGAN', 'ai-forever-Real-ESRGAN'];
  for (const host of ESRGAN_SPACES) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;
      const res = await fetch(`https://${host}.hf.space/gradio_api/call/predict`, {
        method: 'POST', headers,
        body: JSON.stringify({ data: [imgObj(imgDataUri), 'RealESRGAN_x4plus', 4, null, 0, 0] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const j: any = await res.json();
      const eid = j?.event_id; if (!eid) continue;
      const poll = await fetch(
        `https://${host}.hf.space/gradio_api/call/predict/${eid}`,
        { headers, signal: AbortSignal.timeout(120000) },
      );
      if (!poll.ok) continue;
      const txt = await poll.text();
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event: complete')) {
          const dl = lines[i + 1] || ''; if (!dl.startsWith('data: ')) break;
          const rd: any = JSON.parse(dl.slice(6));
          const f = Array.isArray(rd) ? rd[0] : rd;
          if (!f) break;
          if (typeof f === 'string') return f;
          if (f?.url) return f.url;
          if (f?.path) return `https://${host}.hf.space/gradio_api/file=${f.path}`;
          break;
        }
      }
    } catch {}
  }
  return null;
}

async function urlToDataUri(url: string): Promise<string | null> {
  try {
    if (url.startsWith('data:')) return url;
    if (url.startsWith('http')) {
      const tmp = FileSystem.cacheDirectory + `enhance_${Date.now()}.jpg`;
      await FileSystem.downloadAsync(url, tmp);
      const raw = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.deleteAsync(tmp, { idempotent: true });
      return `data:image/jpeg;base64,${raw}`;
    }
    return null;
  } catch { return null; }
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FaceSwapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [targetUri, setTargetUri] = useState<string | null>(null);
  const [targetB64, setTargetB64] = useState<string | null>(null);
  const [faceUri, setFaceUri] = useState<string | null>(null);
  const [faceB64, setFaceB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [usedModel, setUsedModel] = useState('');
  const [enhanceEnabled, setEnhanceEnabled] = useState(true);

  // My Girls Cloud Picker State
  const [cloudPickerVisible, setCloudPickerVisible] = useState(false);
  const [cloudSlot, setCloudSlot] = useState<'target' | 'face'>('target');
  const [allCharacters, setAllCharacters] = useState<Persona[]>(ALL_PERSONAS);
  const [selectedChar, setSelectedChar] = useState<Persona>(ALL_PERSONAS[0]);
  const [cloudPhotos, setCloudPhotos] = useState<{ url: string; public_id: string }[]>([]);
  const [loadingCloudPhotos, setLoadingCloudPhotos] = useState(false);
  const [convertingCloudPhoto, setConvertingCloudPhoto] = useState(false);

  // Load custom characters
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('cloud_custom_chars');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setAllCharacters([...ALL_PERSONAS, ...parsed]);
          }
        }
      } catch {}
    })();
  }, []);

  // Fetch photos for selected character in cloud picker
  const loadCharacterPhotos = async (char: Persona) => {
    setSelectedChar(char);
    setLoadingCloudPhotos(true);
    setCloudPhotos([]);
    try {
      // 1. Try style folders or main folder
      const charFolder = `my-girls/${char.id}`;
      let photos = await listCloudinaryImages(charFolder);
      if (!photos || photos.length === 0) {
        // try normal folder
        photos = await listCloudinaryImages(`${charFolder}/normal`);
      }
      if (!photos || photos.length === 0) {
        // try lowercase name
        photos = await listCloudinaryImages(`my-girls/${char.name.toLowerCase()}`);
      }
      setCloudPhotos(photos || []);
    } catch {
      setCloudPhotos([]);
    } finally {
      setLoadingCloudPhotos(false);
    }
  };

  const openMyGirlsPicker = (slot: 'target' | 'face') => {
    setCloudSlot(slot);
    setCloudPickerVisible(true);
    loadCharacterPhotos(selectedChar || ALL_PERSONAS[0]);
  };

  const handleSelectCloudPhoto = async (photoUrl: string) => {
    setConvertingCloudPhoto(true);
    try {
      const b64 = await urlToDataUri(photoUrl);
      if (!b64) {
        Alert.alert('பிழை', 'போட்டோவை லோட் செய்ய முடியவில்லை.');
        return;
      }
      if (cloudSlot === 'target') {
        setTargetUri(photoUrl);
        setTargetB64(b64);
        setResultUrl(null);
        setUsedModel('');
      } else {
        setFaceUri(photoUrl);
        setFaceB64(b64);
        setResultUrl(null);
        setUsedModel('');
      }
      setCloudPickerVisible(false);
    } catch (e: any) {
      Alert.alert('பிழை', e?.message || 'போட்டோவை தேர்வு செய்ய முடியவில்லை.');
    } finally {
      setConvertingCloudPhoto(false);
    }
  };

  // Launch Native On-Device Face Swap Studio (from V2)
  const launchNativeStudio = () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android Only', 'On-Device Face Swap Studio is available on Android.');
      return;
    }
    const bridge = NativeModules.FaceSwapStudio as FaceSwapBridge | undefined;
    if (!bridge || typeof bridge.openFaceSwap !== 'function') {
      Alert.alert('Native Studio', 'Face Swap Studio module is ready in the next APK build.');
      return;
    }
    bridge.openFaceSwap().catch((err) => {
      Alert.alert('Info', err?.message || 'Could not launch native studio.');
    });
  };

  const pickImage = async (slot: 'target' | 'face') => {
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission', 'Gallery access வேணும்.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any, quality: 0.85, base64: true,
    });
    if (!picked.canceled && picked.assets[0]) {
      const asset = picked.assets[0];
      const mime = asset.mimeType ?? 'image/jpeg';
      let b64: string;
      if (asset.base64) {
        b64 = `data:${mime};base64,${asset.base64}`;
      } else {
        try {
          const tmp = FileSystem.cacheDirectory + `fs_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: asset.uri, to: tmp });
          const raw = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
          await FileSystem.deleteAsync(tmp, { idempotent: true });
          b64 = `data:image/jpeg;base64,${raw}`;
        } catch { Alert.alert('பிழை', 'Photo read ஆகல.'); return; }
      }
      if (slot === 'target') { setTargetUri(asset.uri); setTargetB64(b64); setResultUrl(null); setUsedModel(''); }
      else { setFaceUri(asset.uri); setFaceB64(b64); setResultUrl(null); setUsedModel(''); }
    }
  };

  const startSwap = async () => {
    if (!targetB64 || !faceB64) {
      Alert.alert('Images இல்லை', 'இரண்டு photos-ம் select பண்ணுங்க.'); return;
    }
    setLoading(true);
    setResultUrl(null);
    setStatusMsg('Preparing AI...');
    setProgress(2);
    setUsedModel('');

    try {
      const keysRaw = await AsyncStorage.getItem('api_keys_store').catch(() => null);
      const keysMap = keysRaw ? JSON.parse(keysRaw) as Record<string, string> : {};
      const hfToken = keysMap['hf']?.trim() || undefined;

      const faceData = imgObj(faceB64);
      const targetData = imgObj(targetB64);

      // ── STEP 1: Face Swap with auto-retry ──────────────────────────────────
      let swapResult: string | null = null;
      let modelLabel = '';

      const RETRY_TIMEOUT_MS = 60000;
      const retryStart = Date.now();

      while (!swapResult && Date.now() - retryStart < RETRY_TIMEOUT_MS) {
        for (let i = 0; i < SWAP_SPACES.length; i++) {
          const sp = SWAP_SPACES[i];
          setStatusMsg('Generating...');
          setProgress(5);
          try {
            const data = sp.buildData(faceData, targetData);
            swapResult = await callGradioSpace(
              sp.host, sp.endpoint, data, hfToken, 180000,
              (msg) => setStatusMsg(msg),
              (pct) => setProgress(pct),
            );
            if (swapResult) { modelLabel = sp.label; break; }
          } catch { /* try next space */ }
        }
        if (!swapResult && Date.now() - retryStart < RETRY_TIMEOUT_MS) {
          const elapsed = Math.round((Date.now() - retryStart) / 1000);
          const remaining = Math.max(0, 60 - elapsed);
          setStatusMsg(`All spaces busy. Auto-retrying in 5s... (${remaining}s remaining)`);
          setProgress(8);
          await sleep(5000);
        }
      }

      if (!swapResult) {
        setLoading(false);
        setStatusMsg('hf_failed');
        return;
      }

      setUsedModel(modelLabel);

      // ── STEP 2: Optional Enhancement ──────────────────────────────────────
      let finalResult = swapResult;

      if (enhanceEnabled) {
        setStatusMsg('Enhancing with GFPGAN...');
        setProgress(75);
        try {
          const swapDataUri = await urlToDataUri(swapResult);
          if (swapDataUri) {
            const gfpRes = await upscaleWithGFPGAN(swapDataUri, hfToken);
            if (gfpRes) {
              finalResult = gfpRes;
              setStatusMsg('Upscaling with Real-ESRGAN (4×)...');
              setProgress(88);
              try {
                const gfpDataUri = await urlToDataUri(gfpRes);
                if (gfpDataUri) {
                  const esrRes = await upscaleWithESRGAN(gfpDataUri, hfToken);
                  if (esrRes) finalResult = esrRes;
                }
              } catch { /* ESRGAN failed, keep GFPGAN */ }
            }
          }
        } catch { /* enhancement failed, keep raw swap */ }
      }

      setProgress(100);
      setStatusMsg('Done!');
      setResultUrl(finalResult);
    } catch {
      Alert.alert('பிழை', 'Face swap failed. மீண்டும் try பண்ணுங்க.');
    } finally {
      setLoading(false);
    }
  };

  const saveResult = async () => {
    if (!resultUrl) return;
    try {
      const permission = await requestPhotoVideoPermissionsAsync();
      if (!permission.granted) { Alert.alert('Permission', 'Gallery permission வேணும்.'); return; }
      let localUri = resultUrl;
      if (resultUrl.startsWith('http')) {
        const tmp = FileSystem.cacheDirectory + `faceswap_${Date.now()}.jpg`;
        await FileSystem.downloadAsync(resultUrl, tmp);
        localUri = tmp;
      } else if (resultUrl.startsWith('data:')) {
        const m = resultUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (m) {
          const tmp = FileSystem.cacheDirectory + `faceswap_${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(tmp, m[1], { encoding: FileSystem.EncodingType.Base64 });
          localUri = tmp;
        }
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('✅ Saved!', 'Photo gallery-ல save ஆச்சு!');
    } catch { Alert.alert('பிழை', 'Save ஆகல.'); }
  };

  return (
    <ImageBackground
      source={require('../assets/images/cloud_spring_bg.png')}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

        {/* ── Glass Header Card ── */}
        <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 4 : 10 }]}>
          <View style={s.headerCard}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
            </TouchableOpacity>

            <View style={s.headerCenter}>
              <Text style={s.headerTitle}>Face Swap</Text>
              <Text style={s.headerSub}>AI Neural Face Transformation</Text>
            </View>

            <View style={s.headerBadge}>
              <MaterialCommunityIcons name="face-recognition" size={20} color="#9333EA" />
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* ── On-Device Studio Launch Card (V2 Feature) ── */}
          <TouchableOpacity
            style={s.nativeBannerCard}
            onPress={launchNativeStudio}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['rgba(255, 255, 255, 0.96)', 'rgba(255, 243, 248, 0.92)']}
              style={s.nativeBannerGradient}
            >
              <View style={s.nativeBannerLeft}>
                <LinearGradient
                  colors={['#E91E8C', '#9333EA']}
                  style={s.nativeIconCircle}
                >
                  <MaterialCommunityIcons name="lightning-bolt" size={20} color="#FFFFFF" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <View style={s.nativeBadgeRow}>
                    <Text style={s.nativeBadgeTxt}>OFFLINE STUDIO</Text>
                  </View>
                  <Text style={s.nativeTitle}>On-Device Face Swap Studio</Text>
                  <Text style={s.nativeSub}>Local ONNX hardware accelerated processing</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color="#E91E8C" />
            </LinearGradient>
          </TouchableOpacity>

          {/* Quality Enhancement Toggle */}
          <View style={s.toggleCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleLabel}>✨ GFPGAN + Real-ESRGAN Enhancement</Text>
              <Text style={s.toggleSub}>Face restore + 4× upscale (crystal clear quality)</Text>
            </View>
            <Switch
              value={enhanceEnabled}
              onValueChange={setEnhanceEnabled}
              trackColor={{ false: '#E2E8F0', true: '#F472B6' }}
              thumbColor={enhanceEnabled ? '#E91E8C' : '#94A3B8'}
            />
          </View>

          {/* ── Image 1: Target Image ── */}
          <View style={s.card}>
            <View style={s.cardHeaderRow}>
              <View style={s.badge}><Text style={s.badgeNum}>1</Text></View>
              <Text style={s.cardLabel}>Target Image (Body / Background)</Text>
            </View>
            <Text style={s.cardHint}>இந்த போட்டோவில் உள்ள உடம்பில் முகம் swap ஆகும்</Text>

            {targetUri ? (
              <View style={s.previewWrap}>
                <Image source={{ uri: targetUri }} style={s.pickedImg} />
                <TouchableOpacity
                  style={s.removeBtn}
                  onPress={() => { setTargetUri(null); setTargetB64(null); }}
                >
                  <MaterialCommunityIcons name="close-circle" size={24} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.pickerPlaceholder}>
                <Text style={s.pickerIcon}>🖼️</Text>
                <Text style={s.pickerHint}>Upload Target Image</Text>
                <Text style={s.pickerSub}>Gallery அல்லது My Girls-லிருந்து தேர்ந்தெடுக்கவும்</Text>
              </View>
            )}

            {/* Dual Source Buttons */}
            <View style={s.sourceBtnRow}>
              <TouchableOpacity
                style={s.sourceBtn}
                onPress={() => pickImage('target')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="image-outline" size={18} color="#9333EA" />
                <Text style={s.sourceBtnTxt}>Phone Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.sourceBtn, s.sourceBtnCloud]}
                onPress={() => openMyGirlsPicker('target')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="cloud-search-outline" size={18} color="#E91E8C" />
                <Text style={[s.sourceBtnTxt, s.sourceBtnTxtCloud]}>☁️ My Girls Cloud</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Image 2: Face Source ── */}
          <View style={s.card}>
            <View style={s.cardHeaderRow}>
              <View style={s.badge}><Text style={s.badgeNum}>2</Text></View>
              <Text style={s.cardLabel}>Face Source (யாருடைய முகம்)</Text>
            </View>
            <Text style={s.cardHint}>இந்த நபரின் முகம் Target-ல் பொருத்தப்படும்</Text>

            {faceUri ? (
              <View style={s.previewWrap}>
                <Image source={{ uri: faceUri }} style={s.pickedImg} />
                <TouchableOpacity
                  style={s.removeBtn}
                  onPress={() => { setFaceUri(null); setFaceB64(null); }}
                >
                  <MaterialCommunityIcons name="close-circle" size={24} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.pickerPlaceholder}>
                <Text style={s.pickerIcon}>🤳</Text>
                <Text style={s.pickerHint}>Upload Face Photo</Text>
                <Text style={s.pickerSub}>Gallery அல்லது My Girls-லிருந்து தேர்ந்தெடுக்கவும்</Text>
              </View>
            )}

            {/* Dual Source Buttons */}
            <View style={s.sourceBtnRow}>
              <TouchableOpacity
                style={s.sourceBtn}
                onPress={() => pickImage('face')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="image-outline" size={18} color="#9333EA" />
                <Text style={s.sourceBtnTxt}>Phone Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.sourceBtn, s.sourceBtnCloud]}
                onPress={() => openMyGirlsPicker('face')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="cloud-search-outline" size={18} color="#E91E8C" />
                <Text style={[s.sourceBtnTxt, s.sourceBtnTxtCloud]}>☁️ My Girls Cloud</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Progress Bar — shown only while loading */}
          {loading ? (
            <ProgressBar progress={progress} statusMsg={statusMsg} />
          ) : null}

          {/* Swap button */}
          <TouchableOpacity
            style={[s.swapBtn, (!targetB64 || !faceB64 || loading) ? s.swapBtnOff : null]}
            onPress={startSwap}
            disabled={!targetB64 || !faceB64 || loading}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <LinearGradient
                colors={['#E91E8C', '#9333EA']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.swapBtnGradient}
              >
                <MaterialCommunityIcons name="auto-fix" size={22} color="#FFFFFF" />
                <Text style={s.swapBtnTxt}>Swap Face Now ›</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>

          {loading ? (
            <Text style={s.waitTxt}>
              {enhanceEnabled ? '60–180 seconds எடுக்கும் (enhancement ON)...' : '30–90 seconds எடுக்கும்...'}
            </Text>
          ) : null}

          {/* HF Failed fallback card */}
          {!loading && statusMsg === 'hf_failed' ? (
            <View style={s.vidmageCard}>
              <Text style={s.vidmageTitle}>⚠️ AI Cloud Models இப்போது Busy</Text>
              <Text style={s.vidmageDesc}>
                கிளவுட் AI models இப்போது அதிக ட்ராஃபிக்கில் உள்ளன. கீழே உள்ள மாற்று இணையதளங்களில் இலவசமாக Face Swap செய்யலாம்!
              </Text>
              <TouchableOpacity
                style={s.vidmageBtn}
                onPress={() => Linking.openURL('https://vidmage.ai/face-swap')}
              >
                <Text style={s.vidmageBtnTxt}>🌐 vidmage.ai-ல் Try பண்ணுங்க →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.retryBtn}
                onPress={() => { setStatusMsg(''); startSwap(); }}
              >
                <Text style={s.retryBtnTxt}>🔄 மீண்டும் முயற்சி செய்</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Result Card */}
          {resultUrl ? (
            <View style={s.resultCard}>
              <Text style={s.resultTitle}>✅ Face Swap Complete!</Text>
              {usedModel ? (
                <View style={s.modelBadge}>
                  <Text style={s.modelBadgeTxt}>🤖 {usedModel}</Text>
                </View>
              ) : null}
              <Image source={{ uri: resultUrl }} style={s.resultImg} resizeMode="contain" />
              <TouchableOpacity style={s.saveBtn} onPress={saveResult}>
                <LinearGradient
                  colors={['#059669', '#10B981']}
                  style={s.saveBtnGradient}
                >
                  <MaterialCommunityIcons name="download" size={20} color="#FFFFFF" />
                  <Text style={s.saveBtnTxt}>Gallery-ல் சேமிக்கவும்</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Always-visible Alternative Links (Required by User) ── */}
          <View style={s.altSection}>
            <Text style={s.altSectionHeader}>🌐 Alternative Web Face Swap Tools</Text>

            <TouchableOpacity
              style={s.altLinkCard}
              onPress={() => Linking.openURL('https://vidmage.ai/face-swap')}
              activeOpacity={0.8}
            >
              <View style={[s.altIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="web" size={22} color="#2563EB" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.altLinkTitle}>Alternative: vidmage.ai Face Swap (browser)</Text>
                <Text style={s.altLinkSub}>Free online browser-based face swap</Text>
              </View>
              <MaterialCommunityIcons name="open-in-new" size={18} color="#2563EB" />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.altLinkCard}
              onPress={() => Linking.openURL('https://remaker.ai/features/batche-face-swap/')}
              activeOpacity={0.8}
            >
              <View style={[s.altIconWrap, { backgroundColor: '#F0FDF4' }]}>
                <MaterialCommunityIcons name="layers-outline" size={22} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.altLinkTitle}>Alternative: remaker.ai Batch Face Swap (browser)</Text>
                <Text style={s.altLinkSub}>Batch multi-image face swapping tool</Text>
              </View>
              <MaterialCommunityIcons name="open-in-new" size={18} color="#059669" />
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* ── Modal: Cloudinary "My Girls" Photo Picker ── */}
        <Modal
          visible={cloudPickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setCloudPickerVisible(false)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalContainer}>
              <LinearGradient
                colors={['#FFFFFF', '#FFF5F8']}
                style={s.modalGradient}
              >
                {/* Modal Header */}
                <View style={s.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.modalTitle}>☁️ My Girls Photos</Text>
                    <Text style={s.modalSub}>
                      {cloudSlot === 'target' ? 'Target (Body) படத்தைத் தேர்வு செய்' : 'Face Source முகத்தைத் தேர்வு செய்'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.modalCloseBtn}
                    onPress={() => setCloudPickerVisible(false)}
                  >
                    <Ionicons name="close" size={22} color="#475569" />
                  </TouchableOpacity>
                </View>

                {/* Character Picker Tabs */}
                <View style={s.charListWrap}>
                  <FlatList
                    horizontal
                    data={allCharacters}
                    keyExtractor={(item) => item.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
                    renderItem={({ item }) => {
                      const isSelected = selectedChar?.id === item.id;
                      return (
                        <TouchableOpacity
                          style={[s.charTab, isSelected && s.charTabSelected]}
                          onPress={() => loadCharacterPhotos(item)}
                          activeOpacity={0.8}
                        >
                          {item.avatarPhotoUri ? (
                            <Image source={{ uri: item.avatarPhotoUri }} style={s.charAvatar} />
                          ) : (
                            <View style={[s.charAvatarEmoji, { backgroundColor: item.avatarColor || '#E91E8C' }]}>
                              <Text style={{ fontSize: 16 }}>{item.emoji || '🌸'}</Text>
                            </View>
                          )}
                          <Text style={[s.charName, isSelected && s.charNameSelected]} numberOfLines={1}>
                            {item.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>

                {/* Character Profile Photo Direct Action */}
                {selectedChar?.avatarPhotoUri ? (
                  <View style={s.charAvatarQuickRow}>
                    <TouchableOpacity
                      style={s.charAvatarQuickBtn}
                      onPress={() => handleSelectCloudPhoto(selectedChar.avatarPhotoUri!)}
                      disabled={convertingCloudPhoto}
                    >
                      <Image source={{ uri: selectedChar.avatarPhotoUri }} style={s.charAvatarQuickImg} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.charAvatarQuickTitle}>Use {selectedChar.name}'s Profile Photo</Text>
                        <Text style={s.charAvatarQuickSub}>Main avatar photo for face swap</Text>
                      </View>
                      <MaterialCommunityIcons name="check-circle" size={20} color="#E91E8C" />
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Cloud Photos Grid */}
                <View style={s.photosGridWrap}>
                  {loadingCloudPhotos ? (
                    <View style={s.centerBox}>
                      <ActivityIndicator size="large" color="#E91E8C" />
                      <Text style={s.loadingTxt}>Cloudinary Photos லோட் ஆகிறது...</Text>
                    </View>
                  ) : cloudPhotos.length === 0 ? (
                    <View style={s.emptyBox}>
                      <MaterialCommunityIcons name="image-off-outline" size={42} color="#CBD5E1" />
                      <Text style={s.emptyTxt}>{selectedChar?.name}-ன் Cloudinary போட்டோக்கள் இல்லை</Text>
                      <Text style={s.emptySub}>மேலே உள்ள Profile Photo-வை நேரடியாக பயன்படுத்தலாம்</Text>
                    </View>
                  ) : (
                    <FlatList
                      data={cloudPhotos}
                      keyExtractor={(item) => item.public_id}
                      numColumns={3}
                      contentContainerStyle={{ padding: 12, gap: 8 }}
                      columnWrapperStyle={{ gap: 8 }}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={s.gridPhotoItem}
                          onPress={() => handleSelectCloudPhoto(item.url)}
                          disabled={convertingCloudPhoto}
                          activeOpacity={0.8}
                        >
                          <Image source={{ uri: item.url }} style={s.gridPhotoImg} />
                        </TouchableOpacity>
                      )}
                    />
                  )}
                </View>

                {/* Converting Overlay */}
                {convertingCloudPhoto ? (
                  <View style={s.convertingOverlay}>
                    <ActivityIndicator size="large" color="#FFFFFF" />
                    <Text style={s.convertingTxt}>போட்டோ தயாராகிறது...</Text>
                  </View>
                ) : null}
              </LinearGradient>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  headerWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  headerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCE7F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#18204E' },
  headerSub: { fontSize: 11, color: '#D81B60', fontWeight: '700', marginTop: 1 },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 },

  // Native banner
  nativeBannerCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  nativeBannerGradient: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nativeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  nativeIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nativeBadgeRow: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(233, 30, 140, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 2,
  },
  nativeBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D81B60',
    letterSpacing: 0.5,
  },
  nativeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#18204E',
  },
  nativeSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },

  // Toggle Card
  toggleCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  toggleLabel: { fontSize: 13, fontWeight: '700', color: '#18204E' },
  toggleSub: { fontSize: 11, color: '#64748B', marginTop: 2 },

  // Card
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E91E8C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeNum: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  cardLabel: { fontSize: 14, fontWeight: '800', color: '#18204E' },
  cardHint: { fontSize: 11, color: '#64748B', marginBottom: 12, marginLeft: 34 },

  previewWrap: {
    position: 'relative',
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#FCE7F3',
  },
  pickedImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  removeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },

  pickerPlaceholder: {
    height: 120,
    borderRadius: 16,
    backgroundColor: '#FFF0F5',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#F472B6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    padding: 10,
  },
  pickerIcon: { fontSize: 32, marginBottom: 4 },
  pickerHint: { fontSize: 14, fontWeight: '700', color: '#D81B60' },
  pickerSub: { fontSize: 11, color: '#64748B', marginTop: 2, textAlign: 'center' },

  sourceBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sourceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    backgroundColor: '#F3E8FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  sourceBtnCloud: {
    backgroundColor: '#FCE7F3',
    borderColor: '#FBCFE8',
  },
  sourceBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7C3AED',
  },
  sourceBtnTxtCloud: {
    color: '#D81B60',
  },

  // Swap Button
  swapBtn: {
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 10,
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  swapBtnOff: { opacity: 0.55 },
  swapBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  swapBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  waitTxt: { color: '#64748B', fontSize: 12, textAlign: 'center', marginBottom: 12, fontWeight: '600' },

  // Vidmage Fallback
  vidmageCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#FED7AA',
  },
  vidmageTitle: { color: '#B45309', fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  vidmageDesc: { color: '#78350F', fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 12 },
  vidmageBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  vidmageBtnTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  retryBtn: { alignItems: 'center', paddingVertical: 8 },
  retryBtnTxt: { color: '#D81B60', fontSize: 13, fontWeight: '700' },

  // Result Card
  resultCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.98)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
    alignItems: 'center',
  },
  resultTitle: { fontSize: 16, fontWeight: '800', color: '#059669', marginBottom: 6 },
  modelBadge: { backgroundColor: '#F3E8FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 10 },
  modelBadgeTxt: { fontSize: 11, color: '#7C3AED', fontWeight: '700' },
  resultImg: { width: '100%', height: 320, borderRadius: 16, marginBottom: 14 },
  saveBtn: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  saveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  saveBtnTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  // Alternative Links Section (Required by User)
  altSection: {
    marginTop: 10,
    gap: 10,
  },
  altSectionHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: '#18204E',
    marginBottom: 4,
    paddingLeft: 4,
  },
  altLinkCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  altIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  altLinkTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#18204E',
  },
  altLinkSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: '75%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  modalGradient: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FCE7F3',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#18204E' },
  modalSub: { fontSize: 12, color: '#D81B60', fontWeight: '600', marginTop: 2 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },

  charListWrap: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  charTab: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    minWidth: 70,
  },
  charTabSelected: {
    backgroundColor: '#FCE7F3',
    borderColor: '#E91E8C',
  },
  charAvatar: { width: 44, height: 44, borderRadius: 22 },
  charAvatarEmoji: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  charName: { fontSize: 11, fontWeight: '700', color: '#475569' },
  charNameSelected: { color: '#D81B60', fontWeight: '800' },

  charAvatarQuickRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  charAvatarQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FCE7F3',
  },
  charAvatarQuickImg: { width: 40, height: 40, borderRadius: 20 },
  charAvatarQuickTitle: { fontSize: 13, fontWeight: '700', color: '#18204E' },
  charAvatarQuickSub: { fontSize: 11, color: '#64748B' },

  photosGridWrap: { flex: 1 },
  gridPhotoItem: {
    flex: 1 / 3,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  gridPhotoImg: { width: '100%', height: '100%', resizeMode: 'cover' },

  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingTxt: { fontSize: 13, color: '#D81B60', fontWeight: '700' },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 6 },
  emptyTxt: { fontSize: 14, fontWeight: '700', color: '#475569', textAlign: 'center' },
  emptySub: { fontSize: 12, color: '#94A3B8', textAlign: 'center' },

  convertingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  convertingTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
