import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ScrollView, StatusBar, Dimensions, Image, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { uploadUriToCloudinary } from '../services/api';

const { width } = Dimensions.get('window');
const COLS = 4;
const TILE = (width - 32 - (COLS - 1) * 12) / COLS;
const COVER_H = 150;

const DEFAULT_COVER = require('../assets/images/icon.png');
const COVER_KEY = 'home_cover_image';
const CUSTOM_SERVER_KEY = 'custom_server_url';
const DEFAULT_RENDER_URL = 'https://my-dream-women-v2.onrender.com';

const CATEGORIES = [
  { key: 'pictures',    label: 'Pictures',    emoji: '🖼️',  bg: '#4A90D9', route: '/gallery?album=pictures' },
  { key: 'camera',      label: 'Camera',      emoji: '📷',  bg: '#E8821A', route: '/gallery?album=camera' },
  { key: 'movies',      label: 'Movies',      emoji: '🎬',  bg: '#C0392B', route: '/gallery?album=movies' },
  { key: 'screenshots', label: 'Screenshots', emoji: '📱',  bg: '#27AE60', route: '/gallery?album=screenshots' },
  { key: 'downloads',   label: 'Downloads',   emoji: '⬇️',  bg: '#8E6BBE', route: '/gallery?album=downloads' },
  { key: 'documents',   label: 'Documents',   emoji: '📄',  bg: '#3498DB', route: '/gallery?album=documents' },
  { key: 'music',       label: 'Music',       emoji: '🎵',  bg: '#9B59B6', route: '/gallery?album=music' },
  { key: 'icons',       label: 'Icons',       emoji: '🎨',  bg: '#FF6B35', route: '/gallery?album=icons' },
  { key: 'ai-girls',    label: 'My AI Girls', emoji: '💕',  bg: '#E91E8C', route: '/ai-girls-cloud' },
  { key: 'projects',    label: 'Projects',    emoji: '💼',  bg: '#8E44AD', route: '/gallery?album=projects' },
  { key: 'notes',       label: 'Notes',       emoji: '📝',  bg: '#E67E22', route: '/notes' },
  { key: 'keys',        label: 'Keys',        emoji: '🔑',  bg: '#F0C040', route: '/keys' },
  { key: 'cloud',       label: 'Cloud',       emoji: '☁️',  bg: '#1ABC9C', route: '/cloud-storage' },
  { key: 'videos',      label: 'Videos',      emoji: '🎬',  bg: '#1565C0', route: '/videos' },
];

// Tiles that get a ☁️ cloud button (keys, cloud, projects, notes excluded)
const CLOUD_ENABLED = new Set([
  'pictures','camera','movies','screenshots','downloads',
  'documents','music','icons','ai-girls','videos',
]);

// Gallery-based categories that upload to storage folder
const GALLERY_CATS = new Set([
  'pictures','camera','movies','screenshots','downloads','documents','music','icons',
]);

type CloudPhoto = { uri: string };

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [showPickModal, setShowPickModal] = useState(false);
  const [cloudPhotos, setCloudPhotos] = useState<CloudPhoto[]>([]);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown'|'ok'|'sleeping'>('unknown');
  const [wakingServer, setWakingServer] = useState(false);

  // ── Cloud sheet state ─────────────────────────────────────────────
  const [cloudSheet, setCloudSheet] = useState<string | null>(null); // category key
  const [cloudUploading, setCloudUploading] = useState(false);
  const [cloudProgress, setCloudProgress] = useState(0);
  const [cloudTotal, setCloudTotal] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(COVER_KEY).then(v => { if (v) setCoverUri(v); }).catch(() => {});
    // Check Render server status on home load
    checkRenderServer();
  }, []);

  const checkRenderServer = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem(CUSTOM_SERVER_KEY).catch(() => null);
      const serverUrl = savedUrl || DEFAULT_RENDER_URL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${serverUrl}/api/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      setServerStatus(res.ok ? 'ok' : 'sleeping');
    } catch {
      setServerStatus('sleeping');
    }
  };

  const wakeRenderServer = async () => {
    setWakingServer(true);
    setServerStatus('unknown');
    try {
      const savedUrl = await AsyncStorage.getItem(CUSTOM_SERVER_KEY).catch(() => null);
      const serverUrl = savedUrl || DEFAULT_RENDER_URL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      await fetch(`${serverUrl}/api/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      setServerStatus('ok');
    } catch {
      setServerStatus('sleeping');
    } finally {
      setWakingServer(false);
    }
  };

  const pickFromGallery = useCallback(async () => {
    setShowPickModal(false);
    await new Promise(r => setTimeout(r, 400));
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission', 'Gallery access allow பண்ணுங்க'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [16, 9], quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setCoverUri(result.assets[0].uri);
      AsyncStorage.setItem(COVER_KEY, result.assets[0].uri).catch(() => {});
    }
  }, []);

  const openCloudPicker = useCallback(async () => {
    setShowPickModal(false);
    const photos: { uri: string }[] = [];
    try {
      const keys = await AsyncStorage.getAllKeys();
      const pairs = await AsyncStorage.multiGet(
        keys.filter(k => k.startsWith('cloud_photos_') || k === 'my_girls_cloud_images'),
      );
      for (const [, val] of pairs) {
        if (!val) continue;
        try {
          const arr: { uri: string }[] = JSON.parse(val);
          for (const p of arr) { if (p?.uri) photos.push({ uri: p.uri }); }
        } catch {}
      }
    } catch {}
    setCloudPhotos(photos);
    setShowCloudPicker(true);
  }, []);

  const resetToDefault = () => {
    setShowPickModal(false);
    setCoverUri(null);
    AsyncStorage.removeItem(COVER_KEY).catch(() => {});
  };

  // ── Cloud quick-upload from home screen ──────────────────────────
  const handleCloudUpload = async (catKey: string) => {
    setCloudSheet(null);
    await new Promise(r => setTimeout(r, 300));

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission', 'Gallery access allow பண்ணுங்க'); return; }

    const isVideo = catKey === 'videos' || catKey === 'movies';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo
        ? ImagePicker.MediaTypeOptions.Videos
        : ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return;

    const assets = result.assets;
    const total = assets.length;
    setCloudUploading(true);
    setCloudProgress(0);
    setCloudTotal(total);

    // Cloud folder path — matches gallery.tsx convention
    const folder = catKey === 'ai-girls'
      ? 'my-girls/ai'
      : catKey === 'videos'
        ? 'my-girls/videos/general'
        : `my-girls/storage/${catKey}`;

    let done = 0;
    const failures: string[] = [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      try {
        const mime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
        await uploadUriToCloudinary(asset.uri, mime, folder);
        done++;
      } catch (e: any) {
        failures.push((e?.message || 'unknown').slice(0, 80));
      }
      setCloudProgress(i + 1);
    }

    setCloudUploading(false);
    setCloudProgress(0);
    setCloudTotal(0);

    const cat = CATEGORIES.find(c => c.key === catKey);
    if (done > 0) {
      Alert.alert(
        failures.length ? '⚠️ Partial Upload' : `✅ ${cat?.emoji} Cloud Upload ஆச்சு!`,
        `${done}/${total} files "${cat?.label}" cloud folder-ல் save ஆச்சு.${failures.length ? `\n${failures.length} fail ஆச்சு.` : ''}`,
        [
          { text: 'OK', style: 'cancel' },
          { text: '☁️ View', onPress: () => { if (cat?.route) router.push(cat.route as any); } },
        ],
      );
    } else {
      Alert.alert('Upload பிழை', `0/${total} upload ஆச்சு.\n${failures[0] || ''}`);
    }
  };

  const openCloudSheet = (catKey: string) => {
    // ai-girls and videos have their own dedicated cloud screen — navigate directly
    if (catKey === 'ai-girls' || catKey === 'videos') {
      const cat = CATEGORIES.find(c => c.key === catKey);
      if (cat?.route) router.push(cat.route as any);
      return;
    }
    setCloudSheet(catKey);
  };

  const cloudSheetCat = CATEGORIES.find(c => c.key === cloudSheet);

  return (
    <SafeAreaView style={s.safe} edges={['left','right','bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Cover image — only show if custom image set, else compact header bar */}
      {coverUri ? (
        <View style={s.coverWrap}>
          <Image
            source={{ uri: coverUri }}
            style={s.coverImg}
            resizeMode="cover"
            onError={() => {
              setCoverUri(null);
              AsyncStorage.removeItem(COVER_KEY).catch(() => {});
            }}
          />
          <View style={s.coverOverlay} />
          <View style={[s.coverBar, { paddingTop: insets.top + 14 }]}>
            <View style={s.headerLeft}>
              <Text style={s.headerCloud}>☁️</Text>
              <Text style={s.headerTitle}>My Dream Women</Text>
            </View>
            <View style={s.coverActions}>
              <TouchableOpacity style={s.editBtn} onPress={() => setShowPickModal(true)}>
                <Text style={s.editBtnTxt}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/settings')}>
                <Text style={s.headerGear}>⚙️</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={[s.compactBar, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerLeft}>
            <Text style={s.headerCloud}>☁️</Text>
            <Text style={s.headerTitle}>My Dream Women</Text>
          </View>
          <View style={s.coverActions}>
            <TouchableOpacity style={s.editBtn} onPress={() => setShowPickModal(true)}>
              <Text style={s.editBtnTxt}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')}>
              <Text style={s.headerGear}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Render Server Banner */}
        {serverStatus === 'sleeping' && (
          <View style={s.serverBanner}>
            <Text style={s.serverBannerTitle}>⚠️ Server-ஐ connect ஆகல</Text>
            <Text style={s.serverBannerSub}>Render சரியா run ஆகுதான்னு check பண்ணு. AI Girls chat slow ஆ இருக்கலாம்.</Text>
            <TouchableOpacity style={s.serverRetryBtn} onPress={wakeRenderServer} disabled={wakingServer}>
              {wakingServer
                ? <><ActivityIndicator size="small" color="#fff" /><Text style={s.serverRetryTxt}>  Connecting...</Text></>
                : <Text style={s.serverRetryTxt}>🔄 Retry</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.sectionLabel}>STORAGE</Text>

        <View style={s.grid}>
          {CATEGORIES.map(cat => {
            const hasCloud = CLOUD_ENABLED.has(cat.key);
            return (
              <View key={cat.key} style={s.tile}>
                <TouchableOpacity
                  style={s.tileIconWrap}
                  onPress={() => { if (cat.route) router.push(cat.route as any); }}
                  activeOpacity={0.7}
                >
                  <View style={[s.tileIcon, { backgroundColor: cat.bg }]}>
                    <Text style={s.tileEmoji}>{cat.emoji}</Text>
                  </View>
                  {/* ☁️ cloud badge — only for CLOUD_ENABLED categories */}
                  {hasCloud && (
                    <TouchableOpacity
                      style={s.cloudBadge}
                      onPress={() => openCloudSheet(cat.key)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={s.cloudBadgeTxt}>☁️</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                <Text style={s.tileLabel} numberOfLines={1}>{cat.label}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* ── Cloud upload progress overlay ── */}
      {cloudUploading && (
        <View style={s.uploadOverlay}>
          <View style={s.uploadCard}>
            <ActivityIndicator size="large" color="#1ABC9C" />
            <Text style={s.uploadCardTxt}>Cloud-ல் upload பண்றேன்...</Text>
            <Text style={s.uploadCardCount}>{cloudProgress} / {cloudTotal}</Text>
          </View>
        </View>
      )}

      {/* ── Cloud sheet modal ── */}
      <Modal
        visible={!!cloudSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setCloudSheet(null)}
      >
        <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={() => setCloudSheet(null)}>
          <TouchableOpacity activeOpacity={1} style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>
              {cloudSheetCat?.emoji} {cloudSheetCat?.label} — Cloud ☁️
            </Text>
            <Text style={s.sheetSub}>
              இந்த folder-க்கான Cloud options:
            </Text>

            {/* Option 1: Upload to cloud */}
            <TouchableOpacity
              style={s.sheetOption}
              onPress={() => cloudSheet && handleCloudUpload(cloudSheet)}
            >
              <View style={[s.sheetOptionIcon, { backgroundColor: '#1ABC9C' }]}>
                <Text style={s.sheetOptionEmoji}>📤</Text>
              </View>
              <View style={s.sheetOptionInfo}>
                <Text style={s.sheetOptionTitle}>Cloud-ல் Upload பண்ணு</Text>
                <Text style={s.sheetOptionSub}>Phone-லிருந்து Cloudinary-க்கு safe-ஆ save பண்ணு</Text>
              </View>
            </TouchableOpacity>

            {/* Option 2: View cloud files */}
            <TouchableOpacity
              style={s.sheetOption}
              onPress={() => {
                const route = cloudSheetCat?.route;
                setCloudSheet(null);
                if (route) setTimeout(() => router.push(route as any), 200);
              }}
            >
              <View style={[s.sheetOptionIcon, { backgroundColor: '#2196F3' }]}>
                <Text style={s.sheetOptionEmoji}>☁️</Text>
              </View>
              <View style={s.sheetOptionInfo}>
                <Text style={s.sheetOptionTitle}>Cloud Files பார்</Text>
                <Text style={s.sheetOptionSub}>Upload ஆன files-ஐ browse பண்ணு, delete பண்ணு</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.sheetCancel} onPress={() => setCloudSheet(null)}>
              <Text style={s.sheetCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Pick source modal */}
      <Modal visible={showPickModal} transparent animationType="fade" onRequestClose={() => setShowPickModal(false)}>
        <TouchableOpacity style={s.pickOverlay} activeOpacity={1} onPress={() => setShowPickModal(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickBox}>
            <Text style={s.pickTitle}>🖼️ Cover Image மாத்து</Text>
            <Text style={s.pickSub}>எங்கிருந்து select பண்ணுவீர்கள்?</Text>

            <TouchableOpacity style={s.pickOption} onPress={pickFromGallery}>
              <Text style={s.pickOptionIcon}>📱</Text>
              <View>
                <Text style={s.pickOptionTitle}>Phone Gallery</Text>
                <Text style={s.pickOptionSub}>நேரடியா மொபைல் gallery-லிருந்து</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.pickOption} onPress={openCloudPicker}>
              <Text style={s.pickOptionIcon}>☁️</Text>
              <View>
                <Text style={s.pickOptionTitle}>AI Girls Cloud</Text>
                <Text style={s.pickOptionSub}>உங்க cloud photos-லிருந்து</Text>
              </View>
            </TouchableOpacity>

            {coverUri && (
              <TouchableOpacity style={[s.pickOption, { borderColor: '#eee' }]} onPress={resetToDefault}>
                <Text style={s.pickOptionIcon}>🔄</Text>
                <View>
                  <Text style={s.pickOptionTitle}>Default-க்கு திரும்பு</Text>
                  <Text style={s.pickOptionSub}>Original Tamil Girls AI image</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.pickCancel} onPress={() => setShowPickModal(false)}>
              <Text style={s.pickCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Cloud photo picker */}
      <Modal visible={showCloudPicker} transparent animationType="slide" onRequestClose={() => setShowCloudPicker(false)}>
        <View style={s.cloudPickerWrap}>
          <View style={s.cloudPickerHeader}>
            <Text style={s.cloudPickerTitle}>☁️ Cloud Photo தேர்வு</Text>
            <TouchableOpacity onPress={() => setShowCloudPicker(false)}>
              <Text style={s.cloudPickerClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {cloudPhotos.length === 0 ? (
            <View style={s.cloudEmpty}>
              <Text style={s.cloudEmptyTxt}>Cloud-ல் photos இல்லை.{'\n'}AI Girls Cloud-ல் photos upload பண்ணுங்க!</Text>
            </View>
          ) : (
            <FlatList
              data={cloudPhotos}
              numColumns={3}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={{ padding: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.cloudThumb}
                  onPress={() => {
                    setShowCloudPicker(false);
                    setCoverUri(item.uri);
                    AsyncStorage.setItem(COVER_KEY, item.uri).catch(() => {});
                  }}
                >
                  <Image source={{ uri: item.uri }} style={s.cloudThumbImg} resizeMode="cover" />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const THUMB = (width - 32) / 3;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f5f5' },
  compactBar: {
    backgroundColor: '#075E54',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
  },

  coverWrap: { width: '100%', height: COVER_H, position: 'relative' },
  coverImg: { width: '100%', height: COVER_H, position: 'absolute', top: 0, left: 0 },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  coverBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerCloud: { fontSize: 26 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', textShadowColor: '#000', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  coverActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtn: {
    backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  editBtnTxt: { fontSize: 18 },
  headerGear: { fontSize: 24, color: '#fff' },

  scroll: { padding: 16, paddingBottom: 80 },
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: '#555',
    letterSpacing: 1.5, marginBottom: 16, marginLeft: 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  // Tile — now wraps both icon and cloud badge
  tile: { width: TILE, alignItems: 'center' },
  tileIconWrap: { width: TILE - 8, position: 'relative', marginBottom: 6 },
  tileIcon: {
    width: TILE - 8, height: TILE - 8,
    borderRadius: (TILE - 8) / 2,
    justifyContent: 'center', alignItems: 'center',
    elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 4,
  },
  tileEmoji: { fontSize: 28 },
  tileLabel: { fontSize: 11, color: '#333', fontWeight: '600', textAlign: 'center' },

  // ☁️ cloud badge button
  cloudBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 22, height: 22,
    backgroundColor: '#fff',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#1ABC9C',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#1ABC9C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  cloudBadgeTxt: { fontSize: 10 },

  // Cloud upload overlay
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', zIndex: 99,
  },
  uploadCard: {
    backgroundColor: '#fff', borderRadius: 20,
    paddingVertical: 32, paddingHorizontal: 40,
    alignItems: 'center', gap: 12,
  },
  uploadCardTxt: { fontSize: 15, fontWeight: '700', color: '#111' },
  uploadCardCount: { fontSize: 22, fontWeight: '800', color: '#1ABC9C' },

  // ── Cloud sheet ──────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingBottom: 36, paddingHorizontal: 24,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2,
    alignSelf: 'center', marginBottom: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#111', marginBottom: 4 },
  sheetSub: { fontSize: 13, color: '#777', marginBottom: 20 },

  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1.5, borderColor: '#e8e8e8',
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  sheetOptionIcon: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetOptionEmoji: { fontSize: 22 },
  sheetOptionInfo: { flex: 1 },
  sheetOptionTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  sheetOptionSub: { fontSize: 12, color: '#777', marginTop: 2, lineHeight: 17 },

  sheetCancel: {
    marginTop: 4, backgroundColor: '#f5f5f5',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  sheetCancelTxt: { color: '#555', fontWeight: '700', fontSize: 15 },

  // Pick modal
  pickOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
  },
  pickTitle: { fontSize: 18, fontWeight: 'bold', color: '#111', marginBottom: 4 },
  pickSub: { fontSize: 13, color: '#777', marginBottom: 20 },
  pickOption: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1.5, borderColor: '#e8e8e8',
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  pickOptionIcon: { fontSize: 32 },
  pickOptionTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  pickOptionSub: { fontSize: 12, color: '#777', marginTop: 2 },
  pickCancel: {
    marginTop: 4, backgroundColor: '#f5f5f5',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  pickCancelTxt: { color: '#555', fontWeight: '700', fontSize: 15 },

  cloudPickerWrap: {
    flex: 1, marginTop: 60, backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  cloudPickerHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  cloudPickerTitle: { fontSize: 17, fontWeight: 'bold', color: '#111' },
  cloudPickerClose: { fontSize: 22, color: '#555', paddingHorizontal: 8 },
  cloudEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  cloudEmptyTxt: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 24 },
  cloudThumb: {
    width: THUMB, height: THUMB, margin: 2, borderRadius: 8, overflow: 'hidden',
  },
  cloudThumbImg: { width: '100%', height: '100%' },

  serverBanner: {
    backgroundColor: '#1a0a00', borderRadius: 12, borderWidth: 1, borderColor: '#ff5252',
    padding: 14, marginBottom: 16, alignItems: 'center',
  },
  serverBannerTitle: { color: '#ff5252', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  serverBannerSub: { color: '#ffb3b3', fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 10 },
  serverRetryBtn: {
    backgroundColor: '#1565C0', borderRadius: 20,
    paddingHorizontal: 28, paddingVertical: 9,
    flexDirection: 'row', alignItems: 'center',
  },
  serverRetryTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
