import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Image, Dimensions, ScrollView, FlatList,
  Platform, TextInput, Modal, BackHandler, StatusBar, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadUriToCloudinary, listCloudinaryImages, listCloudinaryBackups, trackCloudinaryUpload, deleteFromCloudinary, getCloudinaryMeta, setCloudinaryMeta, CLOUDINARY_UPLOAD_CLOUD, CLOUDINARY_UPLOAD_PRESET, type CloudinaryBackup } from '../services/api';
import { createBackupZip, getInstalledApkInfo, startBackupUpload, getBackupUploadState, cancelBackupUpload, clearBackupUploadState, addBackupUploadListener, type NativeBackupUploadState } from '../services/installed-apk';
import { ParamsStore } from '../context/params-store';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';

const { width } = Dimensions.get('window');
const COLS = 3;
const THUMB = (width - (COLS + 1) * 2) / COLS;

interface CloudFile { url: string; public_id: string; isVideo?: boolean; isRaw?: boolean; resource_type?: string; format?: string; fileName?: string; bytes?: number }

type PendingBackup = {
  zipPath: string;
  outputName: string;
  sizeBytes: number;
  backupInfo: Record<string, unknown>;
  uploaded?: { url: string; public_id: string };
};

interface SubFolder  { id: string; label: string }

const ALBUM_META: Record<string, { label: string; emoji: string; color: string; mediaType: MediaLibrary.MediaTypeValue[] }> = {
  pictures:    { label: 'Pictures',    emoji: '🖼️',  color: '#4A90D9', mediaType: [MediaLibrary.MediaType.photo] },
  camera:      { label: 'Camera',      emoji: '📷',  color: '#E8821A', mediaType: [MediaLibrary.MediaType.photo] },
  movies:      { label: 'Movies',      emoji: '🎬',  color: '#C0392B', mediaType: [MediaLibrary.MediaType.video] },
  screenshots: { label: 'Screenshots', emoji: '📱',  color: '#27AE60', mediaType: [MediaLibrary.MediaType.photo] },
  downloads:   { label: 'Downloads',   emoji: '⬇️',  color: '#8E6BBE', mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] },
  documents:   { label: 'Documents',   emoji: '📄',  color: '#3498DB', mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] },
  music:       { label: 'Music',       emoji: '🎵',  color: '#9B59B6', mediaType: [MediaLibrary.MediaType.audio] },
  icons:       { label: 'Icons',       emoji: '🎨',  color: '#FF6B35', mediaType: [MediaLibrary.MediaType.photo] },
  projects:    { label: 'Projects',    emoji: '💼',  color: '#8E44AD', mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] },
};

function foldersKey(album: string)           { return `storage_folders_${album}`; }
function filesKey(album: string, sub?: string) {
  return sub ? `storage_files_${album}_${sub}` : `storage_files_${album}`;
}

export default function GalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { album, mode } = useLocalSearchParams<{ album?: string; mode?: string }>();
  const albumKey = (album ?? 'pictures') as string;
  const meta = ALBUM_META[albumKey] ?? ALBUM_META.pictures;
  const isChatSelectMode = mode === 'chat';

  // ── Cloud view state ─────────────────────────────────────────────
  const [depth, setDepth]               = useState<0 | 1>(0);
  const [currentFolder, setCurrentFolder] = useState<SubFolder | null>(null);
  const [subFolders, setSubFolders]     = useState<SubFolder[]>([]);
  const [files, setFiles]               = useState<CloudFile[]>([]);
  const [loading, setLoading]           = useState(false);
  const [fullView, setFullView]         = useState<CloudFile | null>(null);
  const [cloudSelIds, setCloudSelIds]   = useState<Set<string>>(new Set());
  const [cloudSelMode, setCloudSelMode] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName]     = useState('');

  // ── Phone folder browser state ───────────────────────────────────
  const [showAlbums, setShowAlbums]         = useState(false);
  const [phoneAlbums, setPhoneAlbums]       = useState<MediaLibrary.Album[]>([]);
  const [loadingAlbums, setLoadingAlbums]   = useState(false);
  const [showAssets, setShowAssets]         = useState(false);
  const [phoneAssets, setPhoneAssets]       = useState<MediaLibrary.Asset[]>([]);
  const [loadingAssets, setLoadingAssets]   = useState(false);
  const [selectedAlbumLib, setSelectedAlbumLib] = useState<MediaLibrary.Album | null>(null);
  const [pickerSel, setPickerSel]           = useState<Set<string>>(new Set());
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal]       = useState(0);
  const [backupFileUploadProgress, setBackupFileUploadProgress] = useState<number | null>(null);
  const [backingUp, setBackingUp]           = useState(false);
  const [backupStep, setBackupStep]         = useState('');
  const [backupZipReady, setBackupZipReady] = useState(false);
  const [backupUploadProgress, setBackupUploadProgress] = useState(0);
  const [backups, setBackups] = useState<CloudinaryBackup[]>([]);
  const pendingBackupRef = React.useRef<PendingBackup | null>(null);
  const lastBackupNoticeRef = React.useRef('');
  const finalizingBackupRef = React.useRef<string | null>(null);
  const cancelRequestedRef = React.useRef(false);
  const runProjectBackupRef = React.useRef<() => Promise<void>>(async () => {});

  // ── MediaLibrary permission ──────────────────────────────────────
  const [mlPermission, requestMlPermission] = MediaLibrary.usePermissions();

  const depthRef = React.useRef(depth);
  useEffect(() => { depthRef.current = depth; }, [depth]);

  useFocusEffect(useCallback(() => {
    const onBack = () => {
      if (showAssets) { setShowAssets(false); return true; }
      if (showAlbums) {
        setShowAlbums(false);
        if (isChatSelectMode) router.back();
        return true;
      }
      if (depthRef.current === 1) { goUp(); return true; }
      router.back(); return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router, showAlbums, showAssets, isChatSelectMode]));

  useEffect(() => {
    const loadFolders = async () => {
      // Step 1: AsyncStorage — instant load (works offline)
      const localRaw = await AsyncStorage.getItem(foldersKey(albumKey)).catch(() => null);
      const local: SubFolder[] = localRaw ? JSON.parse(localRaw) : [];
      if (local.length) setSubFolders(local);
      // Step 2: Cloudinary meta — merge & restore after reinstall
      try {
        const cloud = await getCloudinaryMeta(`gallery_folders_${albumKey}`);
        if (Array.isArray(cloud) && cloud.length > 0) {
          const merged = [...local];
          for (const cf of cloud as SubFolder[]) {
            if (!merged.some(f => f.id === cf.id)) merged.push(cf);
          }
          setSubFolders(merged);
          await AsyncStorage.setItem(foldersKey(albumKey), JSON.stringify(merged)).catch(() => {});
        }
      } catch { /* cloud offline — local still shown */ }
    };
    loadFolders();
  }, [albumKey]);

  useEffect(() => {
    if (depth === 0) loadCloudFiles(undefined);
  }, [depth, albumKey]);

  const loadProjectBackups = useCallback(async () => {
    if (albumKey !== 'projects' || depth !== 0) return;
    const listed = await listCloudinaryBackups().catch(() => []);
    setBackups(listed);
  }, [albumKey, depth]);

  useEffect(() => {
    loadProjectBackups();
  }, [loadProjectBackups]);

  useEffect(() => {
    if (!isChatSelectMode) return;
    const timer = setTimeout(() => { openFolderBrowser(); }, 350);
    return () => clearTimeout(timer);
  }, [isChatSelectMode]);

  // ── Load uploaded cloud files ────────────────────────────────────
  const loadCloudFiles = useCallback(async (sub?: SubFolder) => {
    setLoading(true);
    setFiles([]);
    try {
      const key = filesKey(albumKey, sub?.id);
      const cached = await AsyncStorage.getItem(key);
      const local: CloudFile[] = cached ? JSON.parse(cached) : [];
      if (local.length > 0) setFiles(local);
      try {
        const folder = sub
          ? `my-girls/storage/${albumKey}/${sub.id}`
          : `my-girls/storage/${albumKey}`;
        const cloud = await listCloudinaryImages(folder);
        if (cloud.length > 0) {
          const cloudFiles: CloudFile[] = cloud.map((p: any) => ({
            url: p.url, public_id: p.public_id,
            isRaw: p.resource_type === 'raw', isVideo: p.resource_type === 'video',
            resource_type: p.resource_type, format: p.format, fileName: p.fileName, bytes: p.bytes,
          }));
          const cloudIds = new Set(cloudFiles.map(p => p.public_id));
          const merged = [...cloudFiles, ...local.filter(p => !cloudIds.has(p.public_id))];
          await AsyncStorage.setItem(key, JSON.stringify(merged));
        }
      } catch {}
    } catch {}
    setLoading(false);
  }, [albumKey]);

  const goIntoFolder = (folder: SubFolder) => {
    setCurrentFolder(folder);
    setDepth(1);
    setFiles([]);
    loadCloudFiles(folder);
  };

  const goUp = () => {
    setDepth(0);
    setCurrentFolder(null);
    loadCloudFiles(undefined);
  };

  // ── Icons folder: pick with 1:1 crop ─────────────────────────────
  const pickIconWithCrop = async () => {
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission வேணும்', 'Gallery access allow பண்ணுங்க');
      return;
    }
    await new Promise(r => setTimeout(r, 300));
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.92,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(1);
    try {
      const folder = currentFolder
        ? `my-girls/storage/${albumKey}/${currentFolder.id}`
        : `my-girls/storage/${albumKey}`;
      const uploaded = await uploadUriToCloudinary(asset.uri, 'image/jpeg', folder);
      const cloudFile: CloudFile = { url: uploaded.url, public_id: uploaded.public_id };
      trackCloudinaryUpload(folder, uploaded.public_id, uploaded.url).catch(() => {});

      const key = filesKey(albumKey, currentFolder?.id);
      const existing = await AsyncStorage.getItem(key).catch(() => null);
      const prev: CloudFile[] = existing ? JSON.parse(existing) : [];
      const updated = [cloudFile, ...prev.filter(f => f.public_id !== cloudFile.public_id)];
      await AsyncStorage.setItem(key, JSON.stringify(updated));
      setFiles(updated);
      setUploadProgress(1);

      Alert.alert(
        '✅ Icon Upload ஆச்சு!',
        '1:1 crop பண்ணி Icons folder-ல் save ஆச்சு.\n\nSettings-ல் இந்த icon-ஐ App Icon-ஆ set பண்ணி Build trigger பண்ணலாம்.',
        [
          { text: 'OK', style: 'cancel' },
          { text: '⚙️ Settings-க்கு போ', onPress: () => router.push('/settings') },
        ],
      );
    } catch (e: any) {
      Alert.alert('Upload பிழை', e?.message || 'மீண்டும் try பண்ணுங்க');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadTotal(0);
    }
  };

  // ── Projects: pick any document/media file for Cloudinary ─────────
  const pickProjectDocuments = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'image/*',
        'video/*',
        'application/zip',
        'application/x-zip-compressed',
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const folder = currentFolder
      ? `my-girls/storage/${albumKey}/${currentFolder.id}`
      : `my-girls/storage/${albumKey}`;
    const selected = result.assets;
    const isBackupZip = selected.length === 1 && (
      selected[0].mimeType === 'application/zip'
      || selected[0].mimeType === 'application/x-zip-compressed'
      || /\.zip$/i.test(selected[0].name || '')
    );
    setBackupFileUploadProgress(isBackupZip ? 0 : null);
    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(selected.length);
    const uploaded: CloudFile[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        const asset = selected[i];
        const mimeType = asset.mimeType || 'application/octet-stream';
        try {
          const data = await uploadUriToCloudinary(
            asset.uri,
            mimeType,
            folder,
            isBackupZip ? (progress) => setBackupFileUploadProgress(progress) : undefined,
          );
          uploaded.push({ url: data.url, public_id: data.public_id, isVideo: mimeType.startsWith('video/'), isRaw: !mimeType.startsWith('image/') && !mimeType.startsWith('video/'), format: mimeType.split('/').pop(), fileName: asset.name });
          trackCloudinaryUpload(folder, data.public_id, data.url).catch(() => {});
        } catch (error: any) {
          failures.push(`${asset.name || 'file'}: ${error?.message || 'upload failed'}`);
        }
        setUploadProgress(i + 1);
      }

      if (uploaded.length) {
        const key = filesKey(albumKey, currentFolder?.id);
        const existingRaw = await AsyncStorage.getItem(key).catch(() => null);
        const existing: CloudFile[] = existingRaw ? JSON.parse(existingRaw) : [];
        const updated = [...uploaded, ...existing.filter(file => !uploaded.some(item => item.public_id === file.public_id))];
        await AsyncStorage.setItem(key, JSON.stringify(updated));
        setFiles(updated);
      }
      if (failures.length) {
        if (isBackupZip) {
          setBackupFileUploadProgress(null);
          Alert.alert(
            'Backup failed',
            failures[0],
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: () => setTimeout(() => pickProjectDocuments(), 0) },
            ],
          );
        } else {
          Alert.alert('⚠️ Partial Upload', `${uploaded.length}/${selected.length} files Cloudinary-ல் save ஆச்சு.\n\n${failures[0]}`);
        }
      } else {
        if (isBackupZip) {
          setBackupFileUploadProgress(100);
          await new Promise(resolve => setTimeout(resolve, 350));
        }
        Alert.alert('✅ Upload ஆச்சு', `${uploaded.length} file(s) Projects folder-ல் Cloudinary-ல் save ஆச்சு.`);
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadTotal(0);
      if (isBackupZip) setBackupFileUploadProgress(null);
    }
  };

  // ── Open phone folder browser ────────────────────────────────────
  const openFolderBrowser = async () => {
    // Request full media permission (Android 13+ needs explicit re-request)
    let granted = false;
    try {
      // No argument = read+write; needed for getAlbumsAsync on Android 13+
      const result = await requestPhotoVideoPermissionsAsync();
      granted = result.granted;
    } catch {
      granted = false;
    }

    if (!granted) {
      try {
        const result2 = await requestMlPermission();
        granted = result2?.granted ?? false;
      } catch {}
    }

    if (!granted) {
      Alert.alert(
        'Permission வேணும்',
        'Settings > Apps > My Girls > Permissions > Files & Media > Allow all\n\nAllow பண்ணிட்டு App close செய்து மீண்டும் திறங்க.',
        [{ text: 'OK' }],
      );
      return;
    }

    // Load phone albums — retry once if permission just granted
    setLoadingAlbums(true);
    setShowAlbums(true);
    let retried = false;
    const loadAlbums = async () => {
      try {
        const all = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
        all.sort((a, b) => (b.assetCount ?? 0) - (a.assetCount ?? 0));
        setPhoneAlbums(all);
      } catch (e: any) {
        const msg: string = e?.message ?? '';
        if (!retried && msg.toLowerCase().includes('permission')) {
          // Permission just granted but Android hasn't propagated yet — retry once
          retried = true;
          await new Promise(r => setTimeout(r, 800));
          await requestPhotoVideoPermissionsAsync();
          return loadAlbums();
        }
        Alert.alert(
          'Permission பிழை',
          'Settings > Apps > My Girls > Permissions > Files & Media > Allow all\nApp close செய்து மீண்டும் திறங்க.',
          [{ text: 'OK' }],
        );
        setShowAlbums(false);
      }
    };
    await loadAlbums();
    setLoadingAlbums(false);
  };

  // ── Open files inside a phone album ─────────────────────────────
  const openAlbumAssets = async (lib: MediaLibrary.Album) => {
    setSelectedAlbumLib(lib);
    setPickerSel(new Set());
    setLoadingAssets(true);
    setShowAssets(true);
    try {
      const allAssets: MediaLibrary.Asset[] = [];
      let after: string | undefined;
      let hasNextPage = true;
      while (hasNextPage) {
        const page = await MediaLibrary.getAssetsAsync({
          album: lib,
          mediaType: isChatSelectMode
            ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
            : meta.mediaType,
          first: 300,
          after,
          sortBy: MediaLibrary.SortBy.creationTime,
        });
        allAssets.push(...page.assets);
        hasNextPage = page.hasNextPage;
        after = page.endCursor;
      }
      setPhoneAssets(allAssets);
    } catch (e: any) {
      Alert.alert('பிழை', 'Files load ஆகல: ' + (e?.message ?? ''));
      setShowAssets(false);
    }
    setLoadingAssets(false);
  };

  // ── Toggle file selection in picker ─────────────────────────────
  const togglePickerSel = (id: string) => {
    setPickerSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Confirm selection → Cut / Copy ──────────────────────────────
  const confirmSelection = () => {
    if (pickerSel.size === 0) { Alert.alert('Files தேர்வு பண்ணுங்க'); return; }

    if (isChatSelectMode) {
      const selected = phoneAssets.find(asset => pickerSel.has(asset.id));
      if (!selected) return;
      const isVideo = selected.mediaType === MediaLibrary.MediaType.video;
      const extension = selected.filename?.split('.').pop()?.toLowerCase();
      const mimeType = isVideo
        ? (extension ? `video/${extension === 'mov' ? 'quicktime' : extension}` : 'video/mp4')
        : (extension ? `image/${extension === 'jpg' ? 'jpeg' : extension}` : 'image/jpeg');
      ParamsStore.setPendingGalleryMedia({
        uri: selected.uri,
        isVideo,
        mimeType,
        fileName: selected.filename || (isVideo ? 'phone_video.mp4' : 'phone_photo.jpg'),
        durationSec: isVideo && selected.duration ? selected.duration : undefined,
      });
      setShowAssets(false);
      setShowAlbums(false);
      router.back();
      return;
    }
    const count = pickerSel.size;
    Alert.alert(
      `${count} file${count > 1 ? 's' : ''} select ஆச்சு`,
      'Cloud-ல் எப்படி save பண்ணணும்?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '📋 Copy  (Phone-ல் இருக்கும்)',
          onPress: () => { setShowAssets(false); setShowAlbums(false); doMediaUpload('copy'); } },
        { text: '✂️ Cut  (Phone-ல் delete ஆகும்)', style: 'destructive',
          onPress: () => { setShowAssets(false); setShowAlbums(false); doMediaUpload('cut'); } },
      ],
    );
  };

  const backupPathPart = (value: string) =>
    value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';

  const fileNameForBackup = (file: CloudFile, index: number) => {
    const publicName = file.public_id?.split('/').pop() || `file_${index + 1}`;
    const urlPath = file.url?.split('?')[0] || '';
    const urlName = urlPath.split('/').pop() || '';
    const urlExt = urlName.match(/\.[A-Za-z0-9]{2,5}$/)?.[0] || '';
    const fallbackExt = file.isVideo ? '.mp4' : '.jpg';
    return `${backupPathPart(publicName.replace(/\.[A-Za-z0-9]{2,5}$/, ''))}${urlExt || fallbackExt}`;
  };

  const collectProjectBackup = async () => {
    const storageKeys = (await AsyncStorage.getAllKeys()).filter(key =>
      key === foldersKey('projects') || key.startsWith('storage_files_projects'),
    );
    const localStorage: Record<string, unknown> = {};
    for (const key of storageKeys) {
      const raw = await AsyncStorage.getItem(key).catch(() => null);
      if (!raw) continue;
      try { localStorage[key] = JSON.parse(raw); } catch { localStorage[key] = raw; }
    }

    const folderList = Array.isArray(localStorage[foldersKey('projects')])
      ? localStorage[foldersKey('projects')] as SubFolder[]
      : subFolders;
    const folders = [{ id: '', label: 'Root' }, ...folderList];
    const mediaFiles: { url: string; path: string }[] = [];
    const seen = new Set<string>();
    const cloudFolders: Record<string, CloudFile[]> = {};

    for (const folder of folders) {
      const cloudFolder = folder.id
        ? `my-girls/storage/projects/${folder.id}`
        : 'my-girls/storage/projects';
      const cloudFiles = await listCloudinaryImages(cloudFolder).catch(() => []);
      const cachedKey = filesKey('projects', folder.id || undefined);
      const cachedRaw = await AsyncStorage.getItem(cachedKey).catch(() => null);
      let cachedFiles: CloudFile[] = [];
      try { cachedFiles = cachedRaw ? JSON.parse(cachedRaw) : []; } catch {}
      const merged = [
        ...cloudFiles,
        ...cachedFiles.filter(c => !cloudFiles.some(f => f.public_id === c.public_id)),
      ];
      cloudFolders[folder.id || 'root'] = merged;

      merged.forEach((file, index) => {
        const uniqueId = `${folder.id}:${file.public_id}`;
        if (seen.has(uniqueId) || !file.url) return;
        seen.add(uniqueId);
        const folderPart = folder.id ? backupPathPart(folder.id) : 'Root';
        mediaFiles.push({
          url: file.url,
          path: `Projects/${folderPart}/${fileNameForBackup(file, index)}`,
        });
      });
    }

    return {
      projectData: {
        storageKeys: localStorage,
        cloudFolders,
        source: 'existing Projects gallery storage',
        exportedAt: new Date().toISOString(),
      },
      mediaFiles,
    };
  };

  const discardPendingBackup = async () => {
    cancelRequestedRef.current = true;
    await clearBackupUploadState(true).catch(() => {});
    pendingBackupRef.current = null;
    lastBackupNoticeRef.current = '';
    finalizingBackupRef.current = null;
    setBackingUp(false);
    setBackupStep('');
    setBackupZipReady(false);
    setBackupUploadProgress(0);
  };

  const showBackupFailure = (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error || 'Unknown backup error');
    setBackingUp(false);
    setBackupStep('');
    setBackupZipReady(Boolean(pendingBackupRef.current));
    setBackupUploadProgress(0);
    Alert.alert(
      'Backup failed',
      `${reason}\n\nZIP பாதுகாப்பாக வைக்கப்பட்டுள்ளது.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { void discardPendingBackup(); } },
        { text: 'Retry', onPress: () => setTimeout(() => runProjectBackupRef.current(), 0) },
      ],
    );
  };

  const pendingFromNativeState = (state: NativeBackupUploadState): PendingBackup => {
    let backupInfo: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(state.backupInfoJson || '{}');
      if (parsed && typeof parsed === 'object') backupInfo = parsed;
    } catch {}
    return {
      zipPath: state.filePath,
      outputName: state.outputName || 'MyDreamWoman_FullBackup.zip',
      sizeBytes: Number(state.totalBytes || 0),
      backupInfo,
      uploaded: state.url && state.public_id ? { url: state.url, public_id: state.public_id } : undefined,
    };
  };

  const finalizeCompletedBackup = async (pending: PendingBackup, state: NativeBackupUploadState) => {
    const uploaded = pending.uploaded ?? (state.url && state.public_id
      ? { url: state.url, public_id: state.public_id }
      : undefined);
    if (!uploaded) {
      showBackupFailure(new Error('Cloudinary completed the upload without returning the backup URL.'));
      return;
    }
    const finalizationKey = state.uploadId || uploaded.public_id;
    if (finalizingBackupRef.current === finalizationKey) return;
    finalizingBackupRef.current = finalizationKey;
    setBackingUp(true);
    setBackupZipReady(true);
    setBackupUploadProgress(100);
    setBackupStep('Saving backup record...');
    try {
      const oldHistory = await getCloudinaryMeta('project_backups_v1').catch(() => null);
      const history = Array.isArray(oldHistory) ? oldHistory : [];
      const record = {
        ...pending.backupInfo,
        fileName: pending.outputName,
        url: uploaded.url,
        public_id: uploaded.public_id,
        sizeBytes: pending.sizeBytes,
      };
      await setCloudinaryMeta('project_backups_v1', [...history, record].slice(-25));
      setBackups(prev => [
        { ...record, created_at: String(record.backupDate || new Date().toISOString()), bytes: pending.sizeBytes },
        ...prev.filter(item => item.public_id !== uploaded.public_id),
      ]);
      await clearBackupUploadState(true);
      pendingBackupRef.current = null;
      lastBackupNoticeRef.current = '';
      setBackupStep('Backup completed');
      Alert.alert(
        '✅ Backup completed',
        `${pending.outputName}\n\nAPK + Projects data + ${String(pending.backupInfo['mediaCount'] ?? 0)} media file(s) Cloudinary-ல் save ஆச்சு.`,
      );
    } catch (error) {
      showBackupFailure(error);
    } finally {
      finalizingBackupRef.current = null;
      setBackingUp(false);
      setBackupStep('');
      setBackupZipReady(false);
      setBackupUploadProgress(0);
    }
  };

  const startOrResumePendingBackup = async (pending: PendingBackup, state?: NativeBackupUploadState | null) => {
    lastBackupNoticeRef.current = '';
    cancelRequestedRef.current = false;
    setBackingUp(true);
    setBackupZipReady(true);
    const currentProgress = state && state.totalBytes > 0
      ? Math.round((state.uploadedBytes / state.totalBytes) * 100)
      : 0;
    setBackupUploadProgress(Math.min(100, Math.max(0, currentProgress)));
    setBackupStep(`Uploading Backup... ${currentProgress}%`);
    await startBackupUpload({
      filePath: pending.zipPath,
      outputName: pending.outputName,
      cloudName: CLOUDINARY_UPLOAD_CLOUD,
      uploadPreset: CLOUDINARY_UPLOAD_PRESET,
      folder: 'my-girls/storage/projects/Backup',
      mimeType: 'application/zip',
      sizeBytes: pending.sizeBytes,
      backupInfoJson: JSON.stringify(pending.backupInfo),
    });
  };

  const syncBackupUploadState = useCallback(async () => {
    if (albumKey !== 'projects') return;
    const state = await getBackupUploadState().catch(() => null);
    if (!state || !state.status) return;

    let pending = pendingBackupRef.current;
    if (!pending && state.filePath) {
      pending = pendingFromNativeState(state);
      pendingBackupRef.current = pending;
    }
    if (!pending) return;

    const total = Number(state.totalBytes || pending.sizeBytes || 0);
    const uploaded = Number(state.uploadedBytes || 0);
    const percent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
    setBackupZipReady(true);
    setBackupUploadProgress(percent);

    if (state.status === 'starting' || state.status === 'uploading') {
      if (cancelRequestedRef.current) {
        setBackingUp(false);
        setBackupStep('Backup paused by user');
        return;
      }
      setBackingUp(true);
      setBackupStep(`Uploading Backup... ${percent}%`);
      return;
    }

    if (state.status === 'completed') {
      pending.uploaded = state.url && state.public_id ? { url: state.url, public_id: state.public_id } : pending.uploaded;
      await finalizeCompletedBackup(pending, state);
      return;
    }

    if (state.status === 'failed' || state.status === 'paused') {
      setBackingUp(false);
      setBackupStep('');
      if (cancelRequestedRef.current && state.status === 'paused') {
        lastBackupNoticeRef.current = `${state.uploadId}:${state.status}:${state.error || ''}:${state.uploadedBytes}`;
        return;
      }
      const noticeKey = `${state.uploadId}:${state.status}:${state.error || ''}:${state.uploadedBytes}`;
      if (lastBackupNoticeRef.current === noticeKey) return;
      lastBackupNoticeRef.current = noticeKey;
      Alert.alert(
        state.status === 'paused' ? 'Backup paused' : 'Backup upload failed',
        `${state.error || 'Upload stopped unexpectedly'}\n\n${percent}% வரை upload ஆனது.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => { void discardPendingBackup(); },
          },
          { text: 'Resume', onPress: () => setTimeout(() => runProjectBackupRef.current(), 0) },
        ],
      );
    }
  }, [albumKey]);

  const cancelProjectBackup = () => {
    if (!backingUp || !backupZipReady || !backupStep.startsWith('Uploading Backup')) return;
    Alert.alert(
      'Cancel Backup Upload?',
      'இதுவரை upload ஆன ZIP பாதுகாப்பாக இருக்கும். பின்னர் Backup அழுத்தி இதே இடத்திலிருந்து Resume செய்யலாம்.',
      [
        { text: 'Keep Uploading', style: 'cancel' },
        {
          text: 'Cancel Backup',
          style: 'destructive',
          onPress: async () => {
            cancelRequestedRef.current = true;
            try {
              await cancelBackupUpload();
              await discardPendingBackup();
              Alert.alert(
                'Backup Cancelled',
                'இந்த backup முழுமையாக cancel செய்யப்பட்டது. புதிய Backup அழுத்தினால் fresh upload தொடங்கும்.',
                [{ text: 'OK', style: 'cancel' }],
              );
            } catch (error) {
              cancelRequestedRef.current = false;
              const reason = error instanceof Error ? error.message : String(error || 'Unknown cancel error');
              Alert.alert('Cancel failed', reason);
            }
          },
        },
      ],
    );
  };

  const runProjectBackup = async () => {
    if (albumKey !== 'projects' || backingUp) return;
    cancelRequestedRef.current = false;
    const nativeState = await getBackupUploadState().catch(() => null);
    let pending = pendingBackupRef.current;

    if (!pending && nativeState?.filePath && nativeState.status !== 'idle') {
      pending = pendingFromNativeState(nativeState);
      pendingBackupRef.current = pending;
    }
    if (pending) {
      if (nativeState?.status === 'completed') {
        await finalizeCompletedBackup(pending, nativeState);
      } else {
        try {
          await startOrResumePendingBackup(pending, nativeState);
        } catch (error) {
          showBackupFailure(error);
        }
      }
      return;
    }

    setBackingUp(true);
    setBackupStep('Creating Backup...');
    setBackupZipReady(false);
    setBackupUploadProgress(0);
    try {
      const apkInfo = await getInstalledApkInfo();
      setBackupStep('Collecting Projects data...');
      const collected = await collectProjectBackup();
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const outputName = `MyDreamWoman_FullBackup_${stamp}.zip`;
      const backupInfo = {
        appName: 'My Dream Women',
        packageName: apkInfo.packageName,
        version: apkInfo.versionName,
        buildNumber: apkInfo.versionCode,
        backupDate: new Date().toISOString(),
        backupType: 'full',
        apkFormat: 'single-apk',
        mediaCount: collected.mediaFiles.length,
      };

      setBackupStep('Creating ZIP...');
      const zip = await createBackupZip({
        outputName,
        backupInfoJson: JSON.stringify(backupInfo, null, 2),
        projectDataJson: JSON.stringify(collected.projectData, null, 2),
        mediaFilesJson: JSON.stringify(collected.mediaFiles),
      });
      pending = {
        zipPath: zip.path,
        outputName,
        sizeBytes: zip.sizeBytes,
        backupInfo,
      };
      pendingBackupRef.current = pending;
      await startOrResumePendingBackup(pending, null);
    } catch (error) {
      showBackupFailure(error);
    }
  };

  const confirmProjectBackup = () => {
    if (albumKey !== 'projects' || backingUp) return;
    Alert.alert(
      'Backup Projects?',
      'இதில் சேரும்:\n✓ Current installed App APK\n✓ Projects folder structure\n✓ Project files/data\n✓ BackupInfo.json',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Backup', onPress: runProjectBackup },
      ],
    );
  };

  runProjectBackupRef.current = runProjectBackup;

  useEffect(() => {
    if (albumKey !== 'projects') return;
    let active = true;
    const subscription = addBackupUploadListener(() => {
      if (active) syncBackupUploadState();
    });
    const poll = () => { if (active) syncBackupUploadState(); };
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      subscription.remove();
      clearInterval(timer);
    };
  }, [albumKey, syncBackupUploadState]);

  // ── Upload selected MediaLibrary assets ─────────────────────────
  const doMediaUpload = async (mode: 'copy' | 'cut') => {
    const selected = phoneAssets.filter(a => pickerSel.has(a.id));
    if (!selected.length) return;

    const total = selected.length;
    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(total);

    const folder = currentFolder
      ? `my-girls/storage/${albumKey}/${currentFolder.id}`
      : `my-girls/storage/${albumKey}`;

    const uploaded: { cloudFile: CloudFile; asset: MediaLibrary.Asset }[] = [];
    const failures: { name: string; reason: string }[] = [];

    // Lazy-import expo-file-system/legacy for content:// → file:// cache copy
    const Legacy = await import('expo-file-system/legacy').catch(() => null as any);
    const cacheDir = Legacy?.cacheDirectory || '';

    for (let i = 0; i < selected.length; i++) {
      const asset = selected[i];
      const fname = asset.filename || `file_${i + 1}`;
      let cachedTmp: string | null = null;
      try {
        // getAssetInfoAsync fails for screenshots/Chrome downloads (ExifInterface restricted)
        // Fall back to basic asset URI to avoid blocking the upload
        let localUri = asset.uri;
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset);
          localUri = info.localUri ?? info.uri ?? asset.uri;
        } catch {
          localUri = asset.uri;
        }
        const srcUri = localUri;
        if (!srcUri) throw new Error('URI கிடைக்கல');
        const mime   = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

        // HMOS fix: copy content:// → file:// in app cache so upload works reliably
        let uploadUri = srcUri;
        if (Legacy && cacheDir && (srcUri.startsWith('content://') || srcUri.startsWith('ph://'))) {
          const ext = asset.mediaType === 'video' ? 'mp4' : 'jpg';
          cachedTmp = `${cacheDir}upload_${Date.now()}_${i}.${ext}`;
          try {
            await Legacy.copyAsync({ from: srcUri, to: cachedTmp });
            uploadUri = cachedTmp;
          } catch (copyErr: any) {
            // copy failed — fall back to original URI (upload may still try)
            console.warn('Cache copy failed, using original URI:', copyErr?.message);
            cachedTmp = null;
          }
        }

        const result = await uploadUriToCloudinary(uploadUri, mime, folder);
        uploaded.push({ cloudFile: { url: result.url, public_id: result.public_id, isVideo: asset.mediaType === 'video' }, asset });
        trackCloudinaryUpload(folder, result.public_id, result.url).catch(() => {});
      } catch (e: any) {
        const reason = (e?.message || String(e) || 'unknown').slice(0, 120);
        failures.push({ name: fname, reason });
        console.warn(`Upload failed for asset ${i} (${fname}):`, reason);
      } finally {
        if (cachedTmp && Legacy) {
          try { await Legacy.deleteAsync(cachedTmp, { idempotent: true }); } catch {}
        }
      }
      setUploadProgress(i + 1);
    }

    // Save to local cache + update screen
    if (uploaded.length > 0) {
      const key = filesKey(albumKey, currentFolder?.id);
      const existing = await AsyncStorage.getItem(key).catch(() => null);
      const prev: CloudFile[] = existing ? JSON.parse(existing) : [];
      const existingIds = new Set(prev.map(f => f.public_id));
      const newOnes = uploaded.map(u => u.cloudFile).filter(f => !existingIds.has(f.public_id));
      const updated = [...newOnes, ...prev];
      await AsyncStorage.setItem(key, JSON.stringify(updated));
      setFiles(updated);
    }

    // Cut: delete from phone
    let cutDeleteFailed = false;
    if (mode === 'cut' && uploaded.length > 0) {
      try {
        // deleteAssetsAsync resolves to a boolean — on Android 11+, if the user
        // dismisses the system delete-confirmation dialog, it resolves to
        // `false` instead of throwing. We must check this, not just await it.
        const deleted = await MediaLibrary.deleteAssetsAsync(uploaded.map(u => u.asset));
        if (!deleted) {
          cutDeleteFailed = true;
        }
      } catch {
        // MediaLibrary deletion can fail if the system confirmation is dismissed.
        cutDeleteFailed = true;
      }
      if (cutDeleteFailed) {
        Alert.alert(
          '⚠️ Delete பண்ண முடியல',
          'Upload ஆச்சு ✅ ஆனா phone-ல் delete ஆகல. Delete confirm popup-ல "Allow" press பண்ணி மீண்டும் முயற்சி செய்யுங்கள்.',
        );
      }
    }

    setUploading(false);
    setUploadProgress(0);
    setUploadTotal(0);
    setPickerSel(new Set());

    const reasonsText = failures.length
      ? '\n\nFail reasons:\n' + failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n')
      : '';
    if (uploaded.length === 0 && total > 0) {
      Alert.alert('❌ Upload பிழை', `0/${total} files saved.` + reasonsText);
    } else if (!(mode === 'cut')) {
      Alert.alert(
        failures.length ? '⚠️ Partial Upload' : '✅ Upload ஆச்சு!',
        `${uploaded.length}/${total} files cloud-ல் save ஆச்சு.` + reasonsText,
      );
    } else if (uploaded.length > 0 && !cutDeleteFailed) {
      Alert.alert(
        failures.length ? '⚠️ Partial Cut' : '✅ Cut & Upload ஆச்சு!',
        `${uploaded.length}/${total} files cloud-ல் save ஆச்சு, phone-ல் delete ஆச்சு.` + reasonsText,
      );
    } else if (uploaded.length > 0 && cutDeleteFailed) {
      Alert.alert(
        '⚠️ Upload ஆச்சு, ஆனா Delete ஆகல',
        `${uploaded.length}/${total} files cloud-ல் save ஆச்சு. Phone-ல் இன்னும் இருக்கும்.` + reasonsText,
      );
    }
  };

  // ── New cloud sub-folder ─────────────────────────────────────────
  const confirmNewFolder = async () => {
    const name = folderName.trim();
    if (!name) { Alert.alert('பிழை', 'Folder பெயர் உள்ளிடுங்க'); return; }
    const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const updated = [...subFolders, { id, label: name }];
    setSubFolders(updated);
    await AsyncStorage.setItem(foldersKey(albumKey), JSON.stringify(updated));
    setCloudinaryMeta(`gallery_folders_${albumKey}`, updated).catch(() => {}); // cloud backup
    setFolderDialog(false);
    setFolderName('');
    Alert.alert('✅', `"${name}" folder உருவாக்கப்பட்டது!`);
  };

  // ── Delete selected cloud files ──────────────────────────────────
  const deleteCloudSelected = async () => {
    const ids = [...cloudSelIds];
    setCloudSelMode(false);
    setCloudSelIds(new Set());
    for (const id of ids) { try { await deleteFromCloudinary(id); } catch {} }
    const key = filesKey(albumKey, currentFolder?.id);
    const idSet = new Set(ids);
    setFiles(prev => {
      const updated = prev.filter(f => !idSet.has(f.public_id));
      AsyncStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────
  const headerTitle = depth === 1 && currentFolder
    ? `${meta.emoji} ${currentFolder.label}`
    : isChatSelectMode ? '📂 Select Photo / Video' : `${meta.emoji} ${meta.label}`;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { backgroundColor: meta.color, paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={depth === 1 ? goUp : () => router.back()} style={s.backBtn}>
          <Text style={s.backTxt}>{depth === 1 ? '‹ Back' : '‹'}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        {cloudSelMode
          ? <TouchableOpacity onPress={() => { setCloudSelMode(false); setCloudSelIds(new Set()); }} style={s.backBtn}>
              <Text style={s.backTxt}>✕</Text>
            </TouchableOpacity>
          : <View style={{ width: 60 }} />}
      </View>

      {/* Upload progress */}
      {uploading && (
        <View style={s.uploadBar}>
          {backupFileUploadProgress !== null ? (
            <>
              <Text style={s.uploadBarTxt}>📦 Backup Uploading... {backupFileUploadProgress}%</Text>
              <View style={s.backupFileBarBg}>
                <View style={[s.backupFileBarFill, { width: `${backupFileUploadProgress}%` as any }]} />
              </View>
            </>
          ) : (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={s.uploadBarTxt}>Upload பண்றேன்... {uploadProgress}/{uploadTotal}</Text>
            </>
          )}
        </View>
      )}
      {backingUp && (
        <View style={s.backupProgressCard}>
          <Text style={s.backupProgressTitle}>Creating Backup</Text>
          <Text style={s.backupProgressRow}>APK <Text style={s.backupDone}>✓</Text></Text>
          <Text style={s.backupProgressRow}>Project Data <Text style={s.backupDone}>✓</Text></Text>
          <Text style={s.backupProgressRow}>Creating ZIP <Text style={s.backupProgressValue}>{backupZipReady ? '68%' : '...'}</Text></Text>
          <Text style={s.backupProgressRow}>Uploading Backup <Text style={s.backupProgressValue}>{backupZipReady ? `${backupUploadProgress}%` : '0%'}</Text></Text>
          <View style={s.backupBarBg}>
            <View style={[s.backupBarFill, { width: `${backupZipReady ? 68 + Math.round(backupUploadProgress * 0.32) : 18}%` as any }]} />
          </View>
          {!!backupStep && <Text style={s.backupProgressHint}>{backupStep}</Text>}
          {backupZipReady && backupStep.startsWith('Uploading Backup') && (
            <TouchableOpacity style={s.backupCancelBtn} onPress={cancelProjectBackup}>
              <Text style={s.backupCancelTxt}>✕ Cancel Backup</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Cloud selection bar */}
      {cloudSelMode && cloudSelIds.size > 0 && (
        <View style={s.selBar}>
          <Text style={s.selCount}>{cloudSelIds.size} selected</Text>
          <TouchableOpacity style={s.selDelBtn} onPress={deleteCloudSelected}>
            <Text style={s.selDelTxt}>🗑️ Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={{ flex: 1, backgroundColor: '#111' }} contentContainerStyle={{ paddingBottom: 24 }}>

        {/* Action buttons */}
        {!isChatSelectMode && (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={[s.uploadBtn, albumKey === 'icons' && { backgroundColor: '#FF6B35' }]}
              onPress={albumKey === 'icons'
                ? pickIconWithCrop
                : albumKey === 'projects'
                ? pickProjectDocuments
                : openFolderBrowser}
              disabled={uploading || backingUp}
            >
              <Text style={s.uploadBtnTxt}>
                {albumKey === 'icons' ? '🎨 Icon Upload (1:1)' : '⬆ Upload'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.newFolderBtn} disabled={uploading || backingUp} onPress={() => { setFolderName(''); setFolderDialog(true); }}>
              <Text style={s.newFolderTxt}>📁 New Folder</Text>
            </TouchableOpacity>
            {albumKey === 'projects' && depth === 0 && (
              <TouchableOpacity style={s.backupBtn} disabled={uploading || backingUp} onPress={confirmProjectBackup}>
                <Text style={s.backupBtnTxt}>💾 Backup</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Sub-folders */}
        {depth === 0 && subFolders.length > 0 && (
          <View style={s.foldersRow}>
            {subFolders.map(folder => (
              <TouchableOpacity key={folder.id} style={s.folderChip} onPress={() => goIntoFolder(folder)}>
                <Text style={s.folderChipEmoji}>📁</Text>
                <Text style={s.folderChipLabel} numberOfLines={1}>{folder.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {albumKey === 'projects' && depth === 0 && backups.length > 0 && (
          <View style={s.backupsSection}>
            <View style={s.backupsHeader}>
              <Text style={s.backupsTitle}>☁️ Backup files</Text>
              <Text style={s.backupsCount}>{backups.length}</Text>
            </View>
            {backups.map(backup => {
              const size = backup.sizeBytes ?? backup.bytes;
              const sizeText = typeof size === 'number' && size > 0
                ? `${(size / (1024 * 1024)).toFixed(1)} MB`
                : 'ZIP backup';
              const date = backup.backupDate || backup.created_at;
              return (
                <TouchableOpacity
                  key={backup.public_id}
                  style={s.backupFileRow}
                  onPress={() => Linking.openURL(backup.url).catch(() => Alert.alert('Download error', 'Backup open ஆகவில்லை'))}
                >
                  <Text style={s.backupFileIcon}>ZIP</Text>
                  <View style={s.backupFileInfo}>
                    <Text style={s.backupFileName} numberOfLines={1}>{backup.fileName}</Text>
                    <Text style={s.backupFileMeta}>{date ? new Date(date).toLocaleString('en-IN') : 'Cloudinary backup'} · {sizeText}</Text>
                  </View>
                  <Text style={s.backupDownload}>↓</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Cloud files grid */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={meta.color} size="large" />
            <Text style={s.loadingTxt}>Cloud-ல் இருந்து load பண்றேன்...</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyEmoji}>{meta.emoji}</Text>
            <Text style={s.emptyTxt}>
              {depth === 1 ? `${currentFolder?.label} empty` : `${meta.label} empty`}
              {'\n'}⬆ Upload பண்ணுங்க
            </Text>
          </View>
        ) : (
          <View style={s.grid}>
            {files.map(file => {
              const isSel = cloudSelIds.has(file.public_id);
              return (
                <TouchableOpacity key={file.public_id}
                  style={[s.thumb, isSel && s.thumbSel]}
                  onPress={() => cloudSelMode ? setCloudSelIds(prev => { const n = new Set(prev); n.has(file.public_id) ? n.delete(file.public_id) : n.add(file.public_id); return n; }) : setFullView(file)}
                  onLongPress={() => { setCloudSelMode(true); setCloudSelIds(new Set([file.public_id])); }}
                  activeOpacity={0.85}>
                  {file.isRaw
                    ? <View style={[s.thumbImg, { backgroundColor: '#20233a', alignItems: 'center', justifyContent: 'center', padding: 6 }]}><Text style={{ color: '#f6c453', fontWeight: '800', fontSize: 18 }}>{(file.format || file.fileName?.split('.').pop() || 'FILE').toUpperCase().slice(0, 5)}</Text><Text style={{ color: '#aaa', fontSize: 9, marginTop: 4 }}>RAW FILE</Text></View>
                    : file.isVideo
                    ? <View style={[s.thumbImg, s.videoThumb]}><Text style={s.videoPlay}>▶</Text></View>
                    : <Image source={{ uri: file.url }} style={s.thumbImg} resizeMode="cover" />}
                  {isSel && <View style={s.checkOverlay}><Text style={s.checkTxt}>✓</Text></View>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── MODAL 1: Phone Albums browser ───────────────────────── */}
      <Modal visible={showAlbums} animationType="slide" onRequestClose={() => { setShowAlbums(false); if (isChatSelectMode) router.back(); }}>
        <SafeAreaView style={[s.safe, { backgroundColor: '#1a1a1a' }]} edges={['bottom']}>
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <View style={[s.header, { backgroundColor: meta.color, paddingTop: insets.top + 14 }]}>
            <TouchableOpacity onPress={() => { setShowAlbums(false); if (isChatSelectMode) router.back(); }} style={s.backBtn}>
              <Text style={s.backTxt}>✕</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>{isChatSelectMode ? '📂 Choose a folder' : '📂 Phone Folders'}</Text>
            <View style={{ width: 60 }} />
          </View>
          {loadingAlbums ? (
            <View style={s.center}>
              <ActivityIndicator color={meta.color} size="large" />
              <Text style={s.loadingTxt}>Folders load பண்றேன்...</Text>
            </View>
          ) : (
            <FlatList
              data={phoneAlbums}
              keyExtractor={a => a.id}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.albumRow} onPress={() => openAlbumAssets(item)}>
                  <Text style={s.albumIcon}>📁</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.albumName}>{item.title}</Text>
                    <Text style={s.albumCount}>{item.assetCount ?? 0} files</Text>
                  </View>
                  <Text style={s.albumArrow}>›</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={s.sep} />}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyEmoji}>📭</Text>
                <Text style={[s.emptyTxt, { paddingHorizontal: 24 }]}>
                  {'Folders கிடைக்கல.\n\nSettings → Apps → My Girls →\nPermissions → Files & Media → Allow all\n\nபிறகு App close செய்து மீண்டும் திறங்க.'}
                </Text>
                <TouchableOpacity
                  style={[s.doneBtn, { backgroundColor: meta.color, marginTop: 24, minWidth: 140, paddingVertical: 12 }]}
                  onPress={() => { setShowAlbums(false); setTimeout(() => openFolderBrowser(), 400); }}
                >
                  <Text style={s.doneBtnTxt}>🔄 Retry</Text>
                </TouchableOpacity>
                {!isChatSelectMode && <TouchableOpacity
                  style={[s.doneBtn, { backgroundColor: '#444', marginTop: 12, minWidth: 140, paddingVertical: 12 }]}
                  onPress={async () => {
                    setShowAlbums(false);
                    setTimeout(async () => {
                      try {
                        const perm = await requestPhotoVideoPermissionsAsync();
                        if (!perm.granted) {
                          Alert.alert('Permission வேணும்', 'Gallery access allow பண்ணுங்க');
                          return;
                        }
                        const res = await ImagePicker.launchImageLibraryAsync({
                          mediaTypes: ImagePicker.MediaTypeOptions.All,
                          allowsMultipleSelection: true,
                          quality: 0.9,
                        });
                        if (!res.canceled && res.assets?.length) {
                          setUploading(true);
                          setUploadProgress(0);
                          setUploadTotal(res.assets.length);
                          const folder = currentFolder
                            ? `my-girls/storage/${albumKey}/${currentFolder.id}`
                            : `my-girls/storage/${albumKey}`;
                          const uploaded: CloudFile[] = [];
                          for (let i = 0; i < res.assets.length; i++) {
                            try {
                              const a = res.assets[i];
                              const mime = a.type?.startsWith('video') ? 'video/mp4' : 'image/jpeg';
                              const result = await uploadUriToCloudinary(a.uri, mime, folder);
                              uploaded.push({ url: result.url, public_id: result.public_id });
                            } catch {}
                            setUploadProgress(i + 1);
                          }
                          if (uploaded.length > 0) {
                            const key = filesKey(albumKey, currentFolder?.id);
                            const existing = await AsyncStorage.getItem(key).catch(() => null);
                            const prev: CloudFile[] = existing ? JSON.parse(existing) : [];
                            const updated = [...uploaded, ...prev.filter(f => !uploaded.some(u => u.public_id === f.public_id))];
                            await AsyncStorage.setItem(key, JSON.stringify(updated));
                            setFiles(updated);
                            Alert.alert('✅ Upload ஆச்சு!', `${uploaded.length} file${uploaded.length > 1 ? 's' : ''} Cloud-ல் save ஆனது.`);
                          }
                          setUploading(false);
                        }
                      } catch (e: any) {
                        setUploading(false);
                        Alert.alert('பிழை', (e as any)?.message || 'Gallery திறக்கல');
                      }
                    }, 300);
                  }}
                >
                  <Text style={s.doneBtnTxt}>🖼️ Gallery திற</Text>
                </TouchableOpacity>}
              </View>
            }
          />
          )}
        </SafeAreaView>
      </Modal>

      {/* ── MODAL 2: Files in selected album ────────────────────── */}
      <Modal visible={showAssets} animationType="slide" onRequestClose={() => setShowAssets(false)}>
        <SafeAreaView style={[s.safe, { backgroundColor: '#111' }]} edges={['top','bottom']}>
          <View style={[s.header, { backgroundColor: meta.color }]}>
            <TouchableOpacity onPress={() => setShowAssets(false)} style={s.backBtn}>
              <Text style={s.backTxt}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle} numberOfLines={1}>
              {selectedAlbumLib?.title ?? 'Files'}
            </Text>
            {pickerSel.size > 0 ? (
              <TouchableOpacity onPress={confirmSelection} style={[s.doneBtn, { backgroundColor: meta.color }]}>
                <Text style={s.doneBtnTxt}>{isChatSelectMode ? 'Use this' : `Done (${pickerSel.size})`}</Text>
              </TouchableOpacity>
            ) : <View style={{ width: 80 }} />}
          </View>

          {pickerSel.size > 0 && (
            <View style={s.pickerSelBar}>
              <Text style={s.pickerSelTxt}>{pickerSel.size} file{pickerSel.size > 1 ? 's' : ''} select ஆச்சு</Text>
              <TouchableOpacity style={[s.selDelBtn, { backgroundColor: meta.color }]} onPress={confirmSelection}>
                <Text style={s.selDelTxt}>{isChatSelectMode ? 'Use this' : '⬆ Upload'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {loadingAssets ? (
            <View style={s.center}>
              <ActivityIndicator color={meta.color} size="large" />
              <Text style={s.loadingTxt}>Files load பண்றேன்...</Text>
            </View>
          ) : phoneAssets.length === 0 ? (
            <View style={s.center}>
              <Text style={s.emptyEmoji}>📭</Text>
              <Text style={s.emptyTxt}>இந்த folder-ல் files இல்லை</Text>
            </View>
          ) : (
            <FlatList
              data={phoneAssets}
              keyExtractor={a => a.id}
              numColumns={COLS}
              contentContainerStyle={{ gap: 2, padding: 2 }}
              columnWrapperStyle={{ gap: 2 }}
              renderItem={({ item }) => {
                const isSel = pickerSel.has(item.id);
                return (
                  <TouchableOpacity
                    style={[s.thumb, isSel && s.thumbSel]}
                    onPress={() => {
                      if (isChatSelectMode) {
                        setPickerSel(new Set([item.id]));
                      } else {
                        togglePickerSel(item.id);
                      }
                    }}
                    activeOpacity={0.8}>
                    <Image source={{ uri: item.uri }} style={s.thumbImg} resizeMode="cover" />
                    {item.mediaType === 'video' && (
                      <View style={s.videoTag}><Text style={s.videoTagTxt}>▶</Text></View>
                    )}
                    {isSel && <View style={s.checkOverlay}><Text style={s.checkTxt}>✓</Text></View>}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Full view modal */}
      <Modal visible={!!fullView} transparent animationType="fade" onRequestClose={() => setFullView(null)}>
        {fullView && (
          <View style={s.previewBg}>
            <TouchableOpacity style={s.previewClose} onPress={() => setFullView(null)}>
              <Text style={s.previewCloseTxt}>✕</Text>
            </TouchableOpacity>
            {fullView.isRaw
              ? <View style={{ alignItems: 'center', padding: 24 }}><Text style={{ fontSize: 64 }}>📄</Text><Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 14, textAlign: 'center' }}>{fullView.fileName || fullView.public_id.split('/').pop()}</Text><TouchableOpacity style={{ backgroundColor: '#6C63FF', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, marginTop: 18 }} onPress={() => Linking.openURL(fullView.url).catch(() => Alert.alert('Download error', 'File open ஆகவில்லை'))}><Text style={{ color: '#fff', fontWeight: '700' }}>Open / Download</Text></TouchableOpacity></View>
              : fullView.isVideo
              ? <View style={s.videoPreview}><Text style={{ fontSize: 64 }}>▶</Text></View>
              : <Image source={{ uri: fullView.url }} style={s.previewImg} resizeMode="contain" />}
          </View>
        )}
      </Modal>

      {/* New cloud sub-folder dialog */}
      <Modal visible={folderDialog} transparent animationType="fade" onRequestClose={() => setFolderDialog(false)}>
        <View style={s.dialogOverlay}>
          <View style={s.dialog}>
            <Text style={s.dialogTitle}>📁 New Folder</Text>
            <TextInput style={s.dialogInput} placeholder="Folder பெயர்..." placeholderTextColor="#aaa"
              value={folderName} onChangeText={setFolderName} autoFocus onSubmitEditing={confirmNewFolder} />
            <View style={s.dialogBtns}>
              <TouchableOpacity style={s.dialogCancel} onPress={() => setFolderDialog(false)}>
                <Text style={s.dialogCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogOk, { backgroundColor: meta.color }]} onPress={confirmNewFolder}>
                <Text style={s.dialogOkTxt}>உருவாக்கு</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: '#111' },
  header:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12 },
  backBtn:        { minWidth: 60 },
  backTxt:        { color: '#fff', fontSize: 17, fontWeight: '600' },
  headerTitle:    { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  doneBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  doneBtnTxt:     { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  uploadBar:      { flexDirection: 'row', backgroundColor: '#1565C0', padding: 10, gap: 10, alignItems: 'center' },
  uploadBarTxt:   { color: '#fff', fontSize: 14 },
  backupFileBarBg: { height: 6, flex: 1, minWidth: 90, marginLeft: 8, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  backupFileBarFill: { height: '100%', borderRadius: 3, backgroundColor: '#7CFFB2' },
  backupProgressCard: { marginHorizontal: 14, marginTop: 10, padding: 18, backgroundColor: '#f3f3f3', borderRadius: 18, borderWidth: 1, borderColor: '#ddd' },
  backupProgressTitle: { color: '#222', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  backupProgressRow: { color: '#222', fontSize: 14, marginBottom: 7 },
  backupDone: { color: '#111', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  backupProgressValue: { color: '#222', marginLeft: 18 },
  backupBarBg: { height: 12, backgroundColor: '#ddd', borderRadius: 6, overflow: 'hidden', marginTop: 10 },
  backupBarFill: { height: '100%', backgroundColor: '#111', borderRadius: 6 },
  backupProgressHint: { color: '#666', fontSize: 12, marginTop: 9 },
  backupCancelBtn: { marginTop: 12, backgroundColor: '#7f1d1d', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  backupCancelTxt: { color: '#fecaca', fontSize: 13, fontWeight: '800' },
  backupsSection: { marginHorizontal: 14, marginBottom: 12, padding: 12, backgroundColor: '#1a2340', borderRadius: 14 },
  backupsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backupsTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  backupsCount: { color: '#FFD700', fontWeight: '800' },
  backupFileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111827', borderRadius: 10, padding: 10, marginTop: 7 },
  backupFileIcon: { color: '#FFD700', fontSize: 11, fontWeight: '900', borderWidth: 1, borderColor: '#FFD700', borderRadius: 5, padding: 5, marginRight: 10 },
  backupFileInfo: { flex: 1 },
  backupFileName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  backupFileMeta: { color: '#9ca3af', fontSize: 10, marginTop: 3 },
  backupDownload: { color: '#60a5fa', fontSize: 26, fontWeight: '700', paddingHorizontal: 6 },
  selBar:         { flexDirection: 'row', backgroundColor: '#333', padding: 10, alignItems: 'center', gap: 12 },
  selCount:       { color: '#fff', fontSize: 14, flex: 1 },
  selDelBtn:      { backgroundColor: '#c62828', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  selDelTxt:      { color: '#fff', fontSize: 13, fontWeight: '600' },
  pickerSelBar:   { flexDirection: 'row', backgroundColor: '#222', padding: 10, alignItems: 'center', gap: 12 },
  pickerSelTxt:   { color: '#fff', fontSize: 14, flex: 1 },
  actionRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  uploadBtn:      { flex: 1, backgroundColor: '#E8821A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  uploadBtnTxt:   { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  newFolderBtn:   { flex: 1, backgroundColor: '#444', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  backupBtn:      { width: '100%', backgroundColor: '#5E35B1', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  backupBtnTxt:   { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  iconCropBtn:    { marginHorizontal: 14, marginBottom: 10, backgroundColor: '#FF6B35', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  iconCropBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  newFolderTxt:   { color: '#ccc', fontSize: 16, fontWeight: '600' },
  foldersRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  folderChip:     { backgroundColor: '#2a2a2a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  folderChipEmoji:{ fontSize: 18 },
  folderChipLabel:{ color: '#ddd', fontSize: 13, fontWeight: '500' },
  grid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingHorizontal: 2 },
  thumb:          { width: THUMB, height: THUMB, overflow: 'hidden' },
  thumbSel:       { opacity: 0.55 },
  thumbImg:       { width: THUMB, height: THUMB },
  videoThumb:     { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  videoPlay:      { fontSize: 32, color: '#fff' },
  videoTag:       { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  videoTagTxt:    { color: '#fff', fontSize: 10 },
  checkOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  checkTxt:       { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  center:         { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  loadingTxt:     { color: '#aaa', marginTop: 14, fontSize: 14 },
  emptyEmoji:     { fontSize: 56, marginBottom: 12 },
  emptyTxt:       { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 24 },
  albumRow:       { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#1e1e1e' },
  albumIcon:      { fontSize: 28, marginRight: 12 },
  albumName:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  albumCount:     { color: '#888', fontSize: 12, marginTop: 2 },
  albumArrow:     { color: '#888', fontSize: 24 },
  sep:            { height: 1, backgroundColor: '#2a2a2a' },
  previewBg:      { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  previewClose:   { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 },
  previewCloseTxt:{ color: '#fff', fontSize: 24 },
  previewImg:     { width: '100%', height: '80%' },
  videoPreview:   { alignItems: 'center', justifyContent: 'center' },
  dialogOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog:         { backgroundColor: '#222', borderRadius: 16, padding: 24, width: '100%' },
  dialogTitle:    { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  dialogInput:    { backgroundColor: '#333', color: '#fff', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 20 },
  dialogBtns:     { flexDirection: 'row', gap: 12 },
  dialogCancel:   { flex: 1, backgroundColor: '#444', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  dialogCancelTxt:{ color: '#ccc', fontSize: 15 },
  dialogOk:       { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  dialogOkTxt:    { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
