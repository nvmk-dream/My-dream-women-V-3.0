import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator, StatusBar, Dimensions, Linking, Modal,
  ImageBackground,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ALL_PERSONAS } from '../constants/personas';
import { listCloudinaryVideos, deleteFromCloudinary, uploadUriToCloudinary, trackCloudinaryUpload } from '../services/api';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

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
      <ImageBackground
        source={require('../assets/images/cloud_spring_bg.png')}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        <SafeAreaView style={s.safe} edges={['left','right','bottom']}>
          <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
          <Stack.Screen options={{ headerShown: false }} />

          {/* ── Glass Header Card ── */}
          <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 6 : 14 }]}>
            <View style={s.headerCard}>
              <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
                <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
              </TouchableOpacity>
              <View style={s.headerCenter}>
                <Text style={s.headerTitle}>Videos</Text>
                <Text style={s.headerSub}>Cloud Video Folders</Text>
              </View>
              <View style={s.headerBadge}>
                <MaterialCommunityIcons name="video-vintage" size={20} color="#9333EA" />
              </View>
            </View>
          </View>

          {/* ── Breadcrumb Capsule ── */}
          <View style={s.breadcrumbs}>
            <TouchableOpacity onPress={() => router.replace('/')} style={s.breadcrumbItem}>
              <MaterialCommunityIcons name="home-variant-outline" size={16} color="#7C3AED" />
              <Text style={s.breadcrumbText}>Home</Text>
            </TouchableOpacity>
            <MaterialCommunityIcons name="chevron-right" size={16} color="#9CA3AF" />
            <Text style={s.breadcrumbCurrent}>Videos</Text>
          </View>

          <View style={s.sectionLabelRow}>
            <MaterialCommunityIcons name="folder-multiple-outline" size={16} color="#18204E" />
            <Text style={s.sectionLabel}>FOLDERS</Text>
          </View>

          <FlatList
            data={femalePersonas}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: any) => (
              <TouchableOpacity
                style={s.folderRow}
                onPress={() => openFolder(item.name)}
                activeOpacity={0.78}
              >
                <View style={s.folderAvatar}>
                  <Text style={s.folderAvatarTxt}>
                    {(item.avatarLetter || item.name.charAt(0)).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.folderName}>{item.name}</Text>
                  <Text style={s.folderSub}>{item.relationship || 'AI Companion'}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" style={s.folderArrow} />
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
            contentContainerStyle={{ paddingBottom: 80, paddingTop: 4 }}
          />
        </SafeAreaView>
      </ImageBackground>
    );
  }

  // ── Subfolder video view ──────────────────────────────────────────
  return (
    <ImageBackground
      source={require('../assets/images/cloud_spring_bg.png')}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <SafeAreaView style={s.safe} edges={['left','right','bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

        {/* ── Glass Header Card ── */}
        <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 6 : 14 }]}>
          <View style={s.headerCard}>
            <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.8}>
              <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
            </TouchableOpacity>
            <View style={s.headerCenter}>
              <Text style={s.headerTitle}>{selectedPersona}</Text>
              <Text style={s.headerSub} numberOfLines={1}>
                my-girls/videos/{selectedPersona.toLowerCase()}/
              </Text>
            </View>
            <View style={s.headerBadge}>
              <MaterialCommunityIcons name="play-circle-outline" size={20} color="#9333EA" />
            </View>
          </View>
        </View>

        {/* ── Breadcrumb Capsule ── */}
        <View style={s.breadcrumbs}>
          <TouchableOpacity onPress={() => router.replace('/')} style={s.breadcrumbItem}>
            <MaterialCommunityIcons name="home-variant-outline" size={16} color="#7C3AED" />
            <Text style={s.breadcrumbText}>Home</Text>
          </TouchableOpacity>
          <MaterialCommunityIcons name="chevron-right" size={16} color="#9CA3AF" />
          <TouchableOpacity onPress={goBack} style={s.breadcrumbItem}>
            <Text style={s.breadcrumbText}>Videos</Text>
          </TouchableOpacity>
          <MaterialCommunityIcons name="chevron-right" size={16} color="#9CA3AF" />
          <Text style={s.breadcrumbCurrent} numberOfLines={1}>{selectedPersona}</Text>
        </View>

        <TouchableOpacity
          style={[s.uploadBtn, uploading && { opacity: 0.5 }]}
          onPress={uploadVideo}
          disabled={uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <LinearGradient
              colors={['#E024A5', '#8B5CF6']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={s.uploadBtnGradient}
            >
              <MaterialCommunityIcons name="cloud-upload-outline" size={20} color="#FFFFFF" />
              <Text style={s.uploadBtnTxt}>Video Upload பண்ணுங்கள்</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color="#9333EA" size="large" />
            <Text style={s.loadingTxt}>Videos load ஆகுது...</Text>
          </View>
        ) : videos.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIconCircle}>
              <MaterialCommunityIcons name="filmstrip" size={36} color="#9333EA" />
            </View>
            <Text style={s.emptyTitle}>Video இல்லை</Text>
            <Text style={s.emptyHint}>
              {'மேலே உள்ள Upload பட்டன் மூலம் video சேர்க்கவும்\nஅல்லது Chat-ல் video கேட்கவும்'}
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
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="play" size={24} color="#FFFFFF" />
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
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}

        <Modal visible={!!pendingDelete} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
          <View style={s.dialogOverlay}>
            <View style={s.dialog}>
              <View style={s.dialogTitleRow}>
                <MaterialCommunityIcons name="delete-alert-outline" size={24} color="#EF4444" />
                <Text style={s.dialogTitle}>Video Delete?</Text>
              </View>
              <Text style={s.dialogMessage}>இந்த video Cloudinary-லிருந்து delete ஆகும். Undo முடியாது!</Text>
              <View style={s.dialogActions}>
                <TouchableOpacity style={s.dialogCancel} onPress={() => setPendingDelete(null)}>
                  <Text style={s.dialogCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dialogConfirm} onPress={confirmDeleteVideo}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
                  <Text style={s.dialogConfirmText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  headerWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  headerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.90)',
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
    backgroundColor: '#EDE9FE',
    borderWidth: 1.2,
    borderColor: '#C4B5FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#18204E', letterSpacing: 0.3 },
  headerSub: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E8FF',
    borderWidth: 1.2,
    borderColor: '#D8B4FE',
    justifyContent: 'center',
    alignItems: 'center',
  },

  breadcrumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginVertical: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  breadcrumbText: { color: '#7C3AED', fontSize: 12, fontWeight: '700' },
  breadcrumbCurrent: { color: '#18204E', fontSize: 12, fontWeight: '800', flexShrink: 1 },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#18204E',
    letterSpacing: 1.2,
  },

  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  folderAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    backgroundColor: '#EDE9FE',
    borderWidth: 1.5,
    borderColor: '#C4B5FD',
  },
  folderAvatarTxt: { color: '#7C3AED', fontSize: 18, fontWeight: '800' },
  folderName: { fontSize: 16, fontWeight: '800', color: '#18204E' },
  folderSub: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  folderArrow: { marginLeft: 8 },

  uploadBtn: {
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#E024A5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  uploadBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  uploadBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingTxt: { color: '#6B7280', marginTop: 12, fontSize: 14, fontWeight: '600' },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 3,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#18204E', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.90)',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    gap: 12,
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#9333EA',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  videoInfo: { flex: 1 },
  videoName: { fontSize: 14, fontWeight: '800', color: '#18204E', marginBottom: 2 },
  videoMeta: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: 'rgba(255, 255, 255, 0.96)', borderRadius: 22, padding: 22, borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.95)' },
  dialogTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  dialogTitle: { color: '#18204E', fontSize: 18, fontWeight: '800' },
  dialogMessage: { color: '#4B5563', fontSize: 14, lineHeight: 21, marginBottom: 20 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancel: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingVertical: 12, alignItems: 'center' },
  dialogCancelText: { color: '#4B5563', fontSize: 14, fontWeight: '700' },
  dialogConfirm: { flex: 1, backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  dialogConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
