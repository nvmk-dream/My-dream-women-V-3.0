import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, StatusBar,
  Image, Dimensions, ScrollView, Platform, TextInput, Modal, BackHandler, NativeModules,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import { ALL_PERSONAS } from '../constants/personas';
import {
  listCloudinaryImages,
  trackCloudinaryUpload,
  uploadToCloudinary,
  uploadUriToCloudinary,
  deleteFromCloudinary,
  createCloudinaryFolder,
  getCloudinaryMeta,
  setCloudinaryMeta,
} from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';

const CUSTOM_CHARS_KEY = 'cloud_custom_chars';
const CUSTOM_STYLES_KEY = 'cloud_custom_styles';

const { width } = Dimensions.get('window');
const PHOTO_COL = 3;
const PHOTO_SIZE = (width - 4 * (PHOTO_COL + 1)) / PHOTO_COL;

const PHOTO_STYLES = [
  { id: 'breast',    label: 'Breast Show'  },
  { id: 'buttocks',  label: 'Buttocks'     },
  { id: 'cleavage',  label: 'Cleavage'     },
  { id: 'halfbreast',label: 'Half Breast'  },
  { id: 'highslit',  label: 'High Slit'    },
  { id: 'legs',      label: 'Legs Spread'  },
  { id: 'lingerie',  label: 'Lingerie'     },
  { id: 'lowneck',   label: 'Low Neckline' },
  { id: 'normal',    label: 'Normal Photo' },
  { id: 'nude',      label: 'Nude'         },
  { id: 'seductive', label: 'Seductive'    },
  { id: 'seminude',  label: 'Semi Nude'    },
  { id: 'sleeping',  label: 'Sleeping'     },
  { id: 'wet',       label: 'Wet Clothes'  },
  { id: 'saree',     label: 'Saree Tuck'   },
];

interface CloudPhoto { url: string; public_id: string }

type PickerAssetMetadata = {
  uri: string;
  assetId: string | null;
  fileName: string | null;
  fileSize: number | null;
  width: number;
  height: number;
  mediaType: string;
  type: string;
  duration: number | null;
  creationTime: number | null;
  modificationTime: number | null;
};

type PickerAssetWithMetadata = {
  uri: string;
  assetId?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width: number;
  height: number;
  type: string;
  mimeType?: string | null;
  duration?: number | null;
  creationTime?: number | null;
  modificationTime?: number | null;
  exif?: Record<string, unknown>;
  cutMetadata?: PickerAssetMetadata;
};

type PickerAssetForDeletion = {
  pickerAsset: PickerAssetWithMetadata;
  folder: string;
  uploaded: { url: string; public_id: string };
};

type DeletionVerification = {
  deleted: boolean;
  detail: string;
};

type SafDocumentDeleteResult = {
  deleted: boolean;
  rows: number;
  detail: string;
};

const SafDocument = NativeModules.SafDocument as {
  deleteDocument: (uri: string) => Promise<SafDocumentDeleteResult>;
} | undefined;

async function deleteOriginalDocument(uri: string): Promise<SafDocumentDeleteResult> {
  if (!uri.startsWith('content://')) {
    return { deleted: false, rows: 0, detail: 'SAF deletion requires the original content:// URI' };
  }
  if (!SafDocument?.deleteDocument) {
    return { deleted: false, rows: 0, detail: 'SafDocument native module is unavailable in this APK' };
  }
  return SafDocument.deleteDocument(uri);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseExifDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getPickerMetadata(asset: PickerAssetWithMetadata): PickerAssetMetadata {
  const raw = asset as any;
  const exif = raw.exif ?? {};
  return {
    uri: asset.uri,
    assetId: asset.assetId ?? null,
    fileName: asset.fileName ?? null,
    fileSize: finiteNumber(raw.fileSize),
    width: asset.width,
    height: asset.height,
    mediaType: asset.type,
    type: asset.type,
    duration: finiteNumber(asset.duration),
    creationTime:
      finiteNumber(raw.creationTime) ??
      parseExifDate(exif.DateTimeOriginal) ??
      parseExifDate(exif.DateTimeDigitized) ??
      parseExifDate(exif.DateTime),
    modificationTime: finiteNumber(raw.modificationTime),
  };
}

async function verifyMediaLibraryDeletion(assetId: string): Promise<DeletionVerification> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    if (info) {
      return { deleted: false, detail: 'asset still returned by getAssetInfoAsync' };
    }
    return { deleted: true, detail: 'getAssetInfoAsync returned no asset' };
  } catch (error) {
    const detail = String(error);
    const notFound = /not found|no asset|does not exist|could not find|couldn't find/i.test(detail);
    return { deleted: notFound, detail: notFound ? `asset lookup not found: ${detail}` : detail };
  }
}

type Depth = 0 | 1 | 2;

const FOLDER_COLORS = ['#E91E63','#9C27B0','#3F51B5','#2196F3','#009688','#FF5722','#795548','#607D8B'];

export default function AIGirlsCloudScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ALREADY_PATCHED = true; const { charId } = useLocalSearchParams<{ charId?: string }>();

  const [depth, setDepth] = useState<Depth>(0);
  const [selectedChar, setSelectedChar] = useState<{ id: string; name: string; color: string; letter: string } | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<{ id: string; label: string } | null>(null);

  // Auto-select character when charId param provided (chat ☁️ shortcut)
  useEffect(() => {
    if (!charId) return;
    const persona = ALL_PERSONAS.find(p => p.id === charId);
    if (!persona) return;
    setSelectedChar({
      id: persona.id,
      name: persona.name,
      color: persona.avatarColor,
      letter: (persona as any).avatarLetter || persona.emoji,
    });
    setDepth(1);
  }, [charId]);

  // Photos state (depth 2)
  const [photos, setPhotos] = useState<CloudPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullView, setFullView] = useState<CloudPhoto | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  // Custom folders
  const [customChars, setCustomChars] = useState<{ id: string; name: string; color: string; letter: string }[]>([]);
  const [customStyles, setCustomStyles] = useState<{ id: string; label: string }[]>([]);

  // New Folder dialog
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState('');

  // Photo multi-select
  const [photoSelMode, setPhotoSelMode] = useState(false);
  const [photoSelIds, setPhotoSelIds] = useState<Set<string>>(new Set());

  // Custom delete confirm (Alert.alert blocked on Chrome web)
  const [deleteTarget, setDeleteTarget] = useState<CloudPhoto | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string; type: 'char' | 'style' } | null>(null);
  const [hiddenStyles, setHiddenStyles] = useState<Set<string>>(new Set()); // built-in styles hidden per char

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);

  // Load custom folders — AsyncStorage first (instant), then merge from Cloudinary (survives reinstall)
  // useFocusEffect: re-runs when navigating back from Settings (picks up newly added styles)
  useFocusEffect(useCallback(() => {
    const loadFolders = async () => {
      // Step 1: Load from AsyncStorage immediately (fast, works offline)
      const localCharsRaw = await AsyncStorage.getItem(CUSTOM_CHARS_KEY).catch(() => null);
      const localStylesRaw = await AsyncStorage.getItem(CUSTOM_STYLES_KEY).catch(() => null);
      const localChars = localCharsRaw ? JSON.parse(localCharsRaw) : [];
      const localStyles = localStylesRaw ? JSON.parse(localStylesRaw) : [];
      if (localChars.length) setCustomChars(localChars);
      if (localStyles.length) setCustomStyles(localStyles);

      // Step 2: Fetch from Cloudinary meta in background and merge (restores after reinstall)
      try {
        const [cloudChars, cloudStyles] = await Promise.all([
          getCloudinaryMeta('custom_chars'),
          getCloudinaryMeta('custom_styles'),
        ]);
        if (Array.isArray(cloudChars) && cloudChars.length > 0) {
          // Merge: add cloud-only entries that are missing locally
          const merged = [...localChars];
          for (const cc of cloudChars) {
            if (!merged.some((c: any) => c.id === cc.id)) merged.push(cc);
          }
          setCustomChars(merged);
          await AsyncStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(merged)).catch(() => {});
        }
        // Load global photo styles from Settings screen (overrides local custom styles)
        const globalStyles = await getGlobalPhotoStyles().catch(() => null);
        if (globalStyles && globalStyles.custom.length > 0) {
          setCustomStyles(globalStyles.custom);
          await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(globalStyles.custom)).catch(() => {});
        } else if (Array.isArray(cloudStyles) && cloudStyles.length > 0) {
          // Fallback: old custom_styles Cloudinary meta key
          const merged = [...localStyles];
          for (const cs of cloudStyles) {
            if (!merged.some((s: any) => s.id === cs.id)) merged.push(cs);
          }
          setCustomStyles(merged);
          await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(merged)).catch(() => {});
        }
      } catch { /* cloud fetch failed — local data still shown */ }
    };
    loadFolders();
  }, []));

  // Base personas
  const basePersonas = ALL_PERSONAS.filter(p => p.gender === 'female').map(p => ({
    id: p.id,
    name: p.name,
    color: p.avatarColor,
    letter: p.avatarLetter || p.name.charAt(0),
  }));

  const personas = [...basePersonas, ...customChars];
  const photoStyles = [...PHOTO_STYLES, ...customStyles].filter(s => !hiddenStyles.has(s.id));

  const handleNewFolder = () => {
    setFolderName('');
    setFolderDialog(true);
  };

  // ── Upload via System Picker (Cut / Copy) ────────────────────────────────

  const doUpload = async (
    pickedAssets: PickerAssetWithMetadata[],
    charId: string,
    styleId: string,
    styleLabel: string,
    action: 'cut' | 'copy',
  ) => {
    const total = pickedAssets.length;
    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(total);

    const newPhotos: CloudPhoto[] = [];
    const failures: { name: string; reason: string }[] = [];
    const uploadedAssets: PickerAssetForDeletion[] = [];
    let done = 0;

    for (let i = 0; i < pickedAssets.length; i++) {
      const asset = pickedAssets[i];
      const fname = asset.fileName || `file_${i + 1}`;
      const pickerMetadata = asset.cutMetadata ?? getPickerMetadata(asset);
      console.log('[CUT] picker-asset', JSON.stringify(pickerMetadata));
      console.log(`[CUT] original URI: ${pickerMetadata.uri}`);
      console.log(`[CUT] assetId: ${pickerMetadata.assetId ?? 'none'}`);
      console.log(`[CUT] mediaType: ${pickerMetadata.mediaType}`);
      try {
        const folder = `my-girls/${charId}/${styleId}`;
        const mime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
        const uploaded = await uploadUriToCloudinary(asset.uri, mime, folder);
        newPhotos.push({ url: uploaded.url, public_id: uploaded.public_id });
        // Track server-side so photos survive app reinstall
        trackCloudinaryUpload(folder, uploaded.public_id, uploaded.url).catch(() => {});
        uploadedAssets.push({ pickerAsset: asset, folder, uploaded });
        console.log(
          `[CUT] Cloudinary upload success | original URI: ${pickerMetadata.uri} | ` +
          `assetId=${pickerMetadata.assetId ?? 'none'} | mediaType=${pickerMetadata.mediaType} | ` +
          `public_id=${uploaded.public_id} | url=${uploaded.url}`,
        );
        done++;
      } catch (e: any) {
        const reason = (e?.message || String(e) || 'unknown').slice(0, 120);
        failures.push({ name: fname, reason });
        console.warn(`Upload failed (${fname}):`, reason);
      }
      setUploadProgress(i + 1);
    }

    // Save to cache + update UI
    if (newPhotos.length) {
      const key = `cloud_photos_${charId}_${styleId}`;
      const cached = await AsyncStorage.getItem(key);
      const existing: CloudPhoto[] = cached ? JSON.parse(cached) : [];
      const merged = [...newPhotos, ...existing];
      await AsyncStorage.setItem(key, JSON.stringify(merged));
      if (selectedChar?.id === charId && selectedStyle?.id === styleId) {
        setPhotos(merged);
      }
    }

    // CUT: delete only originals whose Cloudinary upload succeeded.
    // Delete originals through MediaLibrary asset IDs or Android SAF document URIs; never delete the cache copy.
    let cutDeletedCount = 0;
    const cutDeleteFailures: string[] = [];
    if (action === 'cut' && uploadedAssets.length > 0) {
      for (const { pickerAsset } of uploadedAssets) {
        const metadata = pickerAsset.cutMetadata ?? getPickerMetadata(pickerAsset);
        const logAssetId = metadata.assetId ?? 'none';
        console.log('[CUT] picker-asset', JSON.stringify(metadata));
        console.log(`[CUT] assetId | picker=${logAssetId}`);

        let resolvedAssetId: string | null = pickerAsset.assetId ?? null;
        const originalUri = metadata.uri;
        try {
          // PATH B: DocumentsUI returns the original content:// URI without a MediaLibrary assetId.
          // Never scan by filename or guess a MediaLibrary ID for this path.
          if (!resolvedAssetId && originalUri.startsWith('content://')) {
            console.log('[CUT] delete method: ContentResolver');
            console.log(
              `[CUT] ContentResolver delete-start | original URI: ${originalUri} | ` +
              `fileName=${metadata.fileName ?? 'none'} | mediaType=${metadata.mediaType}`,
            );
            const safResult = await deleteOriginalDocument(originalUri);
            console.log(
              `[CUT] delete result: ContentResolver | original URI: ${originalUri} | ` +
              `rows=${safResult.rows} | deleted=${safResult.deleted} | detail=${safResult.detail}`,
            );
            console.log(
              `[CUT] post-delete verification: ContentResolver | original URI: ${originalUri} | ` +
              `deleted=${safResult.deleted} | detail=${safResult.detail}`,
            );
            if (safResult.deleted) {
              cutDeletedCount += 1;
            } else {
              const msg = `${metadata.fileName || originalUri}: original document delete not confirmed (${safResult.detail})`;
              cutDeleteFailures.push(msg);
              console.warn(`[CUT] delete failure reason: ${msg}`);
            }
            continue;
          }

          // PATH A: a genuine MediaLibrary assetId can use the existing MediaLibrary path.
          console.log(
            `[CUT] resolved-asset | assetId=${resolvedAssetId ?? 'none'} | ` +
            `uri=${originalUri} | mediaType=${metadata.mediaType}`,
          );

          if (!resolvedAssetId) {
            const msg = `${metadata.fileName || originalUri}: valid MediaLibrary assetId not available`;
            cutDeleteFailures.push(msg);
            console.warn(`[CUT] asset-resolution-failed | ${msg}`);
            continue;
          }

          console.log('[CUT] delete method: MediaLibrary');
          console.log(
            `[CUT] MediaLibrary delete-start | assetId=${resolvedAssetId} | ` +
            `fileName=${metadata.fileName ?? 'none'} | mediaType=${metadata.mediaType}`,
          );
          const deleteResult = await MediaLibrary.deleteAssetsAsync([resolvedAssetId]);
          console.log(
            `[CUT] delete result: MediaLibrary | assetId=${resolvedAssetId} | ` +
            `result=${JSON.stringify(deleteResult)}`,
          );

          const verification = await verifyMediaLibraryDeletion(resolvedAssetId);
          console.log(
            `[CUT] post-delete verification: MediaLibrary | assetId=${resolvedAssetId} | ` +
            `deleted=${verification.deleted} | detail=${verification.detail}`,
          );

          if (verification.deleted) {
            cutDeletedCount += 1;
          } else {
            const msg = `${metadata.fileName || originalUri}: deletion not confirmed (${verification.detail})`;
            cutDeleteFailures.push(msg);
            console.warn(`[CUT] delete failure reason: ${msg}`);
          }
        } catch (error) {
          const msg = `${metadata.fileName || originalUri}: ${String(error).slice(0, 200)}`;
          cutDeleteFailures.push(msg);
          console.warn(
            `[CUT] delete failure reason: assetId=${resolvedAssetId ?? 'none'} | ` +
            `original URI=${originalUri} | mediaType=${metadata.mediaType} | error=${String(error)}`,
          );
        }
      }
    }

    setUploading(false);
    setUploadProgress(0);
    setUploadTotal(0);

    const reasonsText = failures.length
      ? '\n\nFail reasons:\n' + failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n')
      : '';
    if (done === 0) {
      Alert.alert('Upload பிழை', `0/${total} upload ஆச்சு.` + reasonsText);
    } else if (action !== 'cut') {
      Alert.alert(
        failures.length ? '⚠️ Partial Upload' : '✅ Upload ஆச்சு!',
        `${done}/${total} photos "${styleLabel}" cloud folder-ல் save ஆச்சு.` +
          (failures.length ? `\n${failures.length} fail ஆச்சு.` : '') + reasonsText,
      );
    } else if (cutDeletedCount === total && done === total) {
      // CUT success only when every selected file uploaded and its original deletion was verified.
      Alert.alert(
        '✅ Upload ஆச்சு, Delete ஆச்சு!',
        `${done}/${total} photos cloud-ல் save ஆச்சு, phone-ல் delete ஆச்சு.` +
          (failures.length ? `\n${failures.length} fail ஆச்சு.` : '') + reasonsText,
      );
    } else if (cutDeletedCount > 0) {
      // Partial CUT — never present the full success message for an incomplete batch.
      Alert.alert(
        '⚠️ Partial Cut',
        `${done}/${total} files cloud-ல் save ஆச்சு; ${cutDeletedCount}/${total} original files மட்டும் delete verify ஆச்சு.` +
          `\n\n${cutDeleteFailures.slice(0, 3).join('\n') || 'சில files upload அல்லது delete ஆகவில்லை.'}` +
          (failures.length ? `\n${failures.length} upload fail ஆச்சு.` : '') + reasonsText,
      );
    } else {
      // CUT — upload succeeded but no original deletion was verified.
      Alert.alert(
        '⚠️ Upload ஆச்சு, Delete ஆகல',
        `${done}/${total} files cloud-ல் save ஆச்சு.\n\nOriginal media retain ஆச்சு; document delete confirm ஆகவில்லை:\n${cutDeleteFailures.slice(0, 3).join('\n') || 'Unknown error'}\n\nDocument provider delete permission அல்லது source file access-ஐ check பண்ணி மீண்டும் முயற்சி செய்யுங்கள்.` +
          (failures.length ? `\n${failures.length} upload fail ஆச்சு.` : '') + reasonsText,
      );
    }
  };

  const openImagePicker = async (charId: string, charName: string, styleId: string, styleLabel: string) => {
    if (Platform.OS === 'web') { Alert.alert('Web', 'Upload mobile-ல் மட்டும் வேலை செய்யும்'); return; }

    let result: DocumentPicker.DocumentPickerResult;
    try {
      // Android DocumentsUI: Recent → Phone → Folder → selected image/video.
      // Preserve the original SAF content:// URI for Cut deletion; uploadAsync reads it directly.
      // Do not use the cache copy as the deletion target.
      result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*'],
        multiple: true,
        copyToCacheDirectory: false,
      });
    } catch (e: any) {
      Alert.alert('பிழை', 'File picker திறக்கல: ' + (e?.message ?? 'unknown'));
      return;
    }

    if (result.canceled || result.assets.length === 0) return;

    const count = result.assets.length;
    const picked: PickerAssetWithMetadata[] = await Promise.all(
      result.assets.map(async asset => {
        let fileSize = finiteNumber(asset.size);
        if (fileSize == null) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(asset.uri);
            fileSize = finiteNumber((fileInfo as any)?.size);
          } catch {
            fileSize = null;
          }
        }
        const isVideo = asset.mimeType?.startsWith('video/') === true
          || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(asset.name ?? '');
        const enriched: PickerAssetWithMetadata = {
          uri: asset.uri,
          assetId: null,
          fileName: asset.name ?? null,
          fileSize,
          width: 0,
          height: 0,
          type: isVideo ? 'video' : 'image',
          mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
          duration: null,
          creationTime: null,
          modificationTime: null,
        };
        enriched.cutMetadata = getPickerMetadata(enriched);
        console.log('[CUT] picker-asset', JSON.stringify(enriched.cutMetadata));
        return enriched;
      }),
    );

    console.log(
      '[CUT] picker result',
      JSON.stringify({
        canceled: result.canceled,
        assets: picked.map(asset => asset.cutMetadata ?? getPickerMetadata(asset)),
      }),
    );

    Alert.alert(
      `${count} file${count > 1 ? 's' : ''} select ஆச்சு`,
      'Cloud-ல் எப்படி save பண்ணணும்?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '📋 Copy  (Phone-ல் இருக்கும்)',
          onPress: () => doUpload(picked, charId, styleId, styleLabel, 'copy'),
        },
        {
          text: '✂️ Cut  (Phone-ல் delete ஆகும்)',
          style: 'destructive' as const,
          onPress: () => doUpload(picked, charId, styleId, styleLabel, 'cut'),
        },
      ],
    );
  };

  const handleUpload = () => {
    if (!selectedChar || !selectedStyle) return;
    openImagePicker(selectedChar.id, selectedChar.name, selectedStyle.id, selectedStyle.label);
  };

  const handleQuickUpload = (char: typeof personas[0], style: typeof photoStyles[0]) => {
    openImagePicker(char.id, char.name, style.id, style.label);
  };

  const togglePhotoSel = (id: string) => {
    setPhotoSelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitPhotoSel = () => { setPhotoSelMode(false); setPhotoSelIds(new Set()); };

  const deleteSelectedPhotos = async () => {
    const ids = [...photoSelIds];
    exitPhotoSel();
    for (const id of ids) { try { await deleteFromCloudinary(id); } catch {} }
    setPhotos(prev => {
      const idSet = new Set(ids);
      const updated = prev.filter(p => !idSet.has(p.public_id));
      if (selectedChar && selectedStyle) {
        const key = `cloud_photos_${selectedChar.id}_${selectedStyle.id}`;
        AsyncStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      }
      return updated;
    });
  };

  const confirmNewFolder = async () => {
    const name = folderName.trim();
    if (!name) { Alert.alert('பிழை', 'Folder பெயர் உள்ளிடுங்க'); return; }
    setFolderDialog(false);

    if (depth === 0) {
      // Add custom character folder
      const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
      const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)];
      const newChar = { id, name, color, letter: name.charAt(0).toUpperCase() };
      const updated = [...customChars, newChar];
      setCustomChars(updated);
      await AsyncStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_chars', updated).catch(() => {}); // sync to cloud
    } else if (depth === 1) {
      // Add custom style folder
      const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
      const newStyle = { id, label: name };
      const updated = [...customStyles, newStyle];
      setCustomStyles(updated);
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_styles', updated).catch(() => {}); // sync to cloud
      // Sync to custom_photo_styles_v1 (used by chat.tsx)
      try {
        const chatRaw = await AsyncStorage.getItem('custom_photo_styles_v1');
        const chatList: any[] = chatRaw ? JSON.parse(chatRaw) : [];
        if (!chatList.some((s: any) => s.id === id)) {
          await AsyncStorage.setItem('custom_photo_styles_v1', JSON.stringify([...chatList, newStyle]));
        }
      } catch {}
      // Auto-create Cloudinary folder for ALL female personas (global style)
      ALL_PERSONAS.filter(p => p.gender === 'female').forEach(p => {
        createCloudinaryFolder(`my-girls/${p.id}/${id}`).catch(() => {});
      });
    }
    Alert.alert('✅ Folder உருவாக்கப்பட்டது!', `"${name}" folder add ஆச்சு.`);
  };

  const loadPhotos = useCallback(async (charId: string, styleId: string) => {
    setLoadingPhotos(true);
    setPhotos([]);
    try {
      // 1. Load from AsyncStorage first (instant, works offline)
      const key = `cloud_photos_${charId}_${styleId}`;
      const cached = await AsyncStorage.getItem(key);
      const local: CloudPhoto[] = cached ? JSON.parse(cached) : [];
      if (local.length > 0) setPhotos(local);

      // 2. Try Cloudinary list in background and merge
      try {
        const folder = `my-girls/${charId}/${styleId}`;
        const cloud = await listCloudinaryImages(folder);
        if (cloud.length > 0) {
          // Merge: cloud list wins, add any local-only items
          const cloudIds = new Set(cloud.map(p => p.public_id));
          const localOnly = local.filter(p => !cloudIds.has(p.public_id));
          const merged = [...cloud, ...localOnly];
          setPhotos(merged);
          // Update cache with merged result
          await AsyncStorage.setItem(key, JSON.stringify(merged));
        }
        // If cloud returns empty, keep showing local cache
      } catch {
        // Cloudinary list failed — local cache is still shown
      }
    } catch {
      // ignore
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const depthRef = React.useRef(depth);
  useEffect(() => { depthRef.current = depth; }, [depth]);

  const goBack = useCallback(() => {
    if (depthRef.current === 2) { setDepth(1); setPhotos([]); return true; }
    if (depthRef.current === 1) { setDepth(0); setSelectedChar(null); return true; }
    router.back(); return false;
  }, [router]);

  // Native: intercept hardware back button
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
      return () => sub.remove();
    }, [goBack])
  );

  // Web: intercept browser back button via History API
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Push an initial history state so the first back press triggers popstate
    window.history.pushState({ cloudDepth: 0 }, '');

    const onPopState = () => {
      const d = depthRef.current;
      if (d > 0) {
        // Stay on this screen, go back one depth level
        goBack();
        // Re-push a state so the next back press is also intercepted
        window.history.pushState({ cloudDepth: d - 1 }, '');
      }
      // d === 0 → let browser navigate naturally to previous page
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []); // run once on mount

  const selectChar = (char: typeof personas[0]) => {
    setSelectedChar(char);
    setDepth(1);
    AsyncStorage.getItem(`hidden_styles_${char.id}`).then(raw => {
      setHiddenStyles(new Set(raw ? JSON.parse(raw) : []));
    }).catch(() => {});
  };

  const selectStyle = (style: typeof PHOTO_STYLES[0]) => {
    setSelectedStyle(style);
    setDepth(2);
    if (selectedChar) {
      createCloudinaryFolder(`my-girls/${selectedChar.id}/${style.id}`).catch(() => {});
      loadPhotos(selectedChar.id, style.id);
    }
  };

  const doDeletePhoto = async (photo: CloudPhoto) => {
    try { await deleteFromCloudinary(photo.public_id); } catch {}
    setPhotos(prev => {
      const updated = prev.filter(p => p.public_id !== photo.public_id);
      if (selectedChar && selectedStyle) {
        const key = `cloud_photos_${selectedChar.id}_${selectedStyle.id}`;
        AsyncStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      }
      return updated;
    });
    setFullView(null);
    setDeleteTarget(null);
  };

  const handleDeletePhoto = (photo: CloudPhoto) => {
    setDeleteTarget(photo);
  };

  const handleSaveToGallery = async (photo: CloudPhoto) => {
    if (savingPhoto) return;
    setSavingPhoto(true);
    try {
      const permission = await requestPhotoVideoPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission இல்லை', 'Settings → My Girls → Permissions → Files & Media → Allow all');
        setSavingPhoto(false);
        return;
      }
      // Extract extension from URL to avoid mime-type mismatch
      const urlClean = photo.url.split('?')[0];
      const ext = urlClean.match(/.(webp|png|jpg|jpeg|gif)$/i)?.[1] ?? 'jpg';
      const fileUri = FileSystem.cacheDirectory + 'save_' + Date.now() + '.' + ext;
      const { uri } = await FileSystem.downloadAsync(photo.url, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      Alert.alert('✅ Saved!', 'Photo Gallery-ல் save ஆச்சு! 🎉');
    } catch (e: any) {
      Alert.alert('Error', 'Save பண்ண முடியல: ' + (e?.message || 'Unknown error'));
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleDeleteFolder = (id: string, name: string, type: 'char' | 'style') => {
    const isBuiltIn = type === 'char'
      ? basePersonas.some(p => p.id === id)
      : PHOTO_STYLES.some(s => s.id === id);
    if (isBuiltIn && type === 'char') return; // only block built-in character folders
    setDeleteFolderTarget({ id, name, type });
  };

  const doDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    const { id, name, type } = deleteFolderTarget;
    // Snapshot selectedChar NOW — before any setState calls that trigger re-renders
    // and could produce stale closure values in async code below.
    const charSnapshot = selectedChar;
    setDeleteFolderTarget(null);

    if (type === 'char') {
      const updated = customChars.filter(c => c.id !== id);
      setCustomChars(updated);
      await AsyncStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_chars', updated).catch(() => {});
      try {
        const allStyles = [...PHOTO_STYLES, ...customStyles];
        for (const style of allStyles) {
          const imgs = await listCloudinaryImages(`my-girls/${id}/${style.id}`).catch(() => []);
          for (const img of imgs) { deleteFromCloudinary(img.public_id).catch(() => {}); }
        }
      } catch {}
    } else {
      // ── Custom style: remove from customStyles list ───────────────────────
      const updated = customStyles.filter(s => s.id !== id);
      setCustomStyles(updated);
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_styles', updated).catch(() => {});

      // ── Built-in style: add to hiddenStyles so it disappears from the list ─
      const isBuiltInStyle = PHOTO_STYLES.some(s => s.id === id);
      if (isBuiltInStyle && charSnapshot) {
        // FIX: functional updater avoids stale-closure bug on hiddenStyles state
        setHiddenStyles(prev => new Set([...prev, id]));
        // Persist to AsyncStorage by reading current saved value (not stale closure)
        try {
          const raw = await AsyncStorage.getItem(`hidden_styles_${charSnapshot.id}`);
          const arr: string[] = raw ? JSON.parse(raw) : [];
          if (!arr.includes(id)) arr.push(id);
          await AsyncStorage.setItem(`hidden_styles_${charSnapshot.id}`, JSON.stringify(arr));
        } catch {}
      }

      // Sync removal to custom_photo_styles_v1 (used by chat.tsx)
      try {
        const chatRaw = await AsyncStorage.getItem('custom_photo_styles_v1');
        const chatList: any[] = chatRaw ? JSON.parse(chatRaw) : [];
        const chatUpdated = chatList.filter((s: any) => s.id !== id);
        await AsyncStorage.setItem('custom_photo_styles_v1', JSON.stringify(chatUpdated));
      } catch {}
      // Delete Cloudinary photos for ALL female personas (global style)
      ALL_PERSONAS.filter(p => p.gender === 'female').forEach(async (p) => {
        try {
          const imgs = await listCloudinaryImages(`my-girls/${p.id}/${id}`).catch(() => []);
          for (const img of imgs) { deleteFromCloudinary(img.public_id).catch(() => {}); }
        } catch {}
      });
    }

    // Clear local photo cache for the deleted folder
    const cacheKey = type === 'style' && charSnapshot
      ? `cloud_photos_${charSnapshot.id}_${id}`
      : null;
    if (cacheKey) AsyncStorage.removeItem(cacheKey).catch(() => {});
  };

  // Breadcrumb
  const renderBreadcrumb = () => (
    <View style={s.breadcrumb}>
      <Text style={s.breadcrumbTxt}>
        <Text style={s.breadcrumbHome}>🏠 Home</Text>
        <Text style={s.breadcrumbSep}> › </Text>
        <Text style={s.breadcrumbCur}>My AI Girls</Text>
        {selectedChar && (
          <>
            <Text style={s.breadcrumbSep}> › </Text>
            <Text style={s.breadcrumbCur}>{selectedChar.name}</Text>
          </>
        )}
        {selectedStyle && (
          <>
            <Text style={s.breadcrumbSep}> › </Text>
            <Text style={s.breadcrumbCur}>{selectedStyle.label}</Text>
          </>
        )}
      </Text>
    </View>
  );

  // Top action buttons (Upload + New Folder)
  const renderActionBar = () => (
    <View style={s.actionBar}>
      {depth === 2 ? (
        <TouchableOpacity style={s.uploadBtn} onPress={handleUpload} disabled={uploading}>
          {uploading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.uploadBtnTxt}>⬆ Upload</Text>
          }
        </TouchableOpacity>
      ) : (
        <View style={[s.uploadBtn, { backgroundColor: '#ccc' }]}>
          <Text style={[s.uploadBtnTxt, { color: '#888' }]}>⬆ Upload</Text>
        </View>
      )}
      {depth !== 2 ? (
        <TouchableOpacity style={s.newFolderBtn} onPress={handleNewFolder}>
          <Text style={s.newFolderTxt}>📁 New Folder</Text>
        </TouchableOpacity>
      ) : (
        <View style={[s.newFolderBtn, { backgroundColor: '#555' }]}>
          <Text style={[s.newFolderTxt, { color: '#999' }]}>📁 New Folder</Text>
        </View>
      )}
    </View>
  );

  // DEPTH 0: Character list
  const renderCharList = () => (
    <>
      {renderBreadcrumb()}
      {renderActionBar()}
      <Text style={s.sectionLabel}>FOLDERS</Text>
      <FlatList
        data={personas}
        keyExtractor={p => p.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => selectChar(item)} activeOpacity={0.7}>
            <View style={[s.rowIcon, { backgroundColor: item.color }]}>
              <Text style={s.rowIconTxt}>{item.letter}</Text>
            </View>
            <Text style={s.rowName}>{item.name}</Text>
            <Text style={s.rowArrow}>›</Text>
            <TouchableOpacity style={s.trashBtn} onPress={() => handleDeleteFolder(item.id, item.name, 'char')}>
              <Text style={s.trashIcon}>🗑</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: 30 }}
      />
    </>
  );

  // DEPTH 1: Photo style list
  const renderStyleList = () => (
    <>
      {renderBreadcrumb()}
      {renderActionBar()}
      <Text style={s.sectionLabel}>FOLDERS</Text>
      <FlatList
        data={photoStyles}
        keyExtractor={p => p.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => selectStyle(item)} activeOpacity={0.7}>
            <Text style={s.styleIcon}>📷✨</Text>
            <Text style={s.styleRowName}>{item.label}</Text>
            {selectedChar && (
              <TouchableOpacity
                style={s.quickUploadBtn}
                onPress={() => selectedChar && handleQuickUpload(selectedChar, item)}
              >
                <Text style={s.quickUploadTxt}>⬆️</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.trashBtn} onPress={() => handleDeleteFolder(item.id, item.label, 'style')}>
              <Text style={s.trashIcon}>🗑</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: 30 }}
      />
    </>
  );

  // DEPTH 2: Photos grid (phone-gallery style)
  const renderPhotos = () => {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = today.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    return (
      <>
        {renderBreadcrumb()}
        {renderActionBar()}
        {loadingPhotos ? (
          <View style={s.centerWrap}>
            <ActivityIndicator size="large" color="#E67E22" />
            <Text style={s.loadingTxt}>Cloud-ல் இருந்து photos load பண்றேன்...</Text>
          </View>
        ) : photos.length === 0 ? (
          <View style={s.centerWrap}>
            <Text style={s.emptyIcon}>☁️</Text>
            <Text style={s.emptyTxt}>இந்த folder-ல் photos இல்லை{'\n'}⬆ Upload பண்ணுங்க</Text>
          </View>
        ) : (
          <>
            {photoSelMode && photoSelIds.size > 0 && (
              <View style={s.photoSelBar}>
                <TouchableOpacity onPress={exitPhotoSel}>
                  <Text style={s.photoSelCancel}>✕</Text>
                </TouchableOpacity>
                <Text style={s.photoSelCount}>{photoSelIds.size} selected</Text>
                <TouchableOpacity style={s.photoSelDeleteBtn} onPress={deleteSelectedPhotos}>
                  <Text style={s.photoSelDeleteTxt}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            )}
            <ScrollView style={{ flex: 1, backgroundColor: '#111' }}>
              {/* Date header — phone gallery style */}
              <View style={s.dateHeader}>
                <Text style={s.dateHeaderTxt}>{dateStr}</Text>
                <Text style={s.dateHeaderSub}>{timeStr} · {photos.length} photos</Text>
              </View>
              <View style={s.photoGrid}>
                {photos.map(photo => {
                  const isSel = photoSelIds.has(photo.public_id);
                  return (
                    <View key={photo.public_id} style={s.photoWrap}>
                      <TouchableOpacity
                        onPress={() => photoSelMode ? togglePhotoSel(photo.public_id) : setFullView(photo)}
                        onLongPress={() => { setPhotoSelMode(true); setPhotoSelIds(new Set([photo.public_id])); }}
                        activeOpacity={0.85}
                      >
                        <Image
                          source={{ uri: photo.url }}
                          style={[s.photoThumb, isSel && { opacity: 0.6 }]}
                          resizeMode="cover"
                        />
                        {isSel && (
                          <View style={s.photoSelOverlay}>
                            <Text style={s.photoSelCheck}>✓</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      {!photoSelMode && (
                        <TouchableOpacity style={s.photoDelete} onPress={() => handleDeletePhoto(photo)}>
                          <Text style={s.photoDeleteTxt}>🗑</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </>
        )}
      </>
    );
  };

  const headerTitle =
    depth === 0 ? 'My AI Girls' :
    depth === 1 ? selectedChar?.name ?? 'My AI Girls' :
    selectedStyle?.label ?? 'Photos';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={goBack} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        <TouchableOpacity style={s.refreshBtn} onPress={() => {
          if (depth === 2 && selectedChar && selectedStyle) {
            loadPhotos(selectedChar.id, selectedStyle.id);
          }
        }}>
          <Text style={s.refreshTxt}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={s.content}>
        {depth === 0 && renderCharList()}
        {depth === 1 && renderStyleList()}
        {depth === 2 && renderPhotos()}
      </View>

      {/* Full view modal */}
      {fullView && (
        <View style={s.fullViewBg}>
          <TouchableOpacity style={s.fullViewClose} onPress={() => setFullView(null)}>
            <Text style={s.fullViewCloseTxt}>✕</Text>
          </TouchableOpacity>
          <Image source={{ uri: fullView.url }} style={s.fullViewImg} resizeMode="contain" />
          <View style={s.fullViewActions}>
            <TouchableOpacity style={s.fullViewSave} onPress={() => handleSaveToGallery(fullView)} disabled={savingPhoto}>
              <Text style={s.fullViewSaveTxt}>{savingPhoto ? '⏳ Saving...' : '⬇️ Gallery Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.fullViewDelete} onPress={() => { setFullView(null); handleDeletePhoto(fullView); }}>
              <Text style={s.fullViewDeleteTxt}>🗑 Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Custom delete confirm (Alert.alert blocked in Chrome web) */}
      {deleteTarget && (
        <View style={s.confirmOverlay}>
          <View style={s.confirmBox}>
            <Text style={s.confirmIcon}>🗑️</Text>
            <Text style={s.confirmTitle}>Delete பண்ணட்டுமா?</Text>
            <Text style={s.confirmSub}>இந்த photo Cloud-ல் இருந்து நிரந்தரமா delete ஆகும்.</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setDeleteTarget(null)}>
                <Text style={s.confirmCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmDelete} onPress={() => doDeletePhoto(deleteTarget)}>
                <Text style={s.confirmDeleteTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}


      {/* Upload progress overlay */}
      {uploading && uploadTotal > 0 && (
        <View style={s.confirmOverlay}>
          <View style={s.progressBox}>
            <ActivityIndicator size="large" color="#E67E22" />
            <Text style={s.progressTitle}>Upload பண்றேன்...</Text>
            <Text style={s.progressCount}>{uploadProgress} / {uploadTotal} photos</Text>
            <View style={s.progressBarBg}>
              <View style={[s.progressBarFill, { width: `${uploadTotal > 0 ? (uploadProgress / uploadTotal) * 100 : 0}%` as any }]} />
            </View>
          </View>
        </View>
      )}

      {/* Folder delete confirm — proper Modal so Android FlatList touches don't block it */}
      <Modal
        visible={!!deleteFolderTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteFolderTarget(null)}
      >
        <View style={s.confirmOverlay}>
          <View style={s.confirmBox}>
            <Text style={s.confirmIcon}>🗑️</Text>
            <Text style={s.confirmTitle}>Folder Delete பண்ணட்டுமா?</Text>
            <Text style={s.confirmSub}>"{deleteFolderTarget?.name}" folder remove ஆகும்.</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setDeleteFolderTarget(null)}>
                <Text style={s.confirmCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmDelete} onPress={doDeleteFolder}>
                <Text style={s.confirmDeleteTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* New Folder dialog */}
      <Modal visible={folderDialog} transparent animationType="fade" onRequestClose={() => setFolderDialog(false)}>
        <View style={s.dialogOverlay}>
          <View style={s.dialogBox}>
            <Text style={s.dialogTitle}>📁 புதிய Folder</Text>
            <Text style={s.dialogSub}>
              {depth === 0 ? 'புதிய character folder பெயர்:' : 'புதிய style folder பெயர்:'}
            </Text>
            <TextInput
              style={s.dialogInput}
              placeholder="Folder பெயர் உள்ளிடுங்க"
              placeholderTextColor="#aaa"
              value={folderName}
              onChangeText={setFolderName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmNewFolder}
            />
            <View style={s.dialogBtns}>
              <TouchableOpacity style={s.dialogCancel} onPress={() => setFolderDialog(false)}>
                <Text style={s.dialogCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dialogOk} onPress={confirmNewFolder}>
                <Text style={s.dialogOkTxt}>✅ உருவாக்கு</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  // Header
  header: {
    backgroundColor: '#1565C0',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { padding: 8 },
  backTxt: { color: '#fff', fontSize: 28, fontWeight: 'bold', lineHeight: 30 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 4 },
  refreshBtn: { padding: 8 },
  refreshTxt: { color: '#fff', fontSize: 22, fontWeight: 'bold' },

  // Breadcrumb
  breadcrumb: {
    backgroundColor: '#1a2340', paddingHorizontal: 14, paddingVertical: 10,
  },
  breadcrumbTxt: { fontSize: 13 },
  breadcrumbHome: { color: '#E67E22', fontWeight: '600' },
  breadcrumbSep: { color: '#aaa' },
  breadcrumbCur: { color: '#E67E22', fontWeight: '600' },

  // Action bar
  actionBar: {
    flexDirection: 'row', gap: 12,
    padding: 14, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  uploadBtn: {
    flex: 1, backgroundColor: '#E67E22', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  newFolderBtn: {
    flex: 1, backgroundColor: '#1a2340', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
  },
  newFolderTxt: { color: '#FFD700', fontWeight: '700', fontSize: 15 },

  // Section label
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: '#777',
    letterSpacing: 1.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },

  // Row (character or style)
  content: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff',
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  rowIconTxt: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  rowName: { flex: 1, fontSize: 15.5, color: '#E67E22', fontWeight: '600' },
  rowArrow: { color: '#aaa', fontSize: 20, marginRight: 10 },
  trashBtn: { padding: 6 },
  trashIcon: { fontSize: 18 },
  quickUploadBtn: { padding: 6, marginRight: 4 },
  quickUploadTxt: { fontSize: 18 },

  // Style row
  styleIcon: { fontSize: 20, marginRight: 14 },
  styleRowName: { flex: 1, fontSize: 15.5, color: '#E91E63', fontWeight: '600' },

  sep: { height: 1, backgroundColor: '#f0f0f0', marginLeft: 68 },

  // Photo grid
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loadingTxt: { color: '#888', fontSize: 14, textAlign: 'center', marginTop: 10 },
  emptyIcon: { fontSize: 60 },
  emptyTxt: { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 26 },
  dateHeader: {
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
    backgroundColor: '#111',
  },
  dateHeaderTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dateHeaderSub: { color: '#aaa', fontSize: 12, marginTop: 2 },
  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: 2, gap: 2, backgroundColor: '#111',
  },
  photoSelBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a',
    paddingHorizontal: 14, paddingVertical: 10, gap: 10,
  },
  photoSelCancel: { color: '#aaa', fontSize: 18, fontWeight: 'bold' },
  photoSelCount: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 },
  photoSelDeleteBtn: { backgroundColor: '#c62828', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  photoSelDeleteTxt: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  photoWrap: { position: 'relative' },
  photoThumb: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 4 },
  photoSelOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(21,101,192,0.35)', borderRadius: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  photoSelCheck: { color: '#fff', fontSize: 26, fontWeight: 'bold' },
  photoDelete: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  photoDeleteTxt: { fontSize: 13 },

  // Full view
  fullViewBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000', zIndex: 100,
    justifyContent: 'center', alignItems: 'center',
  },
  fullViewClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 },
  fullViewCloseTxt: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  fullViewImg: { width, height: width * 1.3 },
  fullViewActions: {
    position: 'absolute', bottom: 50,
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20,
  },
  fullViewSave: {
    flex: 1, backgroundColor: '#1B5E20', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  fullViewSaveTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  fullViewDelete: {
    flex: 1, backgroundColor: '#C62828', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  fullViewDeleteTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // New Folder dialog
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 200,
    backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 30,
  },
  confirmBox: { backgroundColor: '#1a2340', borderRadius: 18, padding: 24, width: '100%', alignItems: 'center' },
  confirmIcon: { fontSize: 40, marginBottom: 10 },
  confirmTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  confirmSub: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmCancel: { flex: 1, backgroundColor: '#444', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  confirmCancelTxt: { color: '#ccc', fontWeight: '700', fontSize: 15 },
  confirmDelete: { flex: 1, backgroundColor: '#c62828', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  confirmDeleteTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  dialogOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 30,
  },
  dialogBox: {
    backgroundColor: '#1a2340', borderRadius: 16,
    padding: 24, width: '100%',
  },
  dialogTitle: { color: '#FFD700', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  dialogSub: { color: '#aaa', fontSize: 13, marginBottom: 16 },
  dialogInput: {
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#111', marginBottom: 20,
  },
  dialogBtns: { flexDirection: 'row', gap: 12 },
  dialogCancel: {
    flex: 1, backgroundColor: '#444', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  dialogCancelTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dialogOk: {
    flex: 2, backgroundColor: '#E67E22', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  dialogOkTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Upload progress
  progressBox: {
    backgroundColor: '#1a2340', borderRadius: 18, padding: 30,
    width: '100%', alignItems: 'center', gap: 12,
  },
  progressTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  progressCount: { color: '#E67E22', fontSize: 22, fontWeight: '800' },
  progressBarBg: {
    width: '100%', height: 10, backgroundColor: '#333',
    borderRadius: 5, overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%', backgroundColor: '#E67E22', borderRadius: 5,
  },

  // ── Folder Browser styles ─────────────────────────────────────────────────
  fbSafe: { flex: 1, backgroundColor: '#0d1117' },
  fbHeader: {
    backgroundColor: '#1565C0', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, gap: 10,
  },
  fbBackBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  fbBackTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  fbHeaderCenter: { flex: 1 },
  fbHeaderTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  fbHeaderSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 },
  fbSelCount: {
    backgroundColor: '#E67E22', color: '#fff', fontWeight: '800',
    fontSize: 13, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },

  // Albums list
  fbCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  fbLoadTxt: { color: '#aaa', fontSize: 14 },
  fbAlbumRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#111827',
  },
  fbAlbumThumbWrap: { marginRight: 14, position: 'relative' },
  fbAlbumThumb: { width: 60, height: 60, borderRadius: 8 },
  fbFolderIconBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: 1 },
  fbAlbumInfo: { flex: 1 },
  fbAlbumName: { color: '#e5e7eb', fontSize: 15, fontWeight: '600' },
  fbAlbumCount: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  fbAlbumArrow: { color: '#6b7280', fontSize: 22 },
  fbSep: { height: 1, backgroundColor: '#1f2937', marginLeft: 88 },

  // Photos grid
  fbAssetWrap: {
    width: width / 3 - 2, height: width / 3 - 2, margin: 1, position: 'relative',
  },
  fbAssetThumb: { width: '100%', height: '100%' },
  fbAssetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21,101,192,0.45)',
    justifyContent: 'flex-start', alignItems: 'flex-end',
    padding: 5,
  },
  fbAssetCheck: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1565C0', borderWidth: 2, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  fbAssetCheckTxt: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  fbAssetCheckEmpty: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
  },

  // Bottom Cut/Copy bar
  fbBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 99,
    backgroundColor: '#0f172a', borderTopWidth: 2, borderTopColor: '#E67E22',
    paddingHorizontal: 14, paddingVertical: 12, gap: 8,
  },
  fbBottomCount: {
    color: '#e5e7eb', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 4,
  },
  // CUT — big orange primary button
  fbCutBtnBig: {
    backgroundColor: '#E67E22', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  fbCutBtnBigTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  // COPY — smaller secondary button
  fbCopyBtnSmall: {
    backgroundColor: '#1f2937', borderRadius: 14, borderWidth: 1, borderColor: '#374151',
    paddingVertical: 10, alignItems: 'center',
  },
  fbCopyBtnSmallTxt: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
});
