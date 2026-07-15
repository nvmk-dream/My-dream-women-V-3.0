import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendMessage, uploadToCloudinary, getCloudinaryMeta, wasCloudRestoreChecked, markCloudRestoreChecked } from '../services/api';
import { ALL_PERSONAS, Persona } from '../constants/personas';
import { ParamsStore } from '../context/params-store';

const STYLE_IDS = [
  'normal','nude','seminude','breast','seductive',
  'wet','legs','saree','sleeping','halfbreast',
];

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  persona?: Persona;
  content: string;
  timestamp: Date;
}

interface CachedPhoto { url: string; public_id: string; }

export default function GroupChatScreen() {
  const ids = ParamsStore.getGroupPersonaIds();
  const [personas, setPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    const load = async () => {
      const restoreAlreadyChecked = await wasCloudRestoreChecked();
      const loaded = await Promise.all(
        ids.map(async (id) => {
          const base = ALL_PERSONAS.find(p => p.id === id);
          if (!base) return null;
          try {
            let saved = await AsyncStorage.getItem(`persona_edit_${base.id}`);
            if (!saved && !restoreAlreadyChecked) {
              // Not found locally (e.g. after reinstall) — try cloud backup
              const cloudData = await getCloudinaryMeta(`persona_edit_${base.id}`).catch(() => null);
              if (cloudData) {
                saved = JSON.stringify(cloudData);
                await AsyncStorage.setItem(`persona_edit_${base.id}`, saved).catch(() => {});
              }
            }
            if (saved) {
              const data = JSON.parse(saved);
              return { ...base, ...data, prompt: data.prompt ?? base.prompt };
            }
          } catch {}
          return base;
        })
      );
      if (!restoreAlreadyChecked) await markCloudRestoreChecked();
      setPersonas(loaded.filter(Boolean) as Persona[]);
    };
    load();
  }, []);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const historyRef  = useRef<{ role: string; content: string }[]>([]);

  // ── Face Swap states ──────────────────────────────────────────
  const [showSwapModal, setShowSwapModal]     = useState(false);
  const [selfieUri, setSelfieUri]             = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl]             = useState<string | null>(null);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [personaPhotos, setPersonaPhotos]     = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos]     = useState(false);
  const [selectedTarget, setSelectedTarget]   = useState<string | null>(null);
  const [swapping, setSwapping]               = useState(false);
  const [swapResult, setSwapResult]           = useState<string | null>(null);
  const [swapError, setSwapError]             = useState('');
  const [swapWarm, setSwapWarm]               = useState<'idle'|'warming'|'ready'>('idle');

  const pingSpace = () => {
    setSwapWarm('warming');
    fetch('/api/face-swap/ping')
      .then(() => setTimeout(() => setSwapWarm('ready'), 10000))
      .catch(() => setSwapWarm('idle'));
  };

  const openSwapModal = () => {
    setSelfieUri(null); setSelfieUrl(null);
    setSelectedPersona(null); setPersonaPhotos([]);
    setSelectedTarget(null); setSwapResult(null); setSwapError('');
    setShowSwapModal(true);
    pingSpace();
  };

  // ── blob URI → base64 helper ──────────────────────────────────
  const uriToBase64 = async (uri: string): Promise<string> => {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // ── pick selfie (gallery only) ────────────────────────────────
  const pickSelfie = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setSelfieUri(asset.uri);
      setSelfieUrl(null);
      setSwapResult(null); setSwapError('');
      setUploadingSelfie(true);
      try {
        const mime = asset.mimeType || 'image/jpeg';
        const b64 = asset.base64 ?? await uriToBase64(asset.uri);
        const up = await uploadToCloudinary(b64, mime, 'faceswap/selfies');
        setSelfieUrl(up.url);
      } catch { setSwapError('Selfie upload failed. மீண்டும் try பண்ணுங்க.'); }
      setUploadingSelfie(false);
    } catch (err: any) {
      setSwapError('Image pick error: ' + (err?.message || ''));
      setUploadingSelfie(false);
    }
  };

  // ── load persona photos ───────────────────────────────────────
  const loadPersonaPhotos = async (persona: Persona) => {
    setSelectedPersona(persona);
    setSelectedTarget(null);
    setPersonaPhotos([]);
    setLoadingPhotos(true);
    const urls: string[] = [];
    try {
      for (const sid of STYLE_IDS) {
        const raw = await AsyncStorage.getItem(`cloud_photos_${persona.id}_${sid}`);
        if (raw) {
          const arr: CachedPhoto[] = JSON.parse(raw);
          arr.forEach(p => { if (p.url) urls.push(p.url); });
        }
      }
    } catch {}
    setPersonaPhotos(urls.slice(0, 30));
    setLoadingPhotos(false);
  };

  // ── pick target from gallery ──────────────────────────────────
  const pickTargetFromGallery = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setSwapError('Gallery permission இல்ல.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'image/jpeg';
      const b64 = asset.base64 ?? await uriToBase64(asset.uri);
      const up = await uploadToCloudinary(b64, mime, 'faceswap/targets');
      setSelectedTarget(up.url);
      setSwapResult(null); setSwapError('');
    } catch (err: any) { setSwapError('Gallery pick failed: ' + (err?.message || '')); }
  };

  // ── do swap (polling — avoids mobile browser timeout) ────────
  const doSwap = async () => {
    if (!selfieUrl || !selectedTarget) return;
    setSwapping(true); setSwapResult(null); setSwapError('');
    try {
      // 1. Start job
      const startRes = await fetch('/api/face-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: selfieUrl, target_url: selectedTarget }),
      });
      const startData = await startRes.json() as any;
      if (!startRes.ok) throw new Error(startData.error || 'Face swap start failed');
      const { jobId } = startData as { jobId: string };

      // 2. Poll every 5s (max 5 min)
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const pollRes = await fetch(`/api/face-swap/result/${jobId}`);
        const poll = await pollRes.json() as any;
        if (poll.status === 'done') {
          setSwapResult(poll.result_url);
          setSwapWarm('ready');
          setSwapping(false);
          return;
        }
        if (poll.status === 'error') throw new Error(poll.error || 'Face swap failed');
      }
      throw new Error('Face swap timeout ஆச்சு. மீண்டும் try பண்ணுங்க.');
    } catch (err: any) {
      setSwapError(err.message || 'Face swap failed. மீண்டும் try பண்ணுங்க.');
      pingSpace();
    }
    setSwapping(false);
  };

  // ── chat logic ────────────────────────────────────────────────
  useEffect(() => {
    if (personas.length > 0) {
      setMessages([{
        id: '0', role: 'assistant',
        persona: personas[0],
        content: `வணக்கம்! நாங்கள் ${personas.map(p => p.name).join(', ')} — எல்லாரும் இங்க இருக்கோம்!`,
        timestamp: new Date(),
      }]);
    }
  }, [personas.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || personas.length === 0) return;
    const userMsg: Msg = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    historyRef.current.push({ role: 'user', content: text });
    try {
      for (const persona of personas) {
        const systemPrompt = persona.prompt + '\n\nநீ ஒரு group chat-ல் இருக்கிறாய். Short-ஆ reply பண்ணு.';
        const reply = await sendMessage([...historyRef.current], 'gemini', systemPrompt);
        const aiMsg: Msg = { id: `${Date.now()}-${persona.id}`, role: 'assistant', persona, content: reply, timestamp: new Date() };
        setMessages(prev => [...prev, aiMsg]);
        historyRef.current.push({ role: 'assistant', content: `${persona.name}: ${reply}` });
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant',
        content: '❌ பதில் வரவில்லை. மீண்டும் try பண்ணுங்க.',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, loading, personas]);

  const renderItem = ({ item }: { item: Msg }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.userRow : styles.aiRow]}>
        {!isUser && item.persona && (
          <View style={[styles.avatar, { backgroundColor: item.persona.avatarColor }]}>
            <Text style={styles.avatarTxt}>{item.persona.emoji}</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
          {!isUser && item.persona && (
            <Text style={[styles.senderName, { color: item.persona.avatarColor }]}>{item.persona.name}</Text>
          )}
          <Text style={styles.msgText}>{item.content}</Text>
          <Text style={styles.timeTxt}>
            {item.timestamp.toLocaleTimeString('ta-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  const swapReady = !!selfieUrl && !!selectedTarget && !uploadingSelfie;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{
        title: `Group Chat (${personas.length})`,
        headerStyle: { backgroundColor: '#075E54' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
        headerRight: () => (
          <TouchableOpacity onPress={openSwapModal} style={{ marginRight: 14 }}>
            <Text style={{ fontSize: 22 }}>🤳</Text>
          </TouchableOpacity>
        ),
      }} />

      {/* Group member bar */}
      <View style={styles.groupBar}>
        {personas.slice(0, 5).map(p => (
          <View key={p.id} style={[styles.miniAvatar, { backgroundColor: p.avatarColor }]}>
            <Text style={styles.miniAvatarTxt}>{p.emoji}</Text>
          </View>
        ))}
        <Text style={styles.groupBarTxt}>{personas.length} members</Text>
        <TouchableOpacity style={styles.swapBarBtn} onPress={openSwapModal}>
          <Text style={styles.swapBarBtnTxt}>🤳 Face Swap</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.msgList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#075E54" />
            <Text style={styles.loadingTxt}>அனைவரும் reply பண்றாங்க...</Text>
          </View>
        )}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Group-ல் message அனுப்பு..."
            placeholderTextColor="#999"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || loading}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ══ Face Swap Modal ══════════════════════════════════════ */}
      <Modal visible={showSwapModal} animationType="slide" transparent onRequestClose={() => setShowSwapModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🤳 Group Face Swap</Text>
              <TouchableOpacity onPress={() => setShowSwapModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>

              {/* Warm status */}
              {swapWarm === 'warming' && (
                <View style={styles.warmBanner}>
                  <ActivityIndicator size="small" color="#075E54" />
                  <Text style={styles.warmTxt}> AI warm up ஆகுது... (30–60 sec) Photos pick பண்ணும் வரை ready ஆயிடும்</Text>
                </View>
              )}
              {swapWarm === 'ready' && (
                <View style={[styles.warmBanner, styles.warmReady]}>
                  <Text style={styles.warmReadyTxt}>✅ AI ready! Swap பண்ணலாம்</Text>
                </View>
              )}

              {/* Step 1 — Selfie */}
              <Text style={styles.stepLabel}>Step 1 — உன் Selfie</Text>
              <View style={styles.selfieRow}>
                <TouchableOpacity onPress={pickSelfie} activeOpacity={0.8}>
                  {selfieUri
                    ? <Image source={{ uri: selfieUri }} style={styles.selfieImg} resizeMode="cover" />
                    : <View style={styles.selfiePlaceholder}><Text style={styles.selfiePlaceholderIcon}>📷</Text></View>
                  }
                </TouchableOpacity>
                <View style={styles.selfieBtns}>
                  <TouchableOpacity style={styles.selfieBtn} onPress={pickSelfie}>
                    <Text style={styles.selfieBtnTxt}>🖼 Gallery</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {uploadingSelfie && (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator size="small" color="#075E54" />
                  <Text style={styles.uploadingTxt}> Selfie uploading...</Text>
                </View>
              )}
              {selfieUrl && !uploadingSelfie && <Text style={styles.okTxt}>✅ Selfie ready!</Text>}

              {/* Step 2 — Pick character */}
              <Text style={styles.stepLabel}>Step 2 — Character தேர்வு</Text>
              <View style={styles.personaPickRow}>
                {personas.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.personaPickBtn, selectedPersona?.id === p.id && styles.personaPickBtnActive]}
                    onPress={() => loadPersonaPhotos(p)}
                  >
                    <View style={[styles.personaPickAvatar, { backgroundColor: p.avatarColor }]}>
                      <Text style={styles.personaPickEmoji}>{p.emoji}</Text>
                    </View>
                    <Text style={styles.personaPickName} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Step 3 — Pick photo */}
              {selectedPersona && (
                <>
                  <Text style={styles.stepLabel}>Step 3 — {selectedPersona.name}-ன் Photo தேர்வு</Text>
                  {loadingPhotos ? (
                    <View style={styles.photosLoading}>
                      <ActivityIndicator color="#075E54" />
                      <Text style={styles.photosLoadingTxt}>Photos load ஆகுது...</Text>
                    </View>
                  ) : personaPhotos.length === 0 ? (
                    <View style={styles.photosEmpty}>
                      <Text style={styles.photosEmptyIcon}>📭</Text>
                      <Text style={styles.photosEmptyTxt}>
                        {selectedPersona?.name}-ன் photos இல்ல.{'\n'}
                        Chat-ல் generate பண்ணி Save பண்ணினா இங்கே வரும்.
                      </Text>
                      <TouchableOpacity style={styles.galleryFallbackBtn} onPress={pickTargetFromGallery}>
                        <Text style={styles.galleryFallbackTxt}>🖼 Phone Gallery-ல் இருந்து pick பண்ணு</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <FlatList
                      data={personaPhotos}
                      numColumns={3}
                      keyExtractor={(item, i) => `${i}_${item}`}
                      scrollEnabled={false}
                      contentContainerStyle={styles.photoGrid}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[styles.photoWrap, selectedTarget === item && styles.photoWrapSelected]}
                          onPress={() => { setSelectedTarget(item); setSwapResult(null); setSwapError(''); }}
                        >
                          <Image source={{ uri: item }} style={styles.photoThumb} resizeMode="cover" />
                          {selectedTarget === item && (
                            <View style={styles.photoCheck}><Text style={styles.photoCheckTxt}>✓</Text></View>
                          )}
                        </TouchableOpacity>
                      )}
                    />
                  )}
                </>
              )}

              {/* Error */}
              {!!swapError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTxt}>⚠️ {swapError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={doSwap} disabled={!swapReady}>
                    <Text style={styles.retryBtnTxt}>🔄 மீண்டும் try</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Swap button */}
              <TouchableOpacity
                style={[styles.swapBtn, (!swapReady || swapping) && styles.swapBtnOff]}
                onPress={doSwap}
                disabled={!swapReady || swapping}
              >
                {swapping
                  ? <><ActivityIndicator color="#fff" /><Text style={styles.swapBtnTxt}> Swapping... (30–90s)</Text></>
                  : <Text style={styles.swapBtnTxt}>🤳 Face Swap பண்ணு!</Text>
                }
              </TouchableOpacity>

              {!swapReady && !swapping && (
                <Text style={styles.hintTxt}>
                  {!selfieUrl ? '↑ Selfie எடுங்க'
                    : !selectedTarget ? '↑ Character + Photo தேர்வு பண்ணுங்க'
                    : ''}
                </Text>
              )}

              {/* Result */}
              {!!swapResult && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultTitle}>✨ Result!</Text>
                  <Image source={{ uri: swapResult }} style={styles.resultImg} resizeMode="contain" />
                </View>
              )}

              <View style={{ height: 30 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  flex: { flex: 1 },

  groupBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#128C7E', paddingHorizontal: 14, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  miniAvatarTxt: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  groupBarTxt: { color: '#dcf8c6', fontSize: 12, flex: 1 },
  swapBarBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  swapBarBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  msgList: { padding: 10 },
  row: { marginVertical: 3, flexDirection: 'row', alignItems: 'flex-end' },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start', gap: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  avatarTxt: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  bubble: { maxWidth: '72%', borderRadius: 10, padding: 10, paddingBottom: 6, elevation: 1 },
  userBubble: { backgroundColor: '#DCF8C6', borderTopRightRadius: 2 },
  aiBubble: { backgroundColor: '#fff', borderTopLeftRadius: 2 },
  senderName: { fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  msgText: { fontSize: 14, lineHeight: 20, color: '#111' },
  timeTxt: { fontSize: 10, color: '#888', alignSelf: 'flex-end', marginTop: 3 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, paddingLeft: 14 },
  loadingTxt: { color: '#075E54', fontSize: 12 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#F0F0F0', borderTopWidth: 1, borderTopColor: '#ddd', gap: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, maxHeight: 100, color: '#111', borderWidth: 1, borderColor: '#ddd' },
  sendBtn: { backgroundColor: '#25D366', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  sendBtnDisabled: { backgroundColor: '#a8d5b5' },
  sendIcon: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#075E54' },
  modalClose: { fontSize: 22, color: '#888' },
  modalScroll: { padding: 16 },

  stepLabel: { fontSize: 13, fontWeight: '800', color: '#075E54', marginTop: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  selfieRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 6 },
  selfieImg: { width: 80, height: 80, borderRadius: 12 },
  selfiePlaceholder: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  selfiePlaceholderIcon: { fontSize: 32 },
  selfieBtns: { flex: 1, gap: 8 },
  selfieBtn: { backgroundColor: '#e8f5e9', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  selfieBtnTxt: { fontWeight: '700', color: '#075E54', fontSize: 13 },
  cloudRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  cloudInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11, color: '#333', backgroundColor: '#fafafa' },
  cloudApplyBtn: { backgroundColor: '#075E54', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  cloudApplyTxt: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  uploadingTxt: { fontSize: 12, color: '#555' },
  okTxt: { fontSize: 12, color: '#2e7d32', fontWeight: '700', marginBottom: 6 },

  personaPickRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  personaPickBtn: { alignItems: 'center', gap: 5, padding: 8, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', minWidth: 64 },
  personaPickBtnActive: { borderColor: '#075E54', backgroundColor: '#e8f5e9' },
  personaPickAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  personaPickEmoji: { fontSize: 22 },
  personaPickName: { fontSize: 11, fontWeight: '700', color: '#333', textAlign: 'center' },

  photosLoading: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  photosLoadingTxt: { color: '#555', fontSize: 12 },
  photosEmpty: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  photosEmptyIcon: { fontSize: 36 },
  photosEmptyTxt: { color: '#888', fontSize: 12, textAlign: 'center' },
  photoGrid: { gap: 4 },
  photoWrap: { flex: 1, margin: 3, aspectRatio: 1, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  photoWrapSelected: { borderColor: '#075E54' },
  photoThumb: { width: '100%', height: '100%' },
  photoCheck: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: '#075E54', alignItems: 'center', justifyContent: 'center' },
  photoCheckTxt: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  warmBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff8e1', borderRadius: 10, padding: 10, marginBottom: 10, gap: 6 },
  warmTxt: { fontSize: 12, color: '#555', flex: 1 },
  warmReady: { backgroundColor: '#e8f5e9' },
  warmReadyTxt: { fontSize: 12, color: '#2e7d32', fontWeight: '600' },

  galleryFallbackBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginTop: 8 },
  galleryFallbackTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  retryBtn: { backgroundColor: '#c62828', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  retryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errorBox: { backgroundColor: '#fdecea', borderRadius: 10, padding: 10, marginVertical: 8 },
  errorTxt: { color: '#c62828', fontSize: 13, textAlign: 'center' },

  swapBtn: { backgroundColor: '#075E54', borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, elevation: 2 },
  swapBtnOff: { backgroundColor: '#a0c4b8', elevation: 0 },
  swapBtnTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hintTxt: { textAlign: 'center', color: '#888', fontSize: 12, marginTop: 6 },

  resultCard: { marginTop: 16, backgroundColor: '#f9f9f9', borderRadius: 16, padding: 12, alignItems: 'center' },
  resultTitle: { fontSize: 16, fontWeight: 'bold', color: '#075E54', marginBottom: 10 },
  resultImg: { width: '100%', height: 300, borderRadius: 12 },
});
