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
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cloudTheme as ct } from '../constants/cloud-theme';

const { width } = Dimensions.get('window');
const COLS = 4;
const TILE = (width - 32 - (COLS - 1) * 12) / COLS;
const COVER_H = 150;

const DEFAULT_COVER = require('../assets/images/icon.png');
const COVER_KEY = 'home_cover_image';
const CUSTOM_SERVER_KEY = 'custom_server_url';
const DEFAULT_RENDER_URL = 'https://my-dream-women-v-3-0.onrender.com';

type CategoryIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type Category = { key: string; label: string; emoji: string; icon: CategoryIconName; bg: string; route: string };

const CATEGORIES: Category[] = [
  { key: 'pictures',    label: 'Pictures',    emoji: '🖼️',  icon: 'image-multiple-outline', bg: ct.cyanDeep, route: '/gallery?album=pictures' },
  { key: 'camera',      label: 'Camera',      emoji: '📷',  icon: 'camera-outline', bg: ct.goldSoft, route: '/gallery?album=camera' },
  { key: 'movies',      label: 'Movies',      emoji: '🎬',  icon: 'movie-outline', bg: ct.cyan, route: '/gallery?album=movies' },
  { key: 'screenshots', label: 'Screenshots', emoji: '📱',  icon: 'cell-phone', bg: ct.gold, route: '/gallery?album=screenshots' },
  { key: 'downloads',   label: 'Downloads',   emoji: '⬇️',  icon: 'download-outline', bg: ct.cyanDeep, route: '/gallery?album=downloads' },
  { key: 'documents',   label: 'Documents',   emoji: '📄',  icon: 'file-document-outline', bg: ct.goldSoft, route: '/gallery?album=documents' },
  { key: 'music',       label: 'Music',       emoji: '🎵',  icon: 'music-note-outline', bg: ct.cyan, route: '/gallery?album=music' },
  { key: 'icons',       label: 'Icons',       emoji: '🎨',  icon: 'palette-outline', bg: ct.gold, route: '/gallery?album=icons' },
  { key: 'ai-girls',    label: 'My AI Girls', emoji: '💕',  icon: 'heart-multiple-outline', bg: ct.cyanDeep, route: '/ai-girls-cloud' },
  { key: 'projects',    label: 'Projects',    emoji: '💼',  icon: 'briefcase-outline', bg: ct.goldSoft, route: '/gallery?album=projects' },
  { key: 'notes',       label: 'Notes',       emoji: '📝',  icon: 'note-edit-outline', bg: ct.cyan, route: '/notes' },
  { key: 'keys',        label: 'Keys',        emoji: '🔑',  icon: 'key-outline', bg: ct.gold, route: '/keys' },
  { key: 'cloud',       label: 'Cloud',       emoji: '☁️',  icon: 'cloud-outline', bg: ct.cyanDeep, route: '/cloud-storage' },
  { key: 'videos',      label: 'Videos',      emoji: '🎬',  icon: 'video-outline', bg: ct.goldSoft, route: '/videos' },
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

function GlossyCategoryIcon({ name, color, size = TILE - 8 }: { name: CategoryIconName; color: string; size?: number }) {
  const radius = Math.max(12, Math.round(size * 0.28));
  return (
    <View style={[s.glossyIcon, { width: size, height: size, borderRadius: radius }]}>
      <LinearGradient
        colors={[ct.surfaceRaised, color, ct.background]}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.88, y: 1 }}
        style={[s.glossyGradient, { borderRadius: radius }]}
      >
        <View pointerEvents="none" style={s.glossyHighlight} />
        <MaterialCommunityIcons name={name} size={Math.round(size * 0.42)} color={ct.text} />
      </LinearGradient>
    </View>
  );
}

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
    const perm = await requestPhotoVideoPermissionsAsync();
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

    const perm = await requestPhotoVideoPermissionsAsync();
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
        failures.length ? 'Partial Upload' : `${cat?.label} Cloud Upload ஆச்சு!`,
        `${done}/${total} files "${cat?.label}" cloud folder-ல் save ஆச்சு.${failures.length ? `\n${failures.length} fail ஆச்சு.` : ''}`,
        [
          { text: 'OK', style: 'cancel' },
          { text: 'View', onPress: () => { if (cat?.route) router.push(cat.route as any); } },
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
              <GlossyCategoryIcon name="cloud-outline" color={ct.cyan} size={32} />
              <Text style={s.headerTitle}>My Dream Women</Text>
            </View>
            <View style={s.coverActions}>
              <TouchableOpacity style={s.editBtn} onPress={() => setShowPickModal(true)}>
                <MaterialCommunityIcons name="pencil-outline" size={20} color={ct.cyan} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/settings')}>
                <MaterialCommunityIcons name="cog-outline" size={24} color={ct.gold} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={[s.compactBar, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerLeft}>
            <GlossyCategoryIcon name="cloud-outline" color={ct.cyan} size={32} />
            <Text style={s.headerTitle}>My Dream Women</Text>
          </View>
          <View style={s.coverActions}>
            <TouchableOpacity style={s.editBtn} onPress={() => setShowPickModal(true)}>
              <MaterialCommunityIcons name="pencil-outline" size={20} color={ct.cyan} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')}>
              <MaterialCommunityIcons name="cog-outline" size={24} color={ct.gold} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Render Server Banner */}
        {serverStatus === 'sleeping' && (
          <View style={s.serverBanner}>
            <Text style={s.serverBannerTitle}>Server-ஐ connect ஆகல</Text>
            <Text style={s.serverBannerSub}>Render சரியா run ஆகுதான்னு check பண்ணு. AI Girls chat slow ஆ இருக்கலாம்.</Text>
            <TouchableOpacity style={s.serverRetryBtn} onPress={wakeRenderServer} disabled={wakingServer}>
              {wakingServer
                ? <><ActivityIndicator size="small" color={ct.text} /><Text style={s.serverRetryTxt}>  Connecting...</Text></>
                : <><MaterialCommunityIcons name="refresh" size={18} color={ct.text} /><Text style={s.serverRetryTxt}>  Retry</Text></>
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
                  <GlossyCategoryIcon name={cat.icon} color={cat.bg} />
                  {/* ☁️ cloud badge — only for CLOUD_ENABLED categories */}
                  {hasCloud && (
                    <TouchableOpacity
                      style={s.cloudBadge}
                      onPress={() => openCloudSheet(cat.key)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialCommunityIcons name="cloud-outline" size={14} color={ct.cyan} />
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
            <ActivityIndicator size="large" color={ct.cyan} />
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
              {cloudSheetCat?.label} — Cloud
            </Text>
            <Text style={s.sheetSub}>
              இந்த folder-க்கான Cloud options:
            </Text>

            {/* Option 1: Upload to cloud */}
            <TouchableOpacity
              style={s.sheetOption}
              onPress={() => cloudSheet && handleCloudUpload(cloudSheet)}
            >
              <View style={[s.sheetOptionIcon, { backgroundColor: ct.cyanDeep }]}>
                <MaterialCommunityIcons name="cloud-upload-outline" size={24} color={ct.text} />
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
              <View style={[s.sheetOptionIcon, { backgroundColor: ct.goldSoft }]}>
                <MaterialCommunityIcons name="cloud-outline" size={24} color={ct.background} />
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
            <Text style={s.pickTitle}>Cover Image மாத்து</Text>
            <Text style={s.pickSub}>எங்கிருந்து select பண்ணுவீர்கள்?</Text>

            <TouchableOpacity style={s.pickOption} onPress={pickFromGallery}>
              <MaterialCommunityIcons name="image-outline" size={30} color={ct.cyan} />
              <View>
                <Text style={s.pickOptionTitle}>Phone Gallery</Text>
                <Text style={s.pickOptionSub}>நேரடியா மொபைல் gallery-லிருந்து</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.pickOption} onPress={openCloudPicker}>
              <MaterialCommunityIcons name="cloud-outline" size={30} color={ct.gold} />
              <View>
                <Text style={s.pickOptionTitle}>AI Girls Cloud</Text>
                <Text style={s.pickOptionSub}>உங்க cloud photos-லிருந்து</Text>
              </View>
            </TouchableOpacity>

            {coverUri && (
              <TouchableOpacity style={[s.pickOption, { borderColor: ct.goldLine }]} onPress={resetToDefault}>
                <MaterialCommunityIcons name="backup-restore" size={30} color={ct.cyan} />
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
            <Text style={s.cloudPickerTitle}>Cloud Photo தேர்வு</Text>
            <TouchableOpacity onPress={() => setShowCloudPicker(false)}>
              <MaterialCommunityIcons name="close" size={24} color={ct.gold} />
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
  safe: { flex: 1, backgroundColor: ct.background },
  compactBar: {
    backgroundColor: ct.surface,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: ct.goldLine,
  },

  coverWrap: { width: '100%', height: COVER_H, position: 'relative' },
  coverImg: { width: '100%', height: COVER_H, position: 'absolute', top: 0, left: 0 },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ct.deepScrim,
  },
  coverBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: ct.gold, fontSize: 22, fontWeight: 'bold', textShadowColor: ct.background, textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
  coverActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtn: {
    backgroundColor: ct.surfaceRaised, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: ct.line,
  },
  editBtnTxt: { fontSize: 18, color: ct.cyan },
  headerGear: { fontSize: 24, color: ct.gold },

  scroll: { padding: 16, paddingBottom: 80 },
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: ct.gold,
    letterSpacing: 1.5, marginBottom: 16, marginLeft: 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  // Tile — now wraps both icon and cloud badge
  tile: { width: TILE, alignItems: 'center' },
  tileIconWrap: { width: TILE - 8, position: 'relative', marginBottom: 6 },
  glossyIcon: {
    elevation: 4,
    shadowColor: ct.cyan, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 8,
    borderWidth: 1.5, borderColor: ct.goldLine,
    overflow: 'hidden',
  },
  glossyGradient: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  glossyHighlight: {
    position: 'absolute', top: -10, left: -8, width: '78%', height: '42%',
    borderRadius: 999, backgroundColor: 'rgba(37,217,244,0.18)',
    transform: [{ rotate: '-18deg' }],
  },
  tileEmoji: { fontSize: 28 },
  tileLabel: { fontSize: 11, color: ct.text, fontWeight: '600', textAlign: 'center' },

  // ☁️ cloud badge button
  cloudBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 22, height: 22,
    backgroundColor: ct.surfaceRaised,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: ct.cyan,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: ct.cyan,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  cloudBadgeTxt: { fontSize: 10, color: ct.cyan },

  // Cloud upload overlay
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ct.deepScrim,
    justifyContent: 'center', alignItems: 'center', zIndex: 99,
  },
  uploadCard: {
    backgroundColor: ct.surfaceRaised, borderRadius: 20,
    paddingVertical: 32, paddingHorizontal: 40,
    alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: ct.goldLine,
  },
  uploadCardTxt: { fontSize: 15, fontWeight: '700', color: ct.text },
  uploadCardCount: { fontSize: 22, fontWeight: '800', color: ct.cyan },

  // ── Cloud sheet ──────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1, backgroundColor: ct.deepScrim, justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: ct.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingBottom: 36, paddingHorizontal: 24,
    borderWidth: 1, borderColor: ct.goldLine,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: ct.cyanDeep, borderRadius: 2,
    alignSelf: 'center', marginBottom: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: ct.gold, marginBottom: 4 },
  sheetSub: { fontSize: 13, color: ct.muted, marginBottom: 20 },

  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1, borderColor: ct.goldLine,
    backgroundColor: ct.surfaceRaised,
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  sheetOptionIcon: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetOptionEmoji: { fontSize: 22, color: ct.text },
  sheetOptionInfo: { flex: 1 },
  sheetOptionTitle: { fontSize: 15, fontWeight: '700', color: ct.text },
  sheetOptionSub: { fontSize: 12, color: ct.muted, marginTop: 2, lineHeight: 17 },

  sheetCancel: {
    marginTop: 4, backgroundColor: ct.surfaceSoft,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: ct.line,
  },
  sheetCancelTxt: { color: ct.text, fontWeight: '700', fontSize: 15 },

  // Pick modal
  pickOverlay: {
    flex: 1, backgroundColor: ct.deepScrim,
    justifyContent: 'flex-end',
  },
  pickBox: {
    backgroundColor: ct.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    borderWidth: 1, borderColor: ct.goldLine,
  },
  pickTitle: { fontSize: 18, fontWeight: 'bold', color: ct.gold, marginBottom: 4 },
  pickSub: { fontSize: 13, color: ct.muted, marginBottom: 20 },
  pickOption: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1, borderColor: ct.goldLine,
    backgroundColor: ct.surfaceRaised,
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  pickOptionIcon: { fontSize: 32, color: ct.cyan },
  pickOptionTitle: { fontSize: 15, fontWeight: '700', color: ct.text },
  pickOptionSub: { fontSize: 12, color: ct.muted, marginTop: 2 },
  pickCancel: {
    marginTop: 4, backgroundColor: ct.surfaceSoft,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: ct.line,
  },
  pickCancelTxt: { color: ct.text, fontWeight: '700', fontSize: 15 },

  cloudPickerWrap: {
    flex: 1, marginTop: 60, backgroundColor: ct.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: ct.goldLine,
  },
  cloudPickerHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: ct.line,
  },
  cloudPickerTitle: { fontSize: 17, fontWeight: 'bold', color: ct.gold },
  cloudPickerClose: { fontSize: 22, color: ct.gold, paddingHorizontal: 8 },
  cloudEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  cloudEmptyTxt: { fontSize: 15, color: ct.muted, textAlign: 'center', lineHeight: 24 },
  cloudThumb: {
    width: THUMB, height: THUMB, margin: 2, borderRadius: 8, overflow: 'hidden',
  },
  cloudThumbImg: { width: '100%', height: '100%' },

  serverBanner: {
    backgroundColor: ct.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: ct.danger,
    padding: 14, marginBottom: 16, alignItems: 'center',
  },
  serverBannerTitle: { color: ct.danger, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  serverBannerSub: { color: ct.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 10 },
  serverRetryBtn: {
    backgroundColor: ct.cyanDeep, borderRadius: 20,
    paddingHorizontal: 28, paddingVertical: 9,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: ct.cyan,
  },
  serverRetryTxt: { color: ct.text, fontWeight: '700', fontSize: 14 },
});
