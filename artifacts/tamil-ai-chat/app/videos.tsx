import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator, StatusBar, Dimensions, Linking, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ALL_PERSONAS } from '../constants/personas';
import { listCloudinaryVideos, deleteFromCloudinary, uploadUriToCloudinary, trackCloudinaryUpload } from '../services/api';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { cloudTheme as ct } from '../constants/cloud-theme';

const { } = Dimensions.get('window');

const LOCAL_VIDEO_KEY = 'my_girls_cloud_videos';

interface VideoItem {
  url: string;
  public_id: string;
  format?: string;
  createdAt?: string;
  personaName?: string;
}

const femalePersonas = (ALL_PERSONAS as any[]).filter((p: any) => p.gender === 'female');

// ── Local storage helpers ────────────────────────────────────────
async function getLocalVideos(personaName: string): Promise<VideoItem[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_VIDEO_KEY);
    const all: VideoItem[] = raw ? JSON.parse(raw) : [];
    return all.filter(v => v.personaName === personaName);
  } catch { return []; }
}

async function saveLocalVideo(v: VideoItem): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_VIDEO_KEY);
    const all: VideoItem[] = raw ? JSON.parse(raw) : [];
    // Deduplicate by public_id
    const filtered = all.filter(x => x.public_id !== v.public_id);
    filtered.push(v);
    await AsyncStorage.setItem(LOCAL_VIDEO_KEY, JSON.stringify(filtered.slice(0, 200)));
  } catch {}
}

async function removeLocalVideo(public_id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_VIDEO_KEY);
    const all: VideoItem[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(LOCAL_VIDEO_KEY, JSON.stringify(all.filter(v => v.public_id !== public_id)));
  } catch {}
}

export default function VideosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VideoItem | null>(null);

  // Load: local first (instant), then sync from Cloudinary in background
  const loadVideos = useCallback(async (personaName: string) => {
    setLoading(true);
    try {
      // 1. Show local videos immediately
      const local = await getLocalVideos(personaName);
      if (local.length > 0) setVideos(local);

      // 2. Try Cloudinary sync in background (Tamil folder may fail — that's OK)
      try {
        const cloud = await listCloudinaryVideos(personaName);
        if (cloud && cloud.length > 0) {
          // Merge cloud results into local storage
          for (const v of cloud as VideoItem[]) {
            await saveLocalVideo({ ...v, personaName });
          }
          const merged = await getLocalVideos(personaName);
          setVideos(merged);
        } else if (local.length === 0) {
          setVideos([]);
        }
        // If cloud empty but local has videos, keep local
      } catch { /* keep local */ }
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openFolder = (personaName: string) => {
    setSelectedPersona(personaName);
    loadVideos(personaName);
  };

  const goBack = () => {
    setSelectedPersona(null);
    setVideos([]);
  };

  const uploadVideo = async () => {
    if (!selectedPersona) return;
    try {
      const perm = await requestPhotoVideoPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission', 'Gallery access வேணும்'); return; }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 300,
      });
      if (res.canceled || !res.assets[0]) return;

      const asset = res.assets[0];
      const uri = asset.uri;
      const mimeType = asset.mimeType || 'video/mp4';

      if (!mimeType.startsWith('video/')) {
        Alert.alert('Format Error', 'mp4, webm, mov format மட்டும் support ஆகும்');
        return;
      }
      if (asset.fileSize && asset.fileSize > 100 * 1024 * 1024) {
        Alert.alert('Size Error', 'Video 100MB-க்கு குறைவா இருக்கணும்');
        return;
      }

      setUploading(true);
      const folder = `my-girls/videos/${selectedPersona.toLowerCase()}`;
      const uploaded = await uploadUriToCloudinary(uri, mimeType, folder);
      trackCloudinaryUpload(folder, uploaded.public_id, uploaded.url).catch(() => {});

      // ✅ Save to AsyncStorage immediately — survives app restarts & Cloudinary listing failures
      const newVid: VideoItem = {
        url: uploaded.url,
        public_id: uploaded.public_id,
        format: 'mp4',
        createdAt: new Date().toISOString(),
        personaName: selectedPersona,
      };
      await saveLocalVideo(newVid);

      // Update UI
      setVideos(prev => {
        // Avoid duplicate if already there
        if (prev.some(v => v.public_id === newVid.public_id)) return prev;
        return [...prev, newVid];
      });

      Alert.alert('Upload Success!', `${selectedPersona} folder-ல் video சேர்க்கப்பட்டது!\n\nChat-ல் "video வேணும்" என்று type பண்ணுங்க!`);
    } catch (e: any) {
      Alert.alert('Upload பண்ண முடியல', e?.message || 'மீண்டும் try பண்ணுங்க');
    } finally {
      setUploading(false);
    }
  };

  const deleteVideo = (vid: VideoItem) => setPendingDelete(vid);

  const confirmDeleteVideo = async () => {
    if (!pendingDelete) return;
    const vid = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteFromCloudinary(vid.public_id);
      await removeLocalVideo(vid.public_id);
      setVideos(prev => prev.filter(v => v.public_id !== vid.public_id));
    } catch {
      Alert.alert('Delete பண்ண முடியல', 'மீண்டும் try பண்ணுங்க');
    }
  };

  const getFileName = (public_id: string) => {
    const parts = public_id.split('/');
    return parts[parts.length - 1] || public_id;
  };

  // ── Folder list view ─────────────────────────────────────────────
  if (!selectedPersona) {
    return (
      <SafeAreaView style={s.safe} edges={['left','right','bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <Stack.Screen options={{ headerShown: false }} />

        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={ct.cyan} />
            <Text style={s.backBtnTxt}>Back</Text>
          </TouchableOpacity>
          <View style={s.headerHeading}>
            <MaterialCommunityIcons name="video-outline" size={22} color={ct.gold} />
            <Text style={s.headerTitle}>Videos</Text>
          </View>
          <View style={{ width: 72 }} />
        </View>

        <View style={s.breadcrumbs}>
          <TouchableOpacity onPress={() => router.replace('/')} style={s.breadcrumbItem}>
            <MaterialCommunityIcons name="home-outline" size={16} color={ct.cyan} />
            <Text style={s.breadcrumbText}>Home</Text>
          </TouchableOpacity>
          <MaterialCommunityIcons name="chevron-right" size={17} color={ct.gold} />
          <Text style={s.breadcrumbCurrent}>Videos</Text>
        </View>

        <Text style={s.sectionLabel}>FOLDERS</Text>

        <FlatList
          data={femalePersonas}
          keyExtractor={(item: any) => item.id}
          renderItem={({ item }: any) => (
            <TouchableOpacity
              style={s.folderRow}
              onPress={() => openFolder(item.name)}
              activeOpacity={0.7}
            >
              <View style={s.folderAvatar}>
                <Text style={s.folderAvatarTxt}>
                  {(item.avatarLetter || item.name.charAt(0)).toUpperCase()}
                </Text>
              </View>
              <Text style={s.folderName}>{item.name}</Text>
              <MaterialCommunityIcons name="chevron-right" size={24} color={ct.gold} style={s.folderArrow} />
              <View style={s.folderTrashWrap}>
                <MaterialCommunityIcons name="delete-outline" size={21} color={ct.cyan} />
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      </SafeAreaView>
    );
  }

  // ── Subfolder video view ──────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['left','right','bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={goBack}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={ct.cyan} />
          <Text style={s.backBtnTxt}>Back</Text>
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <View style={s.headerHeading}>
            <MaterialCommunityIcons name="account-circle-outline" size={22} color={ct.gold} />
            <Text style={s.headerTitle}>{selectedPersona}</Text>
          </View>
          <Text style={s.headerSubtitle} numberOfLines={1}>
            my-girls/videos/{selectedPersona.toLowerCase()}/
          </Text>
        </View>
        <View style={{ width: 72 }} />
      </View>

      <View style={s.breadcrumbs}>
        <TouchableOpacity onPress={() => router.replace('/')} style={s.breadcrumbItem}>
          <MaterialCommunityIcons name="home-outline" size={16} color={ct.cyan} />
          <Text style={s.breadcrumbText}>Home</Text>
        </TouchableOpacity>
        <MaterialCommunityIcons name="chevron-right" size={17} color={ct.gold} />
        <TouchableOpacity onPress={goBack} style={s.breadcrumbItem}>
          <Text style={s.breadcrumbText}>Videos</Text>
        </TouchableOpacity>
        <MaterialCommunityIcons name="chevron-right" size={17} color={ct.gold} />
        <Text style={s.breadcrumbCurrent} numberOfLines={1}>{selectedPersona}</Text>
      </View>

      <TouchableOpacity
        style={[s.uploadBtn, uploading && { opacity: 0.5 }]}
        onPress={uploadVideo}
        disabled={uploading}
      >
        {uploading
          ? <ActivityIndicator color={ct.text} size="small" />
          : <View style={s.actionContent}>
              <MaterialCommunityIcons name="cloud-upload-outline" size={20} color={ct.background} />
              <Text style={s.uploadBtnTxt}>Video Upload பண்ணுங்கள்</Text>
            </View>
        }
      </TouchableOpacity>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={ct.cyan} size="large" />
          <Text style={s.loadingTxt}>Videos load ஆகுது...</Text>
        </View>
      ) : videos.length === 0 ? (
        <View style={s.empty}>
          <MaterialCommunityIcons name="filmstrip" size={60} color={ct.cyan} style={s.emptyIcon} />
          <Text style={s.emptyTitle}>Video இல்லை</Text>
          <Text style={s.emptyHint}>
            {'மேலே Upload பண்ணுங்கள்\nChat-ல் "video வேணும்" என்று கேட்கவும்'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.public_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <View style={s.videoCard}>
              <TouchableOpacity
                style={s.playBtn}
                onPress={() => Linking.openURL(item.url)}
              >
                <MaterialCommunityIcons name="play" size={22} color={ct.background} />
              </TouchableOpacity>
              <View style={s.videoInfo}>
                <Text style={s.videoName} numberOfLines={1}>
                  {getFileName(item.public_id)}
                </Text>
                <Text style={s.videoMeta}>
                  {(item.format || 'mp4').toUpperCase()}
                  {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString('ta-IN')}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={s.deleteBtn}
                onPress={() => deleteVideo(item)}
              >
                <MaterialCommunityIcons name="delete-outline" size={21} color={ct.danger} />
              </TouchableOpacity>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      <Modal visible={!!pendingDelete} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
        <View style={s.dialogOverlay}>
          <View style={s.dialog}>
            <View style={s.dialogTitleRow}>
              <MaterialCommunityIcons name="delete-alert-outline" size={24} color={ct.gold} />
              <Text style={s.dialogTitle}>Video Delete?</Text>
            </View>
            <Text style={s.dialogMessage}>இந்த video Cloudinary-லிருந்து delete ஆகும். Undo முடியாது!</Text>
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogCancel} onPress={() => setPendingDelete(null)}>
                <Text style={s.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dialogConfirm} onPress={confirmDeleteVideo}>
                <MaterialCommunityIcons name="delete-outline" size={18} color={ct.text} />
                <Text style={s.dialogConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ct.background },

  header: {
    backgroundColor: ct.surface,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: ct.goldLine,
  },
  backBtn: {
    backgroundColor: ct.surfaceRaised, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 72, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', borderWidth: 1, borderColor: ct.line,
  },
  backBtnTxt: { color: ct.text, fontWeight: '700', fontSize: 13 },
  headerHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: ct.gold, fontSize: 17, fontWeight: 'bold', textAlign: 'center', flexShrink: 1 },
  headerSubtitle: {
    color: ct.muted, fontSize: 9,
    fontFamily: 'monospace', marginTop: 2, textAlign: 'center',
  },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: ct.surface, borderBottomWidth: 1, borderBottomColor: ct.line },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  breadcrumbText: { color: ct.cyan, fontSize: 12, fontWeight: '600' },
  breadcrumbCurrent: { color: ct.gold, fontSize: 12, fontWeight: '700', flexShrink: 1 },

  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: ct.gold,
    letterSpacing: 1.5, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: ct.surface, borderBottomWidth: 1, borderBottomColor: ct.line,
  },

  folderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: ct.surfaceRaised, marginHorizontal: 12, marginTop: 8,
    borderRadius: 14, borderWidth: 1, borderColor: ct.goldLine,
  },
  folderAvatar: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
    backgroundColor: ct.surfaceSoft, borderWidth: 1.5, borderColor: ct.cyan,
  },
  folderAvatarTxt: { color: ct.gold, fontSize: 18, fontWeight: 'bold' },
  folderName: { flex: 1, fontSize: 16, fontWeight: '600', color: ct.text },
  folderArrow: { marginRight: 12 },
  folderTrashWrap: { padding: 6 },
  folderTrashIcon: { fontSize: 20, color: ct.cyan },
  separator: { height: 2, backgroundColor: ct.background },

  uploadBtn: {
    margin: 16, backgroundColor: ct.cyan, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', elevation: 2,
    borderWidth: 1, borderColor: ct.gold,
  },
  uploadBtnTxt: { color: ct.background, fontWeight: '800', fontSize: 15 },
  actionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingTxt: { color: ct.muted, marginTop: 12, fontSize: 14 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: ct.gold, marginBottom: 8 },
  emptyHint: { fontSize: 13, color: ct.muted, textAlign: 'center', lineHeight: 22 },

  videoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: ct.surfaceRaised, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: ct.goldLine, gap: 12,
  },
  playBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: ct.cyan, justifyContent: 'center', alignItems: 'center',
  },
  playBtnTxt: { color: ct.background, fontSize: 20, fontWeight: 'bold' },
  videoInfo: { flex: 1 },
  videoName: { fontSize: 13, fontWeight: '700', color: ct.text, marginBottom: 3 },
  videoMeta: { fontSize: 11, color: ct.muted },
  deleteBtn: {
    backgroundColor: ct.surfaceSoft, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: ct.danger,
  },
  deleteBtnTxt: { fontSize: 18, color: ct.danger },
  dialogOverlay: { flex: 1, backgroundColor: ct.deepScrim, justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 440, backgroundColor: ct.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: ct.goldLine },
  dialogTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  dialogTitle: { color: ct.gold, fontSize: 18, fontWeight: '800' },
  dialogMessage: { color: ct.muted, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancel: { flex: 1, backgroundColor: ct.surfaceSoft, borderRadius: 10, borderWidth: 1, borderColor: ct.goldLine, paddingVertical: 12, alignItems: 'center' },
  dialogCancelText: { color: ct.gold, fontSize: 14, fontWeight: '700' },
  dialogConfirm: { flex: 1, backgroundColor: ct.danger, borderRadius: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  dialogConfirmText: { color: ct.text, fontSize: 14, fontWeight: '700' },
});
