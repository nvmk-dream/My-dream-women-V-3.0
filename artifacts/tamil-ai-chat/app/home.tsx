import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ScrollView, StatusBar, Dimensions, Image, Modal, FlatList,
  ActivityIndicator, ImageBackground,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { uploadUriToCloudinary } from "../services/api";
import { requestPhotoVideoPermissionsAsync } from "../services/media-permissions";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

const { width } = Dimensions.get("window");

// Rows 1-3 have 4 columns; Row 4 has 2 equal columns (50% each)
const GAP = 10;
const PADDING = 16;
const AVAILABLE_W = width - PADDING * 2;
const TILE_W = Math.floor((AVAILABLE_W - GAP * 3) / 4);
const TILE_H = Math.round(TILE_W * 1.34);
const WIDE_W = Math.floor((AVAILABLE_W - GAP) / 2);
const WIDE_H = TILE_H;

const COVER_KEY = "home_cover_image";
const CUSTOM_SERVER_KEY = "custom_server_url";
const DEFAULT_RENDER_URL = "https://my-dream-women-v-3-0.onrender.com";

const CARD_IMAGES: Record<string, any> = {
  pictures: require("../assets/images/cloud_cat_pictures.png"),
  camera: require("../assets/images/cloud_cat_camera.png"),
  movies: require("../assets/images/cloud_cat_movies.png"),
  screenshots: require("../assets/images/cloud_cat_screenshots.png"),

  downloads: require("../assets/images/cloud_cat_downloads.png"),
  documents: require("../assets/images/cloud_cat_documents.png"),
  music: require("../assets/images/cloud_cat_music.png"),
  icons: require("../assets/images/cloud_cat_icons.png"),

  cloud: require("../assets/images/cloud_cat_cloud.png"),
  projects: require("../assets/images/cloud_cat_projects.png"),
  notes: require("../assets/images/cloud_cat_notes.png"),
  keys: require("../assets/images/cloud_cat_keys.png"),

  videos: require("../assets/images/cloud_cat_videos.png"),
  aiGirls: require("../assets/images/cloud_cat_ai_girls.png"),
};

type Category = {
  key: string;
  label: string;
  image: any;
  route: string;
  isWide?: boolean;
};

// Exactly 14 categories in user-approved order:
// Row 1: Pictures, Camera, Movies, Screenshots
// Row 2: Downloads, Documents, Music, Icons
// Row 3: Cloud, Projects, Notes, Keys
// Row 4 (Wide 50% cards): Videos, My AI Girls
const CATEGORIES: Category[] = [
  { key: "pictures", label: "Pictures", image: CARD_IMAGES.pictures, route: "/gallery?album=pictures" },
  { key: "camera", label: "Camera", image: CARD_IMAGES.camera, route: "/gallery?album=camera" },
  { key: "movies", label: "Movies", image: CARD_IMAGES.movies, route: "/gallery?album=movies" },
  { key: "screenshots", label: "Screenshots", image: CARD_IMAGES.screenshots, route: "/gallery?album=screenshots" },

  { key: "downloads", label: "Downloads", image: CARD_IMAGES.downloads, route: "/gallery?album=downloads" },
  { key: "documents", label: "Documents", image: CARD_IMAGES.documents, route: "/gallery?album=documents" },
  { key: "music", label: "Music", image: CARD_IMAGES.music, route: "/gallery?album=music" },
  { key: "icons", label: "Icons", image: CARD_IMAGES.icons, route: "/gallery?album=icons" },

  { key: "cloud", label: "Cloud", image: CARD_IMAGES.cloud, route: "/cloud-storage" },
  { key: "projects", label: "Projects", image: CARD_IMAGES.projects, route: "/gallery?album=projects" },
  { key: "notes", label: "Notes", image: CARD_IMAGES.notes, route: "/notes" },
  { key: "keys", label: "Keys", image: CARD_IMAGES.keys, route: "/keys" },

  { key: "videos", label: "Videos", image: CARD_IMAGES.videos, route: "/videos", isWide: true },
  { key: "ai-girls", label: "My AI Girls", image: CARD_IMAGES.aiGirls, route: "/ai-girls-cloud", isWide: true },
];

const CLOUD_ENABLED = new Set([
  "pictures", "camera", "movies", "screenshots", "downloads",
  "documents", "music", "icons", "ai-girls", "videos",
]);

type CloudPhoto = { uri: string };

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [showPickModal, setShowPickModal] = useState(false);
  const [cloudPhotos, setCloudPhotos] = useState<CloudPhoto[]>([]);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [serverStatus, setServerStatus] = useState<"unknown" | "ok" | "sleeping">("unknown");
  const [wakingServer, setWakingServer] = useState(false);

  const [cloudSheet, setCloudSheet] = useState<string | null>(null);
  const [cloudUploading, setCloudUploading] = useState(false);
  const [cloudProgress, setCloudProgress] = useState(0);
  const [cloudTotal, setCloudTotal] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(COVER_KEY).then(v => { if (v) setCoverUri(v); }).catch(() => {});
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
      setServerStatus(res.ok ? "ok" : "sleeping");
    } catch {
      setServerStatus("sleeping");
    }
  };

  const wakeRenderServer = async () => {
    setWakingServer(true);
    setServerStatus("unknown");
    try {
      const savedUrl = await AsyncStorage.getItem(CUSTOM_SERVER_KEY).catch(() => null);
      const serverUrl = savedUrl || DEFAULT_RENDER_URL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      await fetch(`${serverUrl}/api/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      setServerStatus("ok");
    } catch {
      setServerStatus("sleeping");
    } finally {
      setWakingServer(false);
    }
  };

  const pickFromGallery = useCallback(async () => {
    setShowPickModal(false);
    await new Promise(r => setTimeout(r, 400));
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission", "Gallery access allow பண்ணுங்க"); return; }
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
        keys.filter(k => k.startsWith("cloud_photos_") || k === "my_girls_cloud_images"),
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

  const handleCloudUpload = async (catKey: string) => {
    setCloudSheet(null);
    await new Promise(r => setTimeout(r, 300));
    const perm = await requestPhotoVideoPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission", "Gallery access allow பண்ணுங்க"); return; }
    const isVideo = catKey === "videos" || catKey === "movies";
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;

    const assets = result.assets;
    setCloudTotal(assets.length);
    setCloudProgress(0);
    setCloudUploading(true);

    let done = 0;
    const failures: string[] = [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setCloudProgress(i + 1);
      const ext = (asset.fileName?.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
      const mime = isVideo ? (ext === "mov" ? "video/quicktime" : "video/mp4") : (ext === "png" ? "image/png" : "image/jpeg");
      const folder = `storage/${catKey}`;

      try {
        const up = await uploadUriToCloudinary(asset.uri, mime, folder);
        if (up?.url) {
          done++;
          const storageKey = `cloud_photos_${catKey}`;
          const existing = await AsyncStorage.getItem(storageKey).catch(() => null);
          const list: any[] = existing ? JSON.parse(existing) : [];
          list.unshift({ uri: up.url, public_id: up.public_id, date: new Date().toISOString() });
          await AsyncStorage.setItem(storageKey, JSON.stringify(list)).catch(() => {});
        } else {
          failures.push(asset.fileName || `file ${i + 1}`);
        }
      } catch (e: any) {
        failures.push(e?.message || `file ${i + 1}`);
      }
    }

    setCloudUploading(false);
    const cat = CATEGORIES.find(c => c.key === catKey);
    if (done > 0) {
      Alert.alert(
        failures.length ? "Partial Upload" : `${cat?.label} Cloud Upload ஆச்சு!`,
        `${done}/${assets.length} files "${cat?.label}" cloud folder-ல் save ஆச்சு.${failures.length ? `\n${failures.length} fail ஆச்சு.` : ""}`,
        [
          { text: "OK", style: "cancel" },
          { text: "View", onPress: () => { if (cat?.route) router.push(cat.route as any); } },
        ],
      );
    } else {
      Alert.alert("Upload பிழை", `0/${assets.length} upload ஆச்சு.\n${failures[0] || ""}`);
    }
  };

  const openCloudSheet = (catKey: string) => {
    if (catKey === "ai-girls" || catKey === "videos") {
      const cat = CATEGORIES.find(c => c.key === catKey);
      if (cat?.route) router.push(cat.route as any);
      return;
    }
    setCloudSheet(catKey);
  };

  const cloudSheetCat = CATEGORIES.find(c => c.key === cloudSheet);

  return (
    <ImageBackground
      source={require("../assets/images/cloud_spring_bg.png")}
      style={s.safe}
      resizeMode="cover"
    >
      <SafeAreaView style={s.safeInner} edges={["top", "left", "right", "bottom"]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        {/* ── Top Glass Header ── */}
        <View style={s.headerWrap}>
          <View style={s.headerCard}>
            <View style={s.headerLeft}>
              <LinearGradient
                colors={["#E024A5", "#8B5CF6", "#3B82F6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.cloudLogoBadge}
              >
                <MaterialCommunityIcons name="cloud" size={20} color="#FFFFFF" />
              </LinearGradient>
              <View>
                <Text style={s.headerTitle}>My Dream Women</Text>
                <Text style={s.headerSub}>your dream companion</Text>
              </View>
            </View>

            <View style={s.headerActions}>
              <TouchableOpacity
                accessibilityLabel="Edit cover"
                style={s.actionBtn}
                onPress={() => setShowPickModal(true)}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="pencil-outline" size={20} color="#6B46C1" />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="Settings"
                style={s.actionBtn}
                onPress={() => router.push("/settings")}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="cog-outline" size={22} color="#6B46C1" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Optional Custom Cover Banner ── */}
          {coverUri ? (
            <View style={s.coverCard}>
              <Image
                source={{ uri: coverUri }}
                style={s.coverImg}
                resizeMode="cover"
                onError={() => {
                  setCoverUri(null);
                  AsyncStorage.removeItem(COVER_KEY).catch(() => {});
                }}
              />
              <TouchableOpacity
                style={s.removeCoverBtn}
                onPress={resetToDefault}
              >
                <MaterialCommunityIcons name="close-circle" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Render Server Warning Banner ── */}
          {serverStatus === "sleeping" && (
            <View style={s.serverBanner}>
              <View style={s.serverIconCircle}>
                <MaterialCommunityIcons name="alert-circle-outline" size={24} color="#E11D48" />
              </View>
              <View style={s.serverTextWrap}>
                <Text style={s.serverBannerTitle}>Server-ஐ connect ஆகவில்லை</Text>
                <Text style={s.serverBannerSub}>Render சர்வர் run ஆகவில்லை. check பண்ணு. AI Girls chat slow ஆ இருக்கலாம்.</Text>
              </View>
              <TouchableOpacity
                style={s.retryButton}
                onPress={wakeRenderServer}
                disabled={wakingServer}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={["#FF2A6D", "#FF6584"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={s.retryGradient}
                >
                  {wakingServer ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="refresh" size={16} color="#FFFFFF" />
                      <Text style={s.retryText}>Retry</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* ── STORAGE Section Header ── */}
          <View style={s.storageHeaderRow}>
            <MaterialCommunityIcons name="database" size={22} color="#18204E" />
            <Text style={s.sectionLabel}>STORAGE</Text>
          </View>

          {/* ── 14 Cards Grid (Rows 1-3: 4 cols; Row 4: 2 equal wide cols) ── */}
          <View style={s.grid}>
            {CATEGORIES.map(cat => {
              const hasCloud = CLOUD_ENABLED.has(cat.key);
              const cardWidth = cat.isWide ? WIDE_W : TILE_W;
              const cardHeight = cat.isWide ? WIDE_H : TILE_H;

              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[s.tileCard, { width: cardWidth, height: cardHeight }]}
                  onPress={() => { if (cat.route) router.push(cat.route as any); }}
                  activeOpacity={0.84}
                >
                  <Image source={cat.image} style={s.tileImage} resizeMode="cover" />

                  {/* Top-Right Cyan Cloud Badge */}
                  {hasCloud && (
                    <TouchableOpacity
                      style={s.cloudBadge}
                      onPress={() => openCloudSheet(cat.key)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons name="cloud" size={13} color="#25D9F4" />
                    </TouchableOpacity>
                  )}

                  {/* Bottom Label Bar with Arrow */}
                  <LinearGradient
                    colors={["transparent", "rgba(10, 15, 30, 0.72)", "rgba(5, 10, 24, 0.94)"]}
                    style={s.tileBottomBar}
                  >
                    <Text style={s.tileLabel} numberOfLines={1}>{cat.label}</Text>
                    <MaterialCommunityIcons name="chevron-right" size={16} color="#FFFFFF" />
                  </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* ── Cloud upload progress overlay ── */}
        {cloudUploading && (
          <View style={s.uploadOverlay}>
            <View style={s.uploadCard}>
              <ActivityIndicator size="large" color="#25D9F4" />
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
              <Text style={s.sheetTitle}>{cloudSheetCat?.label} — Cloud</Text>
              <Text style={s.sheetSub}>இந்த folder-க்கான Cloud options:</Text>

              <TouchableOpacity
                style={s.sheetOption}
                onPress={() => cloudSheet && handleCloudUpload(cloudSheet)}
              >
                <View style={[s.sheetOptionIcon, { backgroundColor: "#087EAA" }]}>
                  <MaterialCommunityIcons name="cloud-upload-outline" size={24} color="#FFFFFF" />
                </View>
                <View style={s.sheetOptionInfo}>
                  <Text style={s.sheetOptionTitle}>Cloud-ல் Upload பண்ணு</Text>
                  <Text style={s.sheetOptionSub}>Phone-லிருந்து Cloudinary-க்கு safe-ஆ save பண்ணு</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.sheetOption}
                onPress={() => {
                  const route = cloudSheetCat?.route;
                  setCloudSheet(null);
                  if (route) router.push(route as any);
                }}
              >
                <View style={[s.sheetOptionIcon, { backgroundColor: "#4C1D95" }]}>
                  <MaterialCommunityIcons name="folder-eye-outline" size={24} color="#FFFFFF" />
                </View>
                <View style={s.sheetOptionInfo}>
                  <Text style={s.sheetOptionTitle}>Cloud Files பார்</Text>
                  <Text style={s.sheetOptionSub}>Cloud-ல் save ஆகியுள்ள files பார்க்க</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={s.sheetCancel} onPress={() => setCloudSheet(null)}>
                <Text style={s.sheetCancelTxt}>ரத்து</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* ── Choose Cover Modal ── */}
        <Modal
          visible={showPickModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowPickModal(false)}
        >
          <TouchableOpacity style={s.pickOverlay} activeOpacity={1} onPress={() => setShowPickModal(false)}>
            <View style={s.pickBox}>
              <Text style={s.pickTitle}>Header Cover Image</Text>
              <Text style={s.pickSub}>Home screen cover photo மாற்றுங்கள்:</Text>

              <TouchableOpacity style={s.pickOption} onPress={pickFromGallery}>
                <MaterialCommunityIcons name="image-plus" size={28} color="#25D9F4" />
                <View>
                  <Text style={s.pickOptionTitle}>Gallery-லிருந்து தேர்ந்தெடு</Text>
                  <Text style={s.pickOptionSub}>Phone-ல் உள்ள ஒரு படத்தை வை</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={s.pickOption} onPress={openCloudPicker}>
                <MaterialCommunityIcons name="cloud-search-outline" size={28} color="#A78BFA" />
                <View>
                  <Text style={s.pickOptionTitle}>Cloud Photos-லிருந்து தேர்ந்தெடு</Text>
                  <Text style={s.pickOptionSub}>Cloud-ல் save ஆகியுள்ள படம்</Text>
                </View>
              </TouchableOpacity>

              {coverUri && (
                <TouchableOpacity style={s.pickOption} onPress={resetToDefault}>
                  <MaterialCommunityIcons name="restore" size={28} color="#F43F5E" />
                  <View>
                    <Text style={s.pickOptionTitle}>Default-க்கு மாற்று</Text>
                    <Text style={s.pickOptionSub}>Custom cover image நீக்கு</Text>
                  </View>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={s.pickCancel} onPress={() => setShowPickModal(false)}>
                <Text style={s.pickCancelTxt}>ரத்து</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Cloud Photo Picker Modal ── */}
        <Modal
          visible={showCloudPicker}
          animationType="slide"
          onRequestClose={() => setShowCloudPicker(false)}
        >
          <View style={s.cloudPickerWrap}>
            <View style={s.cloudPickerHeader}>
              <Text style={s.cloudPickerTitle}>Cloud Photo தேர்ந்தெடு</Text>
              <TouchableOpacity onPress={() => setShowCloudPicker(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#18204E" />
              </TouchableOpacity>
            </View>
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
          </View>
        </Modal>
      </SafeAreaView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  safeInner: { flex: 1 },
  headerWrap: {
    paddingHorizontal: PADDING,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerCard: {
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  cloudLogoBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#18204E",
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#EDE9FE",
    borderWidth: 1.2,
    borderColor: "#C4B5FD",
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: {
    paddingHorizontal: PADDING,
    paddingTop: 8,
    paddingBottom: 40,
  },
  coverCard: {
    width: "100%",
    height: 140,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
  },
  coverImg: {
    width: "100%",
    height: "100%",
  },
  removeCoverBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 14,
    padding: 2,
  },
  serverBanner: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#FDA4AF",
    padding: 12,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#E11D48",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  serverIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFE4E6",
    justifyContent: "center",
    alignItems: "center",
  },
  serverTextWrap: {
    flex: 1,
  },
  serverBannerTitle: {
    color: "#E11D48",
    fontSize: 13,
    fontWeight: "800",
  },
  serverBannerSub: {
    color: "#4B5563",
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  retryButton: {
    borderRadius: 18,
    overflow: "hidden",
  },
  retryGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  storageHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "900",
    color: "#18204E",
    letterSpacing: 1.5,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
  },
  tileCard: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    backgroundColor: "#FFFFFF",
    shadowColor: "#A5B4D6",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  tileImage: {
    width: "100%",
    height: "100%",
  },
  cloudBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(5, 13, 35, 0.82)",
    borderWidth: 1.2,
    borderColor: "#25D9F4",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 5,
  },
  tileBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingTop: 16,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tileLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    flex: 1,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3, 9, 20, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99,
  },
  uploadCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 36,
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderColor: "#25D9F4",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  uploadCardTxt: { fontSize: 15, fontWeight: "700", color: "#18204E" },
  uploadCardCount: { fontSize: 20, fontWeight: "800", color: "#087EAA" },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 9, 20, 0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 12,
    paddingBottom: 36,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  sheetHandle: {
    width: 42,
    height: 4,
    backgroundColor: "#D1D5DB",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: "#18204E", marginBottom: 4 },
  sheetSub: { fontSize: 13, color: "#6B7280", marginBottom: 18 },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sheetOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  sheetOptionInfo: { flex: 1 },
  sheetOptionTitle: { fontSize: 14.5, fontWeight: "700", color: "#18204E" },
  sheetOptionSub: { fontSize: 11.5, color: "#64748B", marginTop: 2 },
  sheetCancel: {
    marginTop: 6,
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetCancelTxt: { color: "#475569", fontWeight: "700", fontSize: 14 },
  pickOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 9, 20, 0.65)",
    justifyContent: "flex-end",
  },
  pickBox: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    paddingBottom: 36,
  },
  pickTitle: { fontSize: 18, fontWeight: "800", color: "#18204E", marginBottom: 4 },
  pickSub: { fontSize: 13, color: "#6B7280", marginBottom: 18 },
  pickOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  pickOptionTitle: { fontSize: 15, fontWeight: "700", color: "#18204E" },
  pickOptionSub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  pickCancel: {
    marginTop: 4,
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  pickCancelTxt: { color: "#475569", fontWeight: "700", fontSize: 14 },
  cloudPickerWrap: {
    flex: 1,
    marginTop: 50,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  cloudPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  cloudPickerTitle: { fontSize: 17, fontWeight: "800", color: "#18204E" },
  cloudThumb: {
    width: (width - 32) / 3,
    height: (width - 32) / 3,
    margin: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  cloudThumbImg: { width: "100%", height: "100%" },
});
