import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator, StatusBar, Dimensions, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ALL_PERSONAS } from '../constants/personas';
import { listCloudinaryVideos, deleteFromCloudinary, uploadUriToCloudinary } from '../services/api';

const { } = Dimensions.get('window');

interface VideoItem {
  url: string;
  public_id: string;
  format?: string;
  createdAt?: string;
}

const femalePersonas = (ALL_PERSONAS as any[]).filter((p: any) => p.gender === 'female');

export default function VideosScreen() {
  const router = useRouter();
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadVideos = useCallback(async (personaName: string) => {
    setLoading(true);
    try {
      const result = await listCloudinaryVideos(personaName);
      setVideos(result as VideoItem[]);
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
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
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

      // Format check
      if (!mimeType.startsWith('video/')) {
        Alert.alert('Format Error ❌', 'mp4, webm, mov format மட்டும் support ஆகும்');
        return;
      }
      // Size check (max 100MB)
      if (asset.fileSize && asset.fileSize > 100 * 1024 * 1024) {
        Alert.alert('Size Error ❌', 'Video 100MB-க்கு குறைவா இருக்கணும்');
        return;
      }

      setUploading(true);
      const folder = `my-girls/videos/${selectedPersona.toLowerCase()}`;
      const uploaded = await uploadUriToCloudinary(uri, mimeType, folder);
      // ✅ Add to local state immediately — don't rely on Cloudinary listing
      // (Alert.alert is non-blocking; loadVideos would run & return [] for Tamil folders → clears state)
      setVideos(prev => [...prev, { url: uploaded.url, public_id: uploaded.public_id, format: 'mp4' }]);
      Alert.alert('✅ Upload Success!', `${selectedPersona} folder-ல் video சேர்க்கப்பட்டது!`);
      // Background refresh after 3s (give Cloudinary time to index); keeps existing if empty
      setTimeout(() => {
        listCloudinaryVideos(selectedPersona).then(fresh => {
          if (fresh && fresh.length > 0) setVideos(fresh as VideoItem[]);
        }).catch(() => {});
      }, 3000);
    } catch (e: any) {
      Alert.alert('Upload பண்ண முடியல', e?.message || 'மீண்டும் try பண்ணுங்க');
    } finally {
      setUploading(false);
    }
  };

  const deleteVideo = (vid: VideoItem) => {
    Alert.alert(
      '🗑️ Video Delete?',
      'இந்த video Cloudinary-லிருந்து delete ஆகும். Undo முடியாது!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await deleteFromCloudinary(vid.public_id);
              setVideos(prev => prev.filter(v => v.public_id !== vid.public_id));
            } catch {
              Alert.alert('Delete பண்ண முடியல', 'மீண்டும் try பண்ணுங்க');
            }
          },
        },
      ],
    );
  };

  const getFileName = (public_id: string) => {
    const parts = public_id.split('/');
    return parts[parts.length - 1] || public_id;
  };

  // ── Folder list view ─────────────────────────────────────────────
  if (!selectedPersona) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <StatusBar backgroundColor="#075E54" barStyle="light-content" />
        <Stack.Screen options={{ headerShown: false }} />

        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Text style={s.backBtnTxt}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>📹 Videos</Text>
          <View style={{ width: 72 }} />
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
              <View style={[s.folderAvatar, { backgroundColor: item.avatarColor || '#6C63FF' }]}>
                <Text style={s.folderAvatarTxt}>
                  {(item.avatarLetter || item.name.charAt(0)).toUpperCase()}
                </Text>
              </View>
              <Text style={s.folderName}>{item.name}</Text>
              <Text style={s.folderArrow}>›</Text>
              <View style={s.folderTrashWrap}>
                <Text style={s.folderTrashIcon}>🗑️</Text>
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
  const persona = femalePersonas.find((p: any) => p.name === selectedPersona) as any;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar backgroundColor="#075E54" barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={goBack}>
          <Text style={s.backBtnTxt}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>{persona?.emoji || '👩'} {selectedPersona}</Text>
          <Text style={s.headerSubtitle} numberOfLines={1}>
            📁 my-girls/videos/{selectedPersona.toLowerCase()}/
          </Text>
        </View>
        <View style={{ width: 72 }} />
      </View>

      <TouchableOpacity
        style={[s.uploadBtn, uploading && { opacity: 0.5 }]}
        onPress={uploadVideo}
        disabled={uploading}
      >
        {uploading
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={s.uploadBtnTxt}>📤 Video Upload பண்ணுங்கள்</Text>
        }
      </TouchableOpacity>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#6C63FF" size="large" />
          <Text style={s.loadingTxt}>Videos load ஆகுது...</Text>
        </View>
      ) : videos.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🎬</Text>
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
                <Text style={s.playBtnTxt}>▶</Text>
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
                <Text style={s.deleteBtnTxt}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  header: {
    backgroundColor: '#075E54',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 72, alignItems: 'center',
  },
  backBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold', textAlign: 'center' },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.65)', fontSize: 9,
    fontFamily: 'monospace', marginTop: 2, textAlign: 'center',
  },

  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: '#555',
    letterSpacing: 1.5, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#ebebeb',
  },

  folderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#fff',
  },
  folderAvatar: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  folderAvatarTxt: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  folderName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#E67E22' },
  folderArrow: { color: '#aaa', fontSize: 24, marginRight: 16 },
  folderTrashWrap: { padding: 6 },
  folderTrashIcon: { fontSize: 20 },
  separator: { height: 1, backgroundColor: '#f0f0f0', marginLeft: 82 },

  uploadBtn: {
    margin: 16, backgroundColor: '#6C63FF', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', elevation: 2,
  },
  uploadBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingTxt: { color: '#888', marginTop: 12, fontSize: 14 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 22 },

  videoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8f9fe', borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: '#e8e0ff', gap: 12,
  },
  playBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center',
  },
  playBtnTxt: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  videoInfo: { flex: 1 },
  videoName: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 3 },
  videoMeta: { fontSize: 11, color: '#888' },
  deleteBtn: {
    backgroundColor: '#ffeaea', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  deleteBtnTxt: { fontSize: 18 },
});
