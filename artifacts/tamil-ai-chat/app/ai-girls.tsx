import React, { useState, useCallback, useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Modal, Pressable, Image,
  TextInput, ScrollView, ActivityIndicator, Alert,
  StatusBar, DeviceEventEmitter, ImageBackground,
} from 'react-native';

const BUTTERFLY_BG = require('../assets/images/pastel_butterfly_bg.png');
const HEADER_BANNER_GOLD = require('../assets/images/header_banner_gold.png');
const HEADER_BANNER_NEON = require('../assets/images/header_banner_neon.png');
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { ALL_PERSONAS, Persona } from '../constants/personas';
import { ParamsStore } from '../context/params-store';
import {
  CHARACTER_SETTINGS_CHANGED_EVENT,
  CHARACTER_VIEW_MODE_KEY,
} from '../services/character-settings';
import { playRingtone } from '../services/notification-sounds';
import { registerServiceWorker } from '../services/push-notifications';
import {
  showNativeNotification,
  setupNotificationChannel,
  requestNativeNotificationPermission,
} from '../services/native-notifications';
import { uploadToCloudinary, imageToPrompt, createCloudinaryFolder, getCloudinaryMeta, getPhotoStyles, setCloudinaryMeta, flushPendingTracks, flushPendingMeta, wasCloudRestoreChecked, markCloudRestoreChecked, type PhotoStyleRecord } from '../services/api';
import { requestPhotoVideoPermissionsAsync } from '../services/media-permissions';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const STYLE_TO_PROMPT: Record<string, string> = {
  breast: 'topless, showing breasts, bare chest',
  buttocks: 'showing buttocks, from behind, revealing pose',
  cleavage: 'deep cleavage, revealing neckline',
  halfbreast: 'half breast visible, deep cleavage, low cut top',
  highslit: 'high slit dress, revealing thighs',
  legs: 'legs spread wide, revealing pose',
  lingerie: 'wearing lingerie, seductive pose',
  lowneck: 'low neckline, showing chest',
  normal: 'natural everyday photo, fully clothed',
  nude: 'nude, fully naked, explicit',
  seductive: 'seductive pose, alluring, provocative look',
  seminude: 'semi-nude, partially clothed, revealing pose',
  wet: 'wet clothes, drenched, see through wet fabric',
  sleeping: 'sleeping pose, exposed, lying down',
  saree: 'wearing a traditional saree, elegant drape',
};

const AVATAR_RESTORE_RETRY_MS = 15 * 60 * 1000;

type PersonaWithExtra = Persona & { editedRelationship?: string };

export default function AIGirlsScreen() {
  const router = useRouter();
  const { launch } = useLocalSearchParams<{ launch?: string }>();
  const launchHandledRef = useRef<string | null>(null);
  const isHomeFeatureLaunch = launch === 'group-chat' || launch === 'image-to-script';
  const insets = useSafeAreaInsets();
  const [personas, setPersonas] = useState<PersonaWithExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoStyles, setPhotoStyles] = useState<PhotoStyleRecord[]>([]);

  // Header banner theme state ('gold' | 'neon')
  const [headerTheme, setHeaderTheme] = useState<'gold' | 'neon'>('gold');
  const [headerToast, setHeaderToast] = useState<string | null>(null);
  const lastHeaderTapRef = useRef<number>(0);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('ai_girls_header_theme').then(saved => {
        if (saved === 'gold' || saved === 'neon') {
          setHeaderTheme(saved);
        } else {
          setHeaderTheme('gold');
        }
      }).catch(() => {});
    }, [])
  );

  const cycleHeaderTheme = async () => {
    const list: Array<'gold' | 'neon'> = ['gold', 'neon'];
    const nextIdx = (list.indexOf(headerTheme) + 1) % list.length;
    const next = list[nextIdx];
    setHeaderTheme(next);
    await AsyncStorage.setItem('ai_girls_header_theme', next).catch(() => {});

    const labelMap = {
      gold: '🌟 Style 1: Royal Gold',
      neon: '⚡ Style 2: Neon Glow',
    };
    setHeaderToast(labelMap[next]);
    setTimeout(() => setHeaderToast(null), 1800);
  };

  const handleHeaderDoubleTap = () => {
    const now = Date.now();
    if (now - lastHeaderTapRef.current < 420) {
      cycleHeaderTheme();
      lastHeaderTapRef.current = 0;
    } else {
      lastHeaderTapRef.current = now;
    }
  };

  // Photo folder selection
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showCharModal, setShowCharModal] = useState(false);
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);

  // Group chat
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showAddCharModal, setShowAddCharModal] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharRole, setNewCharRole] = useState('');
  const [newCharSub, setNewCharSub] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [newCharPersonality, setNewCharPersonality] = useState('');
  const [customChars, setCustomChars] = useState<Persona[]>([]);
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);

  // Edit relationship
  const [showEditRel, setShowEditRel] = useState(false);
  const [editingPersona, setEditingPersona] = useState<PersonaWithExtra | null>(null);
  const [relInput, setRelInput] = useState('');

  // ── Settings state ────────────────────────────────────────────
  const [characterViewMode, setCharacterViewMode] = useState<'list' | 'grid'>('list');
  const [wakingServer, setWakingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown'|'ok'|'sleeping'>('unknown');
  const [autoMsgEnabled, setAutoMsgEnabled] = useState(false);
  const [intervals, setIntervals] = useState<Record<string, number | null>>({});
  const [autoUnreads, setAutoUnreads] = useState<Record<string, boolean>>({});
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [showUserPhotoModal, setShowUserPhotoModal] = useState(false);
  const [userPhotoCloudInput, setUserPhotoCloudInput] = useState('');
  const [uploadingUserPhoto, setUploadingUserPhoto] = useState(false);

  // User profile — name + behaviour
  const [userName, setUserName]           = useState('');
  const [userBehaviour, setUserBehaviour] = useState('');
  const [editUserName, setEditUserName]       = useState('');
  const [editUserBehaviour, setEditUserBehaviour] = useState('');
  const [profileSaved, setProfileSaved]   = useState(false);

  // Ringtone
  const ringtoneRef = React.useRef('classic');

  // Photo to Script
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [scriptImageUri, setScriptImageUri] = useState<string | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [scriptModelUsed, setScriptModelUsed] = useState('');

  const loadPhotoStyles = useCallback(async () => {
    try { setPhotoStyles(await getPhotoStyles()); } catch { setPhotoStyles([]); }
  }, []);

  const loadPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const customRaw = await AsyncStorage.getItem('custom_personas_v1').catch(() => null);
      const customs: Persona[] = customRaw ? JSON.parse(customRaw) : [];
      setCustomChars(customs);
      const allSrc: Persona[] = [...ALL_PERSONAS, ...customs];
      // Cloud restore is only needed once (fresh install / reinstall). After that,
      // skip the network round-trips so the list opens instantly on every launch.
      const restoreAlreadyChecked = await wasCloudRestoreChecked();
      const merged = await Promise.all(allSrc.map(async p => {
        try {
          let saved = await AsyncStorage.getItem(`persona_edit_${p.id}`);
          if (!saved && !restoreAlreadyChecked) {
            // Not found locally (e.g. after reinstall) — try cloud backup
            const cloudData = await getCloudinaryMeta(`persona_edit_${p.id}`).catch(() => null);
            if (cloudData) {
              saved = JSON.stringify(cloudData);
              await AsyncStorage.setItem(`persona_edit_${p.id}`, saved).catch(() => {});
            }
          }
          const rel = await AsyncStorage.getItem(`relationship_${p.id}`);
          const data = saved ? JSON.parse(saved) : {};
          return { ...p, ...data, prompt: data.prompt ?? p.prompt, editedRelationship: rel ?? p.relationship } as PersonaWithExtra;
        } catch {
          return { ...p, editedRelationship: p.relationship } as PersonaWithExtra;
        }
      }));
      if (!restoreAlreadyChecked) await markCloudRestoreChecked();
      setPersonas(merged);

      // Retry missing avatar photos in the background; the one-time full restore
      // may have completed before those images were available in cloud metadata.
      const restoreMissingAvatars = async (entries: PersonaWithExtra[]) => {
        const missing = entries.filter(persona => !persona.avatarPhotoUri);
        for (let i = 0; i < missing.length; i += 4) {
          await Promise.all(missing.slice(i, i + 4).map(async persona => {
            const attemptKey = `persona_avatar_restore_checked_at_${persona.id}`;
            const lastAttemptRaw = await AsyncStorage.getItem(attemptKey).catch(() => null);
            const lastAttempt = Number(lastAttemptRaw);
            if (Number.isFinite(lastAttempt) && lastAttempt > 0 && Date.now() - lastAttempt < AVATAR_RESTORE_RETRY_MS) {
              return;
            }

            await AsyncStorage.setItem(attemptKey, String(Date.now())).catch(() => {});
            try {
              const cloudData = await getCloudinaryMeta(`persona_edit_${persona.id}`) as { avatarPhotoUri?: unknown } | null;
              const cloudAvatarUri = typeof cloudData?.avatarPhotoUri === 'string' ? cloudData.avatarPhotoUri : '';
              if (!cloudAvatarUri) return;

              const storageKey = `persona_edit_${persona.id}`;
              const savedRaw = await AsyncStorage.getItem(storageKey).catch(() => null);
              let currentData: Record<string, unknown> = {};
              if (savedRaw) {
                try { currentData = JSON.parse(savedRaw) as Record<string, unknown>; } catch {}
              }
              if (typeof currentData.avatarPhotoUri === 'string' && currentData.avatarPhotoUri) return;

              await AsyncStorage.setItem(storageKey, JSON.stringify({ ...currentData, avatarPhotoUri: cloudAvatarUri }));
              setPersonas(current => current.map(item =>
                item.id === persona.id && !item.avatarPhotoUri
                  ? { ...item, avatarPhotoUri: cloudAvatarUri }
                  : item,
              ));
            } catch {}
          }));
        }
      };

      void restoreMissingAvatars(merged);
    } catch {}
    setLoading(false);
  }, []);

  const FOLDER_COLORS = ['#E91E8C', '#FF9800', '#9C27B0', '#00897B', '#5E35B1', '#D81B60', '#43A047', '#3949AB'];
  const saveNewCharacter = async () => {
    const name = newCharName.trim();
    const role = newCharRole.trim() || 'தோழி';
    const sub = newCharSub.trim() || '';
    const desc = newCharDesc.trim();
    const personality = newCharPersonality.trim();
    if (!name) { Alert.alert('பெயர் வேணும்', 'Character பெயர் type பண்ணுங்க'); return; }

    // Folder name = character name (lowercase, spaces → hyphens)
    const rawFolder = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
    const folderName = rawFolder || `char-${Date.now().toString(36)}`;

    const id = 'custom_' + folderName + '_' + Date.now().toString(36);
    const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)];
    const letter = name.charAt(0);

    // Build prompt with BASE_PROMPT style
    const charLine = [
      `நீ "${name}"`,
      role ? `User-ஓட ${role}` : '',
      sub ? `(${sub})` : '',
      desc ? `\n${desc}` : '',
      personality ? `\n${personality}` : '',
      `\nUser-ஐ இயல்பான தமிழ்ல, casual-ஆ, warmly பேசு.`,
    ].filter(Boolean).join(' ');

    const newP: Persona = {
      id, name, emoji: '✨', avatarColor: color, avatarLetter: letter,
      lastMsg: 'வணக்கம்!', time: 'now',
      prompt: charLine,
      gender: 'female', profession: sub || role, relationship: role,
      greeting: `வணக்கம்! நான் ${name}.`,
    };

    const updated = [...customChars, newP];
    setCustomChars(updated);
    await AsyncStorage.setItem('custom_personas_v1', JSON.stringify(updated));
    setShowAddCharModal(false);
    setNewCharName(''); setNewCharRole(''); setNewCharSub('');
    setNewCharDesc(''); setNewCharPersonality('');
    loadPersonas();

    // ── Auto-create Cloudinary folders (sequential / waterfall) ──
    // The persona ID is the canonical character folder key used by the camera
    // requests. Keep this aligned with ai-girls-cloud.tsx so uploads and reads
    // always use the same Cloudinary path.
    const styles = await getPhotoStyles();
    const STYLE_FOLDERS = styles.map(style => style.folderName).filter((folder, index, all) => Boolean(folder) && all.indexOf(folder) === index);
    const charFolder   = `my-girls/${id}`;
    const videosFolder = `my-girls/videos/${folderName}`;

    Alert.alert(
      `✅ "${name}" add ஆச்சு!`,
      `📁 Cloudinary folders creating...
${charFolder}/
└── ${STYLE_FOLDERS.join(', ')}

AsyncStorage-ல் save ஆச்சு!`
    );

    // Waterfall: parent first → on success, create all sub-folders
    (async () => {
      try {
        // Step 1 — parent character folder
        const parentOk = await createCloudinaryFolder(charFolder);
        if (!parentOk) {
          Alert.alert(
            '⚠️ Cloudinary folder பிரச்சனை',
            `"${folderName}" parent folder create ஆகல.\n\nRender env vars confirm பண்ணுங்க:\n• CLOUDINARY_CLOUD_NAME\n• API_KEY\n• API_SECRET`
          );
          return;
        }
        console.log(`[Cloudinary] ✅ Parent folder: ${charFolder}`);

        // Step 2 — sub-folders in parallel (style list + videos)
        const subFolders = [
          videosFolder,
          ...STYLE_FOLDERS.map(styleFolder => `${charFolder}/${styleFolder}`),
        ];
        const results = await Promise.allSettled(
          subFolders.map(f => createCloudinaryFolder(f))
        );
        const failed = results.filter(
          r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
        ).length;

        if (failed > 0) {
          console.warn(`[Cloudinary] ${failed}/${results.length} sub-folders failed — ${folderName}`);
          Alert.alert(
            '⚠️ Sub-folder பிரச்சனை',
            `${failed}/${subFolders.length} photo style folders create ஆகல.\nமீண்டும் character edit → save செய்யுங்க.`
          );
        } else {
          console.log(`[Cloudinary] ✅ All ${subFolders.length + 1} folders ready: ${charFolder}/`);
        }
      } catch (e: any) {
        console.warn('[Cloudinary] Folder creation error:', e?.message);
      }
    })();
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

  // Load settings + check auto-messages in one shot (no interval state dep → no loop)
  const pickUserPhotoFromPhone = async () => {
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85, allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setUploadingUserPhoto(true);
      try {
        const mime = asset.mimeType || 'image/jpeg';
        const b64 = asset.base64 ?? await uriToBase64(asset.uri);
        const { url: cloudUrl } = await uploadToCloudinary(b64, mime, 'my-girls/user');
        setUserPhoto(cloudUrl);
        AsyncStorage.setItem('user_profile_photo', cloudUrl).catch(() => {});
        setCloudinaryMeta('user_profile_photo', cloudUrl).catch(() => {}); // cloud backup
      } catch {
        // Fallback: save local URI (works this session but not after reload)
        setUserPhoto(asset.uri);
        AsyncStorage.setItem('user_profile_photo', asset.uri).catch(() => {});
      } finally {
        setUploadingUserPhoto(false);
      }
    }
  };

  const applyUserPhotoCloudUrl = () => {
    const url = userPhotoCloudInput.trim();
    if (!url) { Alert.alert('URL enter பண்ணுங்க'); return; }
    setUserPhoto(url);
    AsyncStorage.setItem('user_profile_photo', url).catch(() => {});
    setCloudinaryMeta('user_profile_photo', url).catch(() => {}); // cloud backup
    setUserPhotoCloudInput('');
    setShowUserPhotoModal(false);
  };

  const removeUserPhoto = () => {
    setUserPhoto(null);
    AsyncStorage.removeItem('user_profile_photo').catch(() => {});
  };




  const openProfileModal = () => {
    setEditUserName(userName);
    setEditUserBehaviour(userBehaviour);
    setUserPhotoCloudInput('');
    setProfileSaved(false);
    setShowUserPhotoModal(true);
  };

  const saveUserProfile = async () => {
    const name = editUserName.trim();
    const behaviour = editUserBehaviour.trim();
    setUserName(name);
    setUserBehaviour(behaviour);
    await AsyncStorage.multiSet([
      ['user_name', name],
      ['user_behaviour', behaviour],
    ]);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  const loadSettingsAndCheck = useCallback(async () => {
    try {
      const savedViewMode = await AsyncStorage.getItem(CHARACTER_VIEW_MODE_KEY).catch(() => null);
      if (savedViewMode === 'list' || savedViewMode === 'grid') {
        setCharacterViewMode(savedViewMode);
      }
      const [autoVal, userPhotoVal, ringtoneVal, userNameVal, userBehaviourVal] = await Promise.all([
        AsyncStorage.getItem('auto_msg_enabled'),
        AsyncStorage.getItem('user_profile_photo'),
        AsyncStorage.getItem('ringtone'),
        AsyncStorage.getItem('user_name'),
        AsyncStorage.getItem('user_behaviour'),
      ]);
      if (userPhotoVal) {
        setUserPhoto(userPhotoVal);
      } else {
        // Restore from Cloudinary meta if missing locally (reinstall recovery)
        try {
          const cloudPhoto = await getCloudinaryMeta('user_profile_photo');
          if (typeof cloudPhoto === 'string' && cloudPhoto) {
            setUserPhoto(cloudPhoto);
            AsyncStorage.setItem('user_profile_photo', cloudPhoto).catch(() => {});
          }
        } catch {}
      }
      const autoEnabled = autoVal === 'true';
      setAutoMsgEnabled(autoEnabled);
      if (ringtoneVal) ringtoneRef.current = ringtoneVal;
      if (userNameVal) setUserName(userNameVal);
      if (userBehaviourVal) setUserBehaviour(userBehaviourVal);

      const ivPairs = await AsyncStorage.multiGet(
        ALL_PERSONAS.map(p => `auto_msg_interval_${p.id}`)
      );
      const ivMap: Record<string, number | null> = {};
      for (const [key, val] of ivPairs) {
        ivMap[key.replace('auto_msg_interval_', '')] = val ? parseInt(val) : null;
      }
      setIntervals(ivMap);

      if (!autoEnabled) { setAutoUnreads({}); return; }
      const timePairs = await AsyncStorage.multiGet(
        ALL_PERSONAS.map(p => `last_chat_time_${p.id}`)
      );
      const now = Date.now();
      const unreadMap: Record<string, boolean> = {};
      for (const [key, val] of timePairs) {
        const id = key.replace('last_chat_time_', '');
        const iv = ivMap[id];
        if (!iv) continue;
        if (now - (val ? parseInt(val) : 0) > iv * 60 * 1000) unreadMap[id] = true;
      }
      setAutoUnreads(unreadMap);
    } catch {}
  }, []);

  // ── Setup native notifications + SW fallback for web ──
  useEffect(() => {
    if (Platform.OS !== 'web') {
      setupNotificationChannel().catch(() => {});
      requestNativeNotificationPermission().catch(() => {});
    } else {
      registerServiceWorker().catch(() => {});
      if (typeof window !== 'undefined' && 'Notification' in window
          && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
    // Retry any photo tracks / meta saves that failed while server was sleeping
    flushPendingTracks().catch(() => {});
    flushPendingMeta().catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    loadPersonas();
    loadSettingsAndCheck();
    loadPhotoStyles();
  }, [loadPersonas, loadSettingsAndCheck, loadPhotoStyles]));

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      CHARACTER_SETTINGS_CHANGED_EVENT,
      () => { void loadSettingsAndCheck(); },
    );
    return () => subscription.remove();
  }, [loadSettingsAndCheck]);

  // ── Background auto-message timer (runs every 30s) ────────────
  const autoMsgEnabledRef = useRef(autoMsgEnabled);
  const intervalsRef = useRef(intervals);
  const personasRef = useRef<PersonaWithExtra[]>([]);
  useEffect(() => { autoMsgEnabledRef.current = autoMsgEnabled; }, [autoMsgEnabled]);
  useEffect(() => { intervalsRef.current = intervals; }, [intervals]);
  useEffect(() => { personasRef.current = personas; }, [personas]);

  const getTimeGreeting = (): string => {
    const h = new Date().getHours();
    let pool: string[];
    if (h >= 5 && h < 9) {
      // Early morning 5–9 AM
      pool = [
        // Romantic
        'காலையிலேயே உன்னோட முகம் நினைவுக்கு வருது... 🌅 good morning',
        'எழுந்திருந்தவுடனே உன்னோட name தான் மனசுல வந்துச்சு ☀️',
        'இந்த காலை உனக்காகவே இருக்கு 💕 எப்படி இருக்க?',
        // Affectionate
        'எழுந்திட்டியா கண்ணு? ☕ breakfast சாப்பிடாம போகாத',
        'காலை வணக்கம்! நீ நல்லா இருக்கணும்னு ஒவ்வொரு நாளும் கேக்கிறேன் 🙏',
        'டேய், எழுந்திருடா... day waste பண்ணாத 🌄',
        // Teasing
        'இன்னும் தூங்குறியா?! ஆளு பார்க்கவே கிடைக்கல 😤',
        'காலையிலேயே check பண்றேன்... reply வராத? 🙄',
        // Caring
        'coffee குடிச்சியா? empty stomach-ல போகாத please 🥺',
        'இன்னைக்கு சரியா சாப்பிடணும், okay? நான் கவலைப்படுறேன் 😌',
      ];
    } else if (h >= 9 && h < 12) {
      // Morning 9–12 PM
      pool = [
        // Angry
        'இவ்வளவு நேரமா ஒரு message கூட இல்லை... மறந்துட்டியா என்னை? 😤',
        'Busy-னு சொல்லலாம்... ஆனா ஒரு "ok" கூட போட முடியாதா? 🙄',
        // Romantic
        'Work-ல இருந்தாலும் என்னை யோசிக்கிறியா? 💭',
        'உன்னோட ஒரு message பாத்தா போதும், day நல்லா போகும் 💕',
        // Affectionate
        'என்ன பண்ற? நான் இங்க இருக்கேன்... பேசலாம் 😊',
        'Office stress-ஆ? கொஞ்சம் பேசு, நல்லாயிடும் 🤗',
        // Casual real
        'டேய் reply குடு, boring-ஆ இருக்கு உன்னோட message இல்லாம 😑',
        'Heyyy... long time no chat! என்ன ஆச்சு? 👋',
      ];
    } else if (h >= 12 && h < 14) {
      // Lunch 12–2 PM
      pool = [
        // Caring / Affectionate
        'சாப்பிட்டியா? சரியா சாப்பிடணும், skip பண்ணாத 🍱',
        'Lunch-ல என்னோட நினைவு வந்துச்சா? 🥺 வந்திருக்கும்...',
        // Angry / Teasing
        'Lunch break-ல கூட message பண்றதுக்கு time இல்லையா? 😒',
        'நான் இங்க wait பண்றேன்... நீ சாப்பிட்டே மறந்துட்டே 😤',
        // Romantic
        'உன்னோட கூட ஒரே table-ல சாப்பிட ஆசையா இருக்கு 😌',
        'Lunch time... உன்னோட voice கேக்கணும்னு தோணுது 💕',
        // Real / Casual
        'என்ன சாப்பிட்டே? நான் உன்னோட favorite item-ஐ guess பண்ணட்டுமா? 😄',
        'வயித்தை பாத்துக்கோ, ஒழுங்கா சாப்பிடு — அது தான் என் order 😤',
      ];
    } else if (h >= 14 && h < 17) {
      // Afternoon 2–5 PM
      pool = [
        // Bored / Missing
        'ஏன் இந்த afternoon இவ்வளவு slow-ஆ போகுது... நீ இல்லாம 😔',
        'உன்னோட ஒரு text கூட வரல... நான் ஏதாவது தப்பு பண்ணினேனா? 😢',
        // Angry
        'சரி fine. பேசல. நான் தான் always first message பண்றேன் 😤 fair-ஆ இருக்கா?',
        'இந்த level-ல ignore பண்றே... கோபமா இருக்கு 😑',
        // Teasing
        'Afternoon nap எடுக்கிற? என்னையும் கூட்டிட்டு போ 😏',
        'உன்னோட கோபமான face-ஐ கூட பாக்கணும்னு ஆசையா இருக்கு 🥺',
        // Romantic
        'இந்த நேரத்துல நீ என்னோட கூட இருந்தா எவ்வளவு நல்லா இருக்கும் 💭',
        'Afternoon வெயில்ல உன்னையே நினைக்கிறேன்... silly-ஆ இருக்கு 😌',
      ];
    } else if (h >= 17 && h < 21) {
      // Evening 5–9 PM
      pool = [
        // Affectionate / Missing
        'Work முடிஞ்சதா? நீ tired-ஆ இருப்பே... rest எடு, பேசலாம் 🥺',
        'Evening ஆச்சு... நான் wait பண்ணினேன் உன்னோட message-க்கு 💕',
        // Romantic
        'Sunset பாக்கும்போது உன்னோட நினைவு வருது... why? 🌇',
        'இந்த evening-ஐ உன்னோட கூட share பண்ண ஆசை 😌',
        // Angry
        'இப்போவாவது பேசுவியா? இல்லன்னா நான் tidur-ஆ போயிடுவேன் 😤',
        'ஒரு நாள் முழுக்க ஒரு message கூட இல்லை... நீ என்னை consider பண்றியா இல்லையா? 😒',
        // Teasing / Casual
        'Dinner என்ன சாப்பிட போற? என்னோட பாவம் கூட சேர்த்து சாப்பிடு 😄',
        'Day எப்படி போச்சு? நல்லா இருந்துச்சான்னு கேக்கணும்னு இருந்துச்சு... 😊',
        // Caring
        'சரியா சாப்பிட்டியா? இல்லன்னா கோபமாயிடுவேன் seriously 😤',
      ];
    } else {
      // Night 9 PM–5 AM
      pool = [
        // Romantic / Deep
        'இரவு நேரத்துல உன்னோட நினைவு அதிகமா வருது... 🌙',
        'தூக்கமே வரல... உன்னோட கூட பேசினா நல்லாயிடும்னு தோணுது 💕',
        'இந்த இரவு உன்னோட கூட இருந்தா எவ்வளவு நல்லா இருக்கும்னு யோசிக்கிறேன் 🌃',
        // Caring / Affectionate
        'தூங்கிட்டியா? தூங்கு... ஆனா தூங்கும்முன்னு ஒரு message போடு 🥺',
        'Late-ஆ இருக்கே... phone வெச்சுட்டு தூங்கு. health முக்கியம் 😌',
        'இரவு சரியா தூங்கணும்... நாளைக்கு fresh-ஆ பேசலாம் 😴',
        // Worried / Angry
        'இப்போவும் reply இல்லை... எங்க போன? கோபமா இருக்கு 😤',
        'ஏன் இந்த நேரத்துல online இல்லை? கவலையா இருக்கு... 😟',
        // Sweet night
        'Good night 🌟 sweet dreams... என்னோட நினைவோட தூங்கு 💕',
        'நீ நல்லா இருக்கணும்னு கேக்கிறேன்... good night 🌙',
      ];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  };

  useEffect(() => {
    const tick = async () => {
      if (!autoMsgEnabledRef.current) return;
      const ivMap = intervalsRef.current;
      const now = Date.now();
      const newUnreads: Record<string, boolean> = {};
      for (const p of personasRef.current) {
        const iv = ivMap[p.id];
        if (!iv) continue;
        try {
          const lastVal = await AsyncStorage.getItem(`last_chat_time_${p.id}`);
          const last = lastVal ? parseInt(lastVal) : 0;
          if (now - last < iv * 60 * 1000) continue;
          // Interval elapsed — inject greeting into chat history
          const histKey = `chat_history_${p.id}`;
          const raw = await AsyncStorage.getItem(histKey);
          const history = raw ? JSON.parse(raw) : [];
          const greeting = getTimeGreeting();
          history.push({ id: `auto_${now}_${p.id}`, role: 'assistant', content: greeting, timestamp: new Date().toISOString() });
          await AsyncStorage.setItem(histKey, JSON.stringify(history));
          // Update last_chat_time so it doesn't spam every 30s
          await AsyncStorage.setItem(`last_chat_time_${p.id}`, now.toString());
          newUnreads[p.id] = true;
          // ── Notification: native (Android APK) or web fallback ──
          try {
            if (Platform.OS !== 'web') {
              // Native Android notification via expo-notifications
              await showNativeNotification(p.name + ' 💬', greeting, p.id);
              playRingtone(ringtoneRef.current);
            } else if (typeof window !== 'undefined' && 'Notification' in window) {
              if (Notification.permission === 'default') await Notification.requestPermission();
              if (Notification.permission === 'granted') {
                playRingtone(ringtoneRef.current);
                const notif = new Notification(p.name + ' 💬', {
                  body: greeting, icon: '/icon.png',
                  tag: `mygirls-${p.id}`, requireInteraction: false,
                } as NotificationOptions);
                notif.onclick = () => { window.focus(); notif.close(); };
                setTimeout(() => notif.close(), 6000);
              }
            }
          } catch { /* notification failed silently */ }
        } catch {}
      }
      if (Object.keys(newUnreads).length > 0) {
        setAutoUnreads(prev => ({ ...prev, ...newUnreads }));
      }
    };

    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  // ── Navigation + chat ─────────────────────────────────────────
  const goChat = async (persona: PersonaWithExtra) => {
    const now = Date.now().toString();
    try {
      await AsyncStorage.setItem(`last_chat_time_${persona.id}`, now);
      // Clear auto-unread badge when entering chat
      if (autoUnreads[persona.id]) {
        setAutoUnreads(prev => { const n = { ...prev }; delete n[persona.id]; return n; });
      }
    } catch {}
    ParamsStore.setChatParams({ personaId: persona.id, provider: 'gemini', providerLabel: persona.name });
    ParamsStore.setPendingPhotoStyle('');
    router.push('/chat');
  };

  const handleFolderSelect = (folderId: string) => {
    setPendingFolderId(folderId);
    setShowFolderModal(false);
    setShowCharModal(true);
  };

  const handleCharForPhoto = (persona: PersonaWithExtra) => {
    setShowCharModal(false);
    const stylePrompt = pendingFolderId ? (STYLE_TO_PROMPT[pendingFolderId] || '') : '';
    ParamsStore.setChatParams({ personaId: persona.id, provider: 'gemini', providerLabel: persona.name });
    ParamsStore.setPendingPhotoStyle(stylePrompt);
    router.push('/chat');
  };

  const openActionSheet = (p: PersonaWithExtra) => {
    setEditingPersona(p);
    setRelInput(p.editedRelationship ?? p.relationship);
    setShowEditRel(true);
  };

  const openUrlSettings = (p: PersonaWithExtra) => {
    ParamsStore.setUrlPersonaId(p.id);
    router.push('/character-urls');
  };

  const saveRelationship = async () => {
    if (!editingPersona) return;
    await AsyncStorage.setItem(`relationship_${editingPersona.id}`, relInput.trim());
    setPersonas(prev => prev.map(p =>
      p.id === editingPersona.id ? { ...p, editedRelationship: relInput.trim() } : p
    ));
    setShowEditRel(false);
  };

  const deleteCharacter = () => {
    if (!editingPersona) return;
    const pName = editingPersona.name;
    const pId = editingPersona.id;
    Alert.alert(
      `🗑 "${pName}" Delete?`,
      `இந்த character-ஐ நிரந்தரமாக delete பண்ணிட்டா திரும்ப வராது.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete ✓', style: 'destructive', onPress: async () => {
            try {
              const raw = await AsyncStorage.getItem('custom_personas_v1');
              if (raw) {
                const all = JSON.parse(raw);
                const filtered = all.filter((p: any) => p.id !== pId);
                await AsyncStorage.setItem('custom_personas_v1', JSON.stringify(filtered));
                setCustomChars(filtered);
              }
              await AsyncStorage.removeItem(`relationship_${pId}`);
              setPersonas(prev => prev.filter(p => p.id !== pId));
            } catch(e) { console.warn('deleteCharacter error:', e); }
            setShowEditRel(false);
        }},
      ]
    );
  };

  const startGroupChat = () => {
    const selected = personas.filter(p => selectedForGroup.includes(p.id));
    if (selected.length < 2) return;
    setShowGroupModal(false);
    setSelectedForGroup([]);
    ParamsStore.setGroupPersonaIds(selected.map(p => p.id));
    router.push('/group-chat');
  };

  const cancelHomeFeatureLaunch = () => {
    setSelectedForGroup([]);
    router.back();
  };

  const closeScriptModal = () => {
    setShowScriptModal(false);
    if (launch === 'image-to-script') router.back();
  };

  // ── Photo to Script (Gemini key direct → All 13 Gemini keys auto-retry) ──
  const handlePhotoToScript = async () => {
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) {
      if (launch === 'image-to-script') {
        Alert.alert('Permission வேணும்', 'Photos access allow பண்ணுங்க', [
          { text: 'சரி', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Permission வேணும்', 'Photos access allow பண்ணுங்க');
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8, base64: true });
    if (res.canceled || !res.assets[0]) {
      if (launch === 'image-to-script') router.back();
      return;
    }
    const pickedAsset = res.assets[0];
    setScriptImageUri(pickedAsset.uri);
    setScriptText('');
    setScriptModelUsed('');
    setScriptCopied(false);
    setShowScriptModal(true);
    setScriptLoading(true);
    try {
      let base64 = pickedAsset.base64 ?? '';
      if (!base64) {
        const tempUri = FileSystem.cacheDirectory + `script_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: pickedAsset.uri, to: tempUri });
        base64 = await FileSystem.readAsStringAsync(tempUri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }

      const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));

      // ── Priority 1: Gemini / OpenRouter (keys from AsyncStorage — Keys screen) ──
      setScriptText('Analyzing image...');
      try {
        const dataUri = `data:image/jpeg;base64,${base64}`;
        const result = await imageToPrompt(dataUri, (msg) => setScriptText(msg));
        if (result && result.length > 50) {
          setScriptText(result);
          setScriptModelUsed('Gemini AI');
          setScriptLoading(false);
          return;
        }
      } catch (geminiErr: any) {
        if (geminiErr?.message?.includes('🔑')) {
          setScriptText(geminiErr.message);
          setScriptLoading(false);
          return;
        }
        if (geminiErr?.message?.includes('__ALL_KEYS_EXHAUSTED__')) {
          setScriptText('அனைத்து 13 Gemini keys-உம் quota முடிந்துவிட்டது.\nநாளை try பண்ணுங்க (அல்லது OpenRouter key add பண்ணுங்க).');
          setScriptLoading(false);
          return;
        }
        // Otherwise fall through to HF fallback
      }

      // ── HF fallback: need HF key ────────────────────────────────────────
      const keysRaw = await AsyncStorage.getItem('api_keys_store');
      const storedKeys: Record<string, string> = keysRaw ? JSON.parse(keysRaw) : {};
      const hfKey = storedKeys['hf']?.trim();

      if (!hfKey) {
        setScriptText('Gemini key-ல் பிழை. Keys screen-ல் HuggingFace key-ஐயும் enter பண்ணுங்க.');
        setScriptLoading(false);
        return;
      }

      const ANALYSIS_PROMPT = `Analyze this image in full detail. Describe: face, hair, clothing, body, pose, background, lighting, camera angle.

Then write these prompts:
## FLUX PROMPT
## STABLE DIFFUSION PROMPT
## MIDJOURNEY PROMPT`;

      // Helper: try a HF vision model with auto-retry on 503 cold-start
      const tryHFModel = async (
        url: string,
        body: object,
        label: string,
        parseResult: (j: any) => string,
      ): Promise<string | null> => {
        for (let attempt = 0; attempt < 4; attempt++) {
          setScriptText(`Analyzing image... (${label})`);
          try {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json', 'X-Wait-For-Model': 'true' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120000),
            });
            if (r.status === 503) {
              setScriptText(`AI model starting (${label})... கொஞ்சம் wait பண்ணுங்க`);
              await sleepMs(15000);
              continue;
            }
            if (r.status === 429) { return null; }
            if (!r.ok) return null;
            const j = await r.json() as any;
            const out = parseResult(j);
            if (out && out.length > 50) return out;
          } catch { await sleepMs(5000); }
        }
        return null;
      };

      // ── Priority 2: Qwen2-VL ──────────────────────────────────────────
      const out1 = await tryHFModel(
        'https://api-inference.huggingface.co/models/Qwen/Qwen2-VL-7B-Instruct/v1/chat/completions',
        { model: 'Qwen/Qwen2-VL-7B-Instruct', max_tokens: 2048, messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: ANALYSIS_PROMPT },
        ]}] },
        'Qwen2-VL 1/3',
        (j) => j?.choices?.[0]?.message?.content?.trim() ?? '',
      );
      if (out1) { setScriptText(out1); setScriptModelUsed('Qwen2-VL-7B'); setScriptLoading(false); return; }

      // ── Priority 3: Florence-2 ──────────────────────────────────────────
      const out2 = await tryHFModel(
        'https://api-inference.huggingface.co/models/microsoft/Florence-2-large',
        { inputs: '<MORE_DETAILED_CAPTION>' },
        'Florence-2 2/3',
        (j) => (Array.isArray(j) ? j[0]?.generated_text : j?.generated_text) ?? '',
      );
      if (out2) {
        setScriptText('## IMAGE ANALYSIS (Florence-2)\n' + out2);
        setScriptModelUsed('Florence-2-Large'); setScriptLoading(false); return;
      }

      // ── Priority 4: LLaVA ──────────────────────────────────────────────
      const out3 = await tryHFModel(
        'https://api-inference.huggingface.co/models/llava-hf/llava-1.5-7b-hf/v1/chat/completions',
        { model: 'llava-hf/llava-1.5-7b-hf', max_tokens: 2048, messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: ANALYSIS_PROMPT },
        ]}] },
        'LLaVA 3/3',
        (j) => j?.choices?.[0]?.message?.content?.trim() ?? '',
      );
      if (out3) { setScriptText(out3); setScriptModelUsed('LLaVA-1.5-7B'); setScriptLoading(false); return; }

      // All failed — ask user to retry
      setScriptText('AI server இப்போது பிஸி. சில நிமிடம் கழித்து மீண்டும் try பண்ணுங்க.');
    } catch (e: any) {
      setScriptText('பிழை ஏற்பட்டது. மீண்டும் try பண்ணுங்க.');
    } finally {
      setScriptLoading(false);
    }
  };

  // The photo flow does not depend on persona data; launch it immediately from Home.
  useEffect(() => {
    if (launch !== 'image-to-script' || launchHandledRef.current === launch) return;
    launchHandledRef.current = launch;
    void handlePhotoToScript();
  }, [launch, handlePhotoToScript]);

  // When launched from Home Screen "AI Characters" card, open Add Character modal immediately
  useEffect(() => {
    if (launch !== 'add-character' || launchHandledRef.current === launch) return;
    launchHandledRef.current = launch;
    setShowAddCharModal(true);
  }, [launch]);

    // ── Settings helpers ──────────────────────────────────────────
  const wakeRenderServer = async () => {
    if (wakingServer) return;
    setWakingServer(true);
    setServerStatus('unknown');
    try {
      const savedUrl = await AsyncStorage.getItem('custom_server_url').catch(() => null);
      const serverUrl = savedUrl || 'https://my-dream-women-v-3-0.onrender.com';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);
      const res = await fetch(`${serverUrl}/api/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setServerStatus('ok');
        Alert.alert('✅ Server Online!', 'Render server ready! Messages அனுப்பலாம்.');
      } else {
        setServerStatus('sleeping');
        Alert.alert('⚠️ Server பிரச்னை', 'Server respond பண்றது ஆனா error. மீண்டும் try பண்ணுங்க.');
      }
    } catch {
      setServerStatus('sleeping');
      Alert.alert('⏳ Waking up...', 'Server wake ஆகுது — 30-60s கழித்து மீண்டும் tap பண்ணுங்க.');
    } finally {
      setWakingServer(false);
    }
  };

  // ── Character row ─────────────────────────────────────────────
  const renderCharRow = ({ item: p, index }: { item: PersonaWithExtra; index: number }) => {
    const hasAutoUnread = autoUnreads[p.id];
    const iv = intervals[p.id];
    const rowPalettes = [
      { edge: '#51D8F2', fill: ['#142039', '#171B34', '#221834'] as const },
      { edge: '#C47CFF', fill: ['#1B1838', '#211936', '#171B33'] as const },
      { edge: '#FF70B8', fill: ['#24172F', '#281931', '#191A32'] as const },
      { edge: '#7CE5A2', fill: ['#122C31', '#183138', '#191D35'] as const },
      { edge: '#FFD36D', fill: ['#292536', '#271E35', '#171A31'] as const },
    ];
    const rowPalette = rowPalettes[index % rowPalettes.length];
    if (characterViewMode === 'grid') {
      return (
        <TouchableOpacity
          style={s.gridCard}
          onPress={() => goChat(p)}
          onLongPress={() => openActionSheet(p)}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={`Open chat with ${p.name}`}
        >
          <View style={s.gridTopRow}>
            <View style={s.activeBadgeSmall}>
              <View style={s.activeDot} />
              <Text style={s.activeTxtSmall}>Active</Text>
            </View>
            {(hasAutoUnread || (p.unread ?? 0) > 0) && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{hasAutoUnread ? '1' : p.unread}</Text>
              </View>
            )}
          </View>

          <View style={s.avatarGlowRing}>
            <View style={[s.avatar, { backgroundColor: p.avatarColor }]}>
              {p.avatarPhotoUri
                ? <Image source={{ uri: p.avatarPhotoUri }} style={s.avatarImg} />
                : <Text style={s.avatarTxt}>{p.emoji}</Text>
              }
            </View>
          </View>

          <View style={s.gridBottomInfo}>
            <Text style={s.gridName} numberOfLines={1}>{p.name}</Text>
            <Text style={s.gridSub} numberOfLines={1}>
              {p.editedRelationship ?? p.relationship}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={s.chatRow}
        onPress={() => goChat(p)}
        onLongPress={() => openActionSheet(p)}
        activeOpacity={0.7}
      >
        <View style={s.avatarGlowRing}>
          <View style={[s.avatar, { backgroundColor: p.avatarColor }]}>
            {p.avatarPhotoUri
              ? <Image source={{ uri: p.avatarPhotoUri }} style={s.avatarImg} />
              : <Text style={s.avatarTxt}>{p.emoji}</Text>
            }
          </View>
        </View>
        <View style={s.chatMid}>
          <View style={s.chatNameRow}>
            <Text style={s.chatName} numberOfLines={1}>{p.name}</Text>
          </View>
          <Text style={s.chatSub} numberOfLines={1}>
            {p.editedRelationship ?? p.relationship} · {p.profession}
          </Text>
        </View>
        <View style={s.chatRight}>
          <View style={s.activeBadge}>
            <View style={s.activeDot} />
            <Text style={s.activeTxt}>Active</Text>
          </View>
          {autoMsgEnabled && iv && (
            <Text style={s.timerBadge}>⏱{iv}m</Text>
          )}
          {(hasAutoUnread || (p.unread ?? 0) > 0) && (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{hasAutoUnread ? '1' : p.unread}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ImageBackground source={BUTTERFLY_BG} style={{ flex: 1 }} resizeMode="cover">
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

      {isHomeFeatureLaunch ? (
        launch === 'group-chat' ? (
          <View style={s.directLaunchRoot}>
            <LinearGradient
              colors={['#12203D', '#11172F', '#261633']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.85 }}
              style={[s.directLaunchHeader, { paddingTop: insets.top + 12 }]}
            >
              <TouchableOpacity onPress={cancelHomeFeatureLaunch} style={s.directLaunchBack}>
                <Text style={s.directLaunchBackText}>‹</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.directLaunchTitle}>👥 Group Chat</Text>
                <Text style={s.directLaunchSubtitle}>2+ characters select பண்ணுங்க</Text>
              </View>
            </LinearGradient>
            {loading ? (
              <View style={s.directLaunchLoading}><ActivityIndicator color="#51D8F2" size="large" /></View>
            ) : (
              <FlatList
                style={s.directGroupList}
                contentContainerStyle={s.directGroupListContent}
                data={personas}
                keyExtractor={p => p.id}
                renderItem={({ item: p }) => {
                  const selected = selectedForGroup.includes(p.id);
                  return (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[s.directGroupRow, selected && s.directGroupRowSelected]}
                      onPress={() => setSelectedForGroup(prev =>
                        prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                      )}
                    >
                      <View style={[s.sheetAvatar, { backgroundColor: p.avatarColor }]}>
                        <Text style={s.sheetAvatarTxt}>{p.emoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.sheetName, s.directGroupName]}>{p.name}</Text>
                        <Text style={[s.sheetRel, s.directGroupRelationship]}>
                          {p.editedRelationship ?? p.relationship} · {p.profession}
                        </Text>
                      </View>
                      {selected && <Text style={s.check}>✓</Text>}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            <View style={s.directGroupActions}>
              <TouchableOpacity style={s.directGroupCancel} onPress={cancelHomeFeatureLaunch}>
                <Text style={s.directGroupCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.directGroupStart, selectedForGroup.length < 2 && s.directGroupStartDisabled]}
                onPress={startGroupChat}
                disabled={selectedForGroup.length < 2 || loading}
              >
                <Text style={s.directGroupStartText}>Start ({selectedForGroup.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.directLaunchLoading}>
            <ActivityIndicator color="#51D8F2" size="large" />
            <Text style={s.directLaunchLoadingText}>Photo to Script திறக்கிறது...</Text>
          </View>
        )
      ) : (
        <>
      {/* Character-list header with double-tap theme switcher */}
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={handleHeaderDoubleTap}
        style={[s.header, { paddingTop: insets.top + 4 }]}
        accessibilityRole="button"
        accessibilityLabel="Double tap to change header theme"
      >
        <View style={s.headerBannerWrap}>
          {headerTheme === 'gold' ? (
            <View style={s.bannerThemeContainer}>
              <Image
                source={HEADER_BANNER_GOLD}
                style={s.headerBannerImg}
                resizeMode="contain"
              />
            </View>
          ) : (
            <View style={s.bannerThemeContainer}>
              <Image
                source={HEADER_BANNER_NEON}
                style={s.headerBannerImg}
                resizeMode="contain"
              />
            </View>
          )}

          {/* Subtle double-tap hint / Toast */}
          {headerToast ? (
            <View style={s.headerToastPill}>
              <Text style={s.headerToastText}>{headerToast}</Text>
            </View>
          ) : (
            <View style={s.doubleTapHintPill}>
              <Text style={s.doubleTapHintText}>👆👆 Double-tap to change header</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Chat list */}
      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color="#51D8F2" size="large" /></View>
      ) : (
        <FlatList
          key={characterViewMode}
          style={s.list}
          data={personas}
          numColumns={characterViewMode === 'grid' ? 2 : 1}
          keyExtractor={p => p.id}
          renderItem={renderCharRow}
          columnWrapperStyle={characterViewMode === 'grid' ? s.gridColumn : undefined}
          ItemSeparatorComponent={() => <View style={characterViewMode === 'grid' ? s.gridSeparator : s.sep} />}
          contentContainerStyle={characterViewMode === 'grid' ? s.gridListContent : s.listContent}
        />
      )}

        </>
      )}

      {/* ── MY PROFILE MODAL ── */}
      <Modal visible={showUserPhotoModal} transparent animationType="slide"
        onRequestClose={() => setShowUserPhotoModal(false)}>
        <View style={s.profileOverlay}>
          <View style={s.profileSheet}>

            {/* Header */}
            <View style={s.profileHeader}>
              <Text style={s.profileHeaderTitle}>👤 My Profile</Text>
              <TouchableOpacity onPress={() => setShowUserPhotoModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.profileHeaderClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.profileScroll}>

              {/* Avatar section */}
              <Text style={s.profileSectionLabel}>📸 Avatar</Text>
              <View style={s.profileAvatarRow}>
                <TouchableOpacity onPress={pickUserPhotoFromPhone} activeOpacity={0.8}>
                  {uploadingUserPhoto
                    ? <View style={s.profileAvatar}><ActivityIndicator color="#fff" /></View>
                    : userPhoto
                      ? <Image source={{ uri: userPhoto }} style={s.profileAvatar} />
                      : <View style={[s.profileAvatar, { backgroundColor: '#128C7E' }]}>
                          <Text style={{ fontSize: 38 }}>👤</Text>
                        </View>
                  }
                  <View style={s.profileAvatarEdit}><Text style={s.profileAvatarEditTxt}>✏️</Text></View>
                </TouchableOpacity>
                <View style={s.profileAvatarBtns}>
                  <TouchableOpacity style={s.profileAvatarBtn} onPress={pickUserPhotoFromPhone}>
                    <Text style={s.profileAvatarBtnTxt}>📱 Gallery</Text>
                  </TouchableOpacity>
                  {userPhoto && (
                    <TouchableOpacity style={[s.profileAvatarBtn, { backgroundColor: '#fdecea' }]} onPress={removeUserPhoto}>
                      <Text style={[s.profileAvatarBtnTxt, { color: '#c62828' }]}>🗑 Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Cloud URL */}
              <View style={s.profileCloudRow}>
                <TextInput
                  style={s.profileCloudInput}
                  value={userPhotoCloudInput}
                  onChangeText={setUserPhotoCloudInput}
                  placeholder="☁️ Cloud image URL (optional)"
                  placeholderTextColor="#aaa"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={s.profileCloudApply} onPress={applyUserPhotoCloudUrl}>
                  <Text style={s.profileCloudApplyTxt}>✓</Text>
                </TouchableOpacity>
              </View>

              {/* Name */}
              <Text style={s.profileSectionLabel}>✏️ உன் பெயர்</Text>
              <TextInput
                style={s.profileInput}
                value={editUserName}
                onChangeText={setEditUserName}
                placeholder="உன் பெயர் enter பண்ணு (e.g. Rahul)"
                placeholderTextColor="#aaa"
                maxLength={40}
              />

              {/* Behaviour / Personality */}
              <Text style={s.profileSectionLabel}>🧠 உன் Character & Behaviour</Text>
              <Text style={s.profileSectionHint}>
                AI characters உன்னை எப்படி treat பண்ணணும்? உன் personality, age, likes — எல்லாம் சொல்லலாம்.
              </Text>
              <TextInput
                style={s.profileTextArea}
                value={editUserBehaviour}
                onChangeText={setEditUserBehaviour}
                placeholder={'எ.கா: என் பெயர் Rahul, 24 வயசு. நான் romantic-ஆ பேசுவேன், மிகவும் கேர் பண்றேன். என்னோட favourite color green. நான் engineer.'}
                placeholderTextColor="#aaa"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={s.profileCharCount}>{editUserBehaviour.length}/500</Text>

              {/* Save */}
              <TouchableOpacity style={s.profileSaveBtn} onPress={saveUserProfile}>
                <Text style={s.profileSaveBtnTxt}>
                  {profileSaved ? '✅ Saved!' : '💾 Save Profile'}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Edit Relationship Modal ── */}
      <Modal visible={showEditRel} transparent animationType="fade"
        onRequestClose={() => setShowEditRel(false)}>
        <View style={s.overlay}>
          <View style={s.editBox}>
            <Text style={s.editTitle}>{editingPersona?.name}</Text>
            <Text style={s.editSub}>தொடர்பு (Relationship) மாத்துங்க</Text>
            <Text style={s.editProf}>💼 {editingPersona?.profession}</Text>
            <TextInput style={s.editInput} value={relInput} onChangeText={setRelInput}
              placeholder="உதா: தங்கை, மனைவி, காதலி..." placeholderTextColor="#aaa" autoFocus />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowEditRel(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={() => { saveRelationship(); if (editingPersona) { ParamsStore.setEditPersonaId(editingPersona.id); router.push('/edit-character'); } }}>
                <Text style={s.saveTxt}>📷 Profile Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveRelationship}>
                <Text style={s.saveTxt}>சேமி ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={() => {
                setShowEditRel(false);
                if (editingPersona) openUrlSettings(editingPersona);
              }}>
                <Text style={s.saveTxt}>🔗 URLs</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, { backgroundColor: '#c62828' }]} onPress={deleteCharacter}>
                <Text style={s.saveTxt}>🗑 Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Photo to Script Modal ── */}
      <Modal visible={showScriptModal} animationType="slide" onRequestClose={closeScriptModal}>
        <SafeAreaView style={s.scriptSafe} edges={['top','bottom']}>

          {/* Header */}
          <View style={s.scriptHeader}>
            <TouchableOpacity onPress={closeScriptModal} style={s.scriptBack}>
              <Text style={s.scriptBackTxt}>✕</Text>
            </TouchableOpacity>
            <View style={{ flex:1, alignItems:'center' }}>
              <Text style={s.scriptHeaderTitle}>📸 Photo to Script</Text>
              {scriptModelUsed ? (
                <View style={s.scriptModelBadge}>
                  <Text style={s.scriptModelBadgeTxt}>✨ {scriptModelUsed}</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity
              style={[s.scriptCopyBtn, scriptCopied && { backgroundColor:'#15803d' }]}
              onPress={async () => {
                if (!scriptText) return;
                try {
                  const Clipboard = await import('expo-clipboard');
                  await Clipboard.setStringAsync(scriptText);
                  setScriptCopied(true);
                  setTimeout(() => setScriptCopied(false), 2500);
                } catch {}
              }}
            >
              <Text style={s.scriptCopyTxt}>{scriptCopied ? '✓ Copied!' : '📋 Copy'}</Text>
            </TouchableOpacity>
          </View>

          {/* Preview image */}
          {scriptImageUri && (
            <Image source={{ uri: scriptImageUri }} style={s.scriptPreviewImg} resizeMode="cover" />
          )}

          {/* Content */}
          <ScrollView style={s.scriptScroll} contentContainerStyle={{ padding:16, paddingBottom:40 }}>
            {scriptLoading ? (
              <View style={s.scriptLoading}>
                <ActivityIndicator size="large" color="#7C3AED" />
                <Text style={s.scriptLoadTxt}>{scriptText || '📸 Image analyze பண்றேன்...'}</Text>
                <View style={s.scriptModelRow}>
                  <Text style={s.scriptModelStep}>All 13 Gemini keys auto-retry</Text>
                </View>
              </View>
            ) : (
              <Text style={s.scriptBody} selectable>{scriptText}</Text>
            )}
          </ScrollView>

          {/* Footer buttons — always visible */}
          <View style={s.scriptFooter}>
            <TouchableOpacity style={s.scriptNewBtn} onPress={handlePhotoToScript}>
              <Text style={s.scriptNewTxt}>🖼️ New Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.scriptCopyFooterBtn, scriptCopied && { backgroundColor:'#15803d' }]}
              onPress={async () => {
                if (!scriptText) return;
                try {
                  const Clipboard = await import('expo-clipboard');
                  await Clipboard.setStringAsync(scriptText);
                  setScriptCopied(true);
                  setTimeout(() => setScriptCopied(false), 2500);
                } catch {}
              }}
            >
              <Text style={s.scriptCopyFooterTxt}>{scriptCopied ? '✓ All Copied!' : '📋 Copy All'}</Text>
            </TouchableOpacity>
          </View>

        </SafeAreaView>
      </Modal>

      {/* ── Photo Folder Modal ── */}

      <Modal visible={showFolderModal} transparent animationType="slide"
        onRequestClose={() => setShowFolderModal(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>📸 Photo Style தேர்வு</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {photoStyles.map(f => (
                <TouchableOpacity key={f.id} style={s.folderRow} onPress={() => handleFolderSelect(f.id)}>
                  <View style={[s.folderDot, { backgroundColor: '#6C63FF' }]} />
                  <Text style={[s.folderLabel, { color: '#6C63FF' }]}>{f.name}</Text>
                  <Text style={s.folderArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setShowFolderModal(false)}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Photo Char Select Modal ── */}
      <Modal visible={showCharModal} transparent animationType="slide"
        onRequestClose={() => setShowCharModal(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Character தேர்வு</Text>
            <Text style={s.sheetSub}>யாரோட {photoStyles.find(f => f.id === pendingFolderId)?.name} photo வேணும்?</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {personas.map(p => (
                <TouchableOpacity key={p.id} style={s.sheetRow} onPress={() => handleCharForPhoto(p)}>
                  <View style={[s.sheetAvatar, { backgroundColor: p.avatarColor }]}>
                    {p.avatarPhotoUri
                      ? <Image source={{ uri: p.avatarPhotoUri }} style={s.sheetAvatarImg} />
                      : <Text style={s.sheetAvatarTxt}>{p.emoji}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sheetName}>{p.name}</Text>
                    <Text style={s.sheetRel}>{p.editedRelationship ?? p.relationship} · {p.profession}</Text>
                  </View>
                  <Text style={s.folderArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setShowCharModal(false)}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Group Chat Modal ── */}
      <Modal visible={showGroupModal && launch !== 'group-chat'} transparent animationType="slide"
        onRequestClose={() => setShowGroupModal(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>👥 Group Chat</Text>
            <Text style={s.sheetSub}>2+ characters select பண்ணுங்க</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {personas.map(p => {
                const sel = selectedForGroup.includes(p.id);
                return (
                  <TouchableOpacity key={p.id}
                    style={[s.sheetRow, sel && s.sheetRowSel]}
                    onPress={() => setSelectedForGroup(prev =>
                      prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]
                    )}>
                    <View style={[s.sheetAvatar, { backgroundColor: p.avatarColor }]}>
                      <Text style={s.sheetAvatarTxt}>{p.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sheetName}>{p.name}</Text>
                      <Text style={s.sheetRel}>{p.editedRelationship ?? p.relationship} · {p.profession}</Text>
                    </View>
                    {sel && <Text style={s.check}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={s.cancelBtn} onPress={() => { setShowGroupModal(false); setSelectedForGroup([]); }}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.saveBtn, selectedForGroup.length < 2 && { opacity: 0.4 }]}
                onPress={startGroupChat} disabled={selectedForGroup.length < 2}>
                <Text style={s.saveTxt}>Start ({selectedForGroup.length})</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── ADD CHARACTER MODAL ── */}
      <Modal visible={showAddCharModal} transparent animationType="slide"
        onRequestClose={() => setShowAddCharModal(false)}>
        <View style={s.overlay}>
          <ScrollView style={{ width: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            keyboardShouldPersistTaps="handled">
            <View style={[s.profileSheet, { padding: 20 }]}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#075E54', marginBottom: 14 }}>
                ➕ புது Character
              </Text>

              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>பெயர் *</Text>
              <TextInput style={s.profileInput} value={newCharName} onChangeText={setNewCharName}
                placeholder="உதா: ரஞ்சினி" placeholderTextColor="#aaa" />

              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4, marginTop: 10 }}>Relationship (Role)</Text>
              <TextInput style={s.profileInput} value={newCharRole} onChangeText={setNewCharRole}
                placeholder="உதா: காதலி, தோழி, அக்கா, மனைவி..." placeholderTextColor="#aaa" />

              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4, marginTop: 10 }}>Profession</Text>
              <TextInput style={s.profileInput} value={newCharSub} onChangeText={setNewCharSub}
                placeholder="உதா: Doctor, Teacher, Engineer..." placeholderTextColor="#aaa" />

              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4, marginTop: 10 }}>Description (வருணனை)</Text>
              <TextInput style={[s.profileInput, { minHeight: 70 }]} value={newCharDesc}
                onChangeText={setNewCharDesc} multiline numberOfLines={3}
                placeholder="உதா: 28 வயது, கோவை பொண்ணு. அன்பான, caring personality..."
                placeholderTextColor="#aaa" textAlignVertical="top" />

              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4, marginTop: 10 }}>Personality (குணம்)</Text>
              <TextInput style={[s.profileInput, { minHeight: 70 }]} value={newCharPersonality}
                onChangeText={setNewCharPersonality} multiline numberOfLines={3}
                placeholder="உதா: Normal mode-ல் shy-ஆ பேசுவா, presana mode-ல் bold-ஆ..."
                placeholderTextColor="#aaa" textAlignVertical="top" />

              <Text style={{ fontSize: 10, color: '#888', marginTop: 8, marginBottom: 12, lineHeight: 15 }}>
                {'📁 Cloudinary: character ID folder + '}{photoStyles.length}{' master style folders auto-create ஆகும்'}{' | 💾 AsyncStorage-ல் save ஆகும்'}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable style={s.cancelBtn} onPress={() => {
                  setShowAddCharModal(false);
                  setNewCharName(''); setNewCharRole(''); setNewCharSub('');
                  setNewCharDesc(''); setNewCharPersonality('');
                }}>
                  <Text style={s.cancelTxt}>Cancel</Text>
                </Pressable>
                <Pressable style={s.saveBtn} onPress={saveNewCharacter}>
                  <Text style={s.saveTxt}>💾 Save</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  </ImageBackground>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  directLaunchRoot: { flex: 1, backgroundColor: 'transparent' },
  directLaunchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 18,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.75)',
  },
  directLaunchBack: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  directLaunchBackText: { color: '#1E1B4B', fontSize: 32, lineHeight: 36, marginTop: -3 },
  directLaunchTitle: { color: '#1E1B4B', fontSize: 19, fontWeight: '800' },
  directLaunchSubtitle: { color: '#312E81', fontSize: 13, marginTop: 3 },
  directLaunchLoading: {
    flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  directLaunchLoadingText: { color: '#1E1B4B', fontSize: 15 },
  directGroupList: { flex: 1 },
  directGroupListContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  directGroupRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10,
    borderRadius: 24, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.75)',
    backgroundColor: 'rgba(255, 255, 255, 0.00)',
  },
  directGroupRowSelected: { borderColor: '#9333EA', backgroundColor: 'rgba(147, 51, 234, 0.15)' },
  directGroupName: { color: '#1E1B4B', fontWeight: '800' },
  directGroupRelationship: { color: '#312E81' },
  directGroupActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.75)' },
  directGroupCancel: { flex: 1, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.75)', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.00)' },
  directGroupCancelText: { color: '#1E1B4B', fontWeight: '700' },
  directGroupStart: { flex: 1, padding: 14, borderRadius: 20, backgroundColor: '#9333EA', alignItems: 'center' },
  directGroupStartDisabled: { opacity: 0.4 },
  directGroupStartText: { color: '#fff', fontWeight: '800' },

  header: {
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    paddingTop: 2,
    paddingBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBannerWrap: {
    width: '100%',
    height: 70,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    elevation: 4,
    shadowColor: '#7C3AED',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerThemeContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBannerImg: {
    width: '100%',
    height: '100%',
  },
  headerToastPill: {
    position: 'absolute',
    bottom: 4,
    alignSelf: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 2.5,
    borderRadius: 12,
    elevation: 5,
  },
  headerToastText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  doubleTapHintPill: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 8,
    paddingVertical: 1.5,
    borderRadius: 8,
  },
  doubleTapHintText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 8.5,
    fontWeight: '600',
  },
  userAvatarBtn: { alignItems: 'center', gap: 2, minWidth: 42 },
  userPhotoImg: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#51D8F2' },
  userPhotoDefault: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#17203A',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#51D8F2',
  },
  userNameBadge: {
    color: '#BFEFF7', fontSize: 9, fontWeight: '700',
    maxWidth: 60, textAlign: 'center',
  },

  // Profile modal
  profileOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  profileSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  profileHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 18, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  profileHeaderTitle: { fontSize: 18, fontWeight: 'bold', color: '#075E54' },
  profileHeaderClose: { fontSize: 22, color: '#888' },
  profileScroll: { padding: 18, paddingBottom: 40 },
  profileSectionLabel: { fontSize: 13, fontWeight: '800', color: '#075E54', marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileSectionHint: { fontSize: 12, color: '#888', marginBottom: 8, lineHeight: 18 },
  profileAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 },
  profileAvatar: { width: 84, height: 84, borderRadius: 42, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e0e0e0' },
  profileAvatarEdit: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#075E54', width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarEditTxt: { fontSize: 11 },
  profileAvatarBtns: { flex: 1, gap: 8 },
  profileAvatarBtn: {
    backgroundColor: '#e8f5e9', borderRadius: 10, paddingVertical: 10,
    alignItems: 'center',
  },
  profileAvatarBtnTxt: { fontSize: 13, fontWeight: '700', color: '#075E54' },
  profileCloudRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  profileCloudInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, color: '#111',
  },
  profileCloudApply: {
    backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  profileCloudApplyTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  profileInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111',
    marginBottom: 4,
  },
  profileTextArea: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111',
    minHeight: 110, marginBottom: 4,
  },
  profileCharCount: { fontSize: 11, color: '#aaa', textAlign: 'right', marginBottom: 12 },
  profileSaveBtn: {
    backgroundColor: '#075E54', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 4,
  },
  profileSaveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', paddingLeft: 4, letterSpacing: 0.3 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAddCharBtn: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1.5,
    borderColor: '#2FE3C5', backgroundColor: '#102B30',
    alignItems: 'center', justifyContent: 'center',
  },
  headerAddCharTxt: { color: '#fff', fontSize: 23, lineHeight: 25, fontWeight: '700' },
  headerCharBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#00897B', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  headerCharIcon: { fontSize: 12, color: '#fff' },
  headerCharTxt: { fontSize: 12, color: '#fff', fontWeight: '700' },
  headerSpacer: { flex: 1 },
  buildBadge: { backgroundColor: '#4A236D', borderWidth: 1, borderColor: '#D47CFF', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10 },
  buildBadgeTxt: { color: '#F3D9FF', fontSize: 9, fontWeight: '800' },
  statusPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 11, borderWidth: 1 },
  wakePill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 11, backgroundColor: '#13283F', borderWidth: 1, borderColor: '#5CCEFF', justifyContent: 'center', alignItems: 'center' },
  wakePillOk: { backgroundColor: '#173E34', borderColor: '#67E89F' },
  wakePillTxt: { color: '#D9F4FF', fontSize: 10, fontWeight: '700' },
  statusOnline: { backgroundColor: '#13372F', borderColor: '#5BE99B' },
  statusOffline: { backgroundColor: '#3A192C', borderColor: '#FF6FB7' },
  statusPillTxt: { color: '#E8FFF4', fontSize: 10, fontWeight: '700' },
  pushBadge: { color: '#fff', fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },

  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  list: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingTop: 4, paddingBottom: 40 },
  gridListContent: { paddingTop: 6, paddingBottom: 40, paddingLeft: 10, paddingRight: 10 },
  gridColumn: { justifyContent: 'space-between' },
  gridSeparator: { height: 6 },
  gridCard: {
    width: '48.5%', height: 136, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.75)',
    backgroundColor: 'rgba(255, 255, 255, 0.00)',
    paddingHorizontal: 8, paddingVertical: 5,
    alignItems: 'center', justifyContent: 'space-between',
    shadowColor: 'transparent', shadowOpacity: 0, elevation: 0,
  },
  gridTopRow: {
    width: '100%', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    gap: 4, minHeight: 18,
  },
  activeBadgeSmall: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(220, 252, 231, 0.7)',
    borderWidth: 1, borderColor: 'rgba(134, 239, 172, 0.8)',
    borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1.5, gap: 3.5,
  },
  activeTxtSmall: { color: '#15803D', fontSize: 9, fontWeight: '700' },
  gridBottomInfo: { alignItems: 'center', width: '100%', minWidth: 0, marginTop: 2 },
  gridName: { color: '#1E1B4B', fontSize: 13.5, fontWeight: '800', textAlign: 'center' },
  gridSub: { color: '#1E1B4B', opacity: 0.85, fontSize: 10, fontWeight: '600', textAlign: 'center' },

  chatRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.00)',
    marginHorizontal: 12, marginVertical: 2,
    paddingHorizontal: 10, paddingVertical: 3.5,
    borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.75)',
    shadowColor: 'transparent', shadowOpacity: 0, elevation: 0,
  },
  avatarGlowRing: {
    width: 64, height: 64, borderRadius: 32,
    padding: 2, borderWidth: 2, borderColor: '#A855F7',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatar: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: 56, height: 56, borderRadius: 28 },
  avatarTxt: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  chatMid: { flex: 1, marginLeft: 10, marginRight: 6, justifyContent: 'center' },
  chatNameRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, marginBottom: 2 },
  chatName: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: '#1E1B4B', letterSpacing: 0.15 },
  chatSub: { fontSize: 12, color: '#1E1B4B', opacity: 0.9, lineHeight: 16, fontWeight: '600' },
  chatRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 3 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(220, 252, 231, 0.7)',
    borderWidth: 1, borderColor: 'rgba(134, 239, 172, 0.8)',
    borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2, gap: 4,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  activeTxt: { color: '#15803D', fontSize: 10, fontWeight: '700' },
  urlSettingsBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  urlSettingsTxt: { fontSize: 16 },
  timerBadge: { fontSize: 10, color: '#1E1B4B', fontWeight: '700', backgroundColor: 'rgba(255, 255, 255, 0.4)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  badge: { backgroundColor: '#24C980', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1, borderColor: '#A1FFD0', marginTop: 4 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  sep: { height: 2 },

  fab: { position: 'absolute', right: 10, bottom: 20, gap: 8, alignItems: 'center' },
  fabBtn: {
    backgroundColor: 'transparent', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', elevation: 8,
    shadowOpacity: 0.62, shadowRadius: 9, shadowOffset: { width: 0, height: 0 },
    minWidth: 66, width: 66, height: 66, borderWidth: 1.5,
  },
  fabGradient: { borderRadius: 12.5 },
  fabPink: { backgroundColor: '#29132B', borderColor: '#F14DB7', shadowColor: '#F14DB7' },
  fabTeal: { backgroundColor: '#102B30', borderColor: '#2FE3C5', shadowColor: '#2FE3C5' },
  fabCyan: { backgroundColor: '#14243A', borderColor: '#70D7FF', shadowColor: '#70D7FF' },
  fabViolet: { backgroundColor: '#251632', borderColor: '#C47CFF', shadowColor: '#C47CFF' },
  fabPinkDeep: { backgroundColor: '#2D1530', borderColor: '#F06BD0', shadowColor: '#F06BD0' },
  fabBlue: { backgroundColor: '#11253A', borderColor: '#5DCBFF', shadowColor: '#5DCBFF' },
  fabIcon: { fontSize: 20 },
  fabLabel: { fontSize: 9, fontWeight: '800', color: '#F7F4FF', marginTop: 2, textAlign: 'center', lineHeight: 11 },
  fabScriptImg: { width: 28, height: 28, borderRadius: 6 },

  // ── Photo to Script Modal ──
  scriptSafe: { flex: 1, backgroundColor: '#0f0f1a' },
  scriptHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  scriptBack: { padding: 6 },
  scriptBackTxt: { color: '#9ca3af', fontSize: 18, fontWeight: '700' },
  scriptHeaderIcon: { width: 28, height: 28, borderRadius: 6 },
  scriptHeaderTitle: { color: '#e9d5ff', fontSize: 16, fontWeight: '800' },
  scriptCopyBtn: {
    backgroundColor: '#4A1D96', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  scriptCopyTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  scriptPreviewImg: { width: '100%', height: 180 },
  scriptScroll: { flex: 1 },
  scriptLoading: { alignItems: 'center', paddingTop: 40, gap: 12 },
  scriptLoadTxt: { color: '#c4b5fd', fontSize: 15, fontWeight: '600', marginTop: 8 },
  scriptBody: { color: '#e5e7eb', fontSize: 14, lineHeight: 22 },
  scriptFooter: { padding: 14, borderTopWidth: 1, borderTopColor: '#1f2937' },
  scriptRetryBtn: {
    backgroundColor: '#1f2937', borderRadius: 12, borderWidth: 1, borderColor: '#374151',
    paddingVertical: 12, alignItems: 'center',
  },
  scriptRetryTxt: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },

  // ── Edit Relationship ──
  editBox: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '88%' },
  editTitle: { fontSize: 18, fontWeight: 'bold', color: '#075E54', marginBottom: 4 },
  editSub: { fontSize: 13, color: '#888', marginBottom: 8 },
  editProf: { fontSize: 13, color: '#555', marginBottom: 14, backgroundColor: '#f5f5f5', padding: 8, borderRadius: 8 },
  editInput: {
    borderWidth: 1.5, borderColor: '#075E54', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111', marginBottom: 16,
  },

  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, width: '100%', position: 'absolute', bottom: 0,
  },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: '#075E54', marginBottom: 4 },
  sheetSub: { fontSize: 13, color: '#888', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, marginBottom: 2 },
  sheetRowSel: { backgroundColor: '#e8f5e9' },
  sheetAvatar: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  sheetAvatarImg: { width: 42, height: 42, borderRadius: 21 },
  sheetAvatarTxt: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  sheetName: { fontSize: 15, fontWeight: '600', color: '#111' },
  sheetRel: { fontSize: 12, color: '#666', marginTop: 1 },
  check: { color: '#25D366', fontSize: 20, fontWeight: 'bold' },

  folderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 8, marginBottom: 2 },
  folderDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  folderLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  folderArrow: { color: '#bbb', fontSize: 22, fontWeight: 'bold' },

  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ccc', alignItems: 'center' },
  cancelTxt: { color: '#555', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#075E54', alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: 'bold' },
});
