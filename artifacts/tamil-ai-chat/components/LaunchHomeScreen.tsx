import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Pressable,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { trackCloudinaryUpload, uploadUriToCloudinary } from '../services/api';

const COVER_KEY = 'launch_home_hero_cover_url_v1';
const COVER_FOLDER = 'my-girls/home-cover';

type ServerStatus = 'unknown' | 'ok' | 'sleeping';

const CARD_IMAGES = {
  textToImage: require('../assets/images/home_card_text_to_image.png'),
  aiCharacters: require('../assets/images/home_card_ai_characters.png'),
  groupChat: require('../assets/images/home_card_group_chat.png'),
  imageToScript: require('../assets/images/home_card_image_to_script.png'),
  faceSwap: require('../assets/images/home_card_face_swap.png'),
  cloud: require('../assets/images/home_card_cloud.png'),
};

type Feature = {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bgImage: any;
  route?: string;
  launchIntent?: 'group-chat' | 'image-to-script';
};

const FEATURES: Feature[] = [
  { title: 'Text to Image', subtitle: 'Create Images', icon: 'image-outline', color: '#E64BFF', bgImage: CARD_IMAGES.textToImage, route: '/prompt-image' },
  { title: 'AI Characters', subtitle: 'Meet AI Girls', icon: 'person-outline', color: '#42D9FF', bgImage: CARD_IMAGES.aiCharacters },
  { title: 'Group Chat', subtitle: 'Chat Together', icon: 'people-outline', color: '#38E6A1', bgImage: CARD_IMAGES.groupChat, route: '/ai-girls', launchIntent: 'group-chat' },
  { title: 'Image to Script', subtitle: 'Photo Stories', icon: 'document-text-outline', color: '#F5D845', bgImage: CARD_IMAGES.imageToScript, route: '/ai-girls', launchIntent: 'image-to-script' },
  { title: 'Face Swap', subtitle: 'Swap Faces', icon: 'swap-horizontal-outline', color: '#E64BFF', bgImage: CARD_IMAGES.faceSwap, route: '/face-swap' },
  { title: 'Cloud', subtitle: 'Your Gallery', icon: 'cloud-outline', color: '#42CFFF', bgImage: CARD_IMAGES.cloud, route: '/home' },
];

export default function LaunchHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const heroTapAt = useRef(0);
  const [isOnline, setIsOnline] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('unknown');
  const [wakingServer, setWakingServer] = useState(false);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  const pageHeight = pageSize.height || Math.max(1, windowHeight - insets.top - insets.bottom);
  const pageWidth = Math.min(pageSize.width || windowWidth, 840);
  const topInset = Platform.OS === 'web' ? 67 : 4;
  const bottomInset = Platform.OS === 'web' ? 34 : 4;
  const compact = pageHeight < 700;
  const verticalGap = compact ? 8 : 10;
  const headerHeight = Math.max(50, Math.min(64, Math.round(pageHeight * 0.075)));
  const gridRowGap = compact ? 8 : 10;
  const availableCardsAndHero = Math.max(
    380,
    pageHeight - topInset - bottomInset - headerHeight - verticalGap * 2 - gridRowGap,
  );
  const tileWidth = Math.max(0, Math.floor((pageWidth - 32 - 16) / 3));
  // Responsive card height: expands to fill screen space evenly without empty bottom gap
  const heroHeight = Math.max(180, Math.min(Math.round(availableCardsAndHero * 0.44), 320));
  const remainingForCards = Math.max(180, availableCardsAndHero - heroHeight - gridRowGap);
  const cardHeight = Math.max(Math.round(tileWidth * 0.92), Math.floor((remainingForCards - gridRowGap) / 2));
  const iconRingSize = Math.max(36, Math.min(72, Math.round(cardHeight * 0.4)));
  const smallText = cardHeight < 126;
  const headerIconSize = Math.max(42, Math.min(62, headerHeight - 4));

  const checkRenderServer = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('custom_server_url').catch(() => null);
      const serverUrl = savedUrl || 'https://my-dream-women-v-3-0.onrender.com';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(serverUrl + '/api/healthz', { signal: controller.signal });
        setServerStatus(res.ok ? 'ok' : 'sleeping');
      } finally {
        clearTimeout(timer);
      }
    } catch {
      setServerStatus('sleeping');
    }
  };

  useEffect(() => {
    AsyncStorage.getItem(COVER_KEY)
      .then(value => { if (value) setHeroImageUrl(value); })
      .catch(() => {});
    AsyncStorage.getItem('chat_is_online')
      .then(value => { if (value !== null) setIsOnline(value === 'true'); })
      .catch(() => {});
    void checkRenderServer();
  }, []);

  const toggleOnline = async () => {
    const next = !isOnline;
    setIsOnline(next);
    try { await AsyncStorage.setItem('chat_is_online', String(next)); } catch {}
  };

  const chooseHeroBackground = async () => {
    if (coverUploading) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Gallery permission', 'Background image தேர்வு செய்ய Photos permission allow செய்யவும்.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!mimeType.startsWith('image/')) {
        Alert.alert('Unsupported image', 'JPG, PNG அல்லது WebP image மட்டும் தேர்ந்தெடுக்கவும்.');
        return;
      }

      setCoverUploading(true);
      const uploaded = await uploadUriToCloudinary(asset.uri, mimeType, COVER_FOLDER);
      if (!uploaded.url || !uploaded.public_id) throw new Error('Image upload URL கிடைக்கவில்லை.');
      await AsyncStorage.setItem(COVER_KEY, uploaded.url);
      setHeroImageUrl(uploaded.url);
      trackCloudinaryUpload(COVER_FOLDER, uploaded.public_id, uploaded.url).catch(() => {});
      Alert.alert('Background updated', 'புதிய Hero image save செய்யப்பட்டது.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image upload ஆகவில்லை.';
      Alert.alert('Background update failed', `${message}\n\nதற்போதைய image மாற்றப்படவில்லை.`);
    } finally {
      setCoverUploading(false);
    }
  };

  const handleHeroSurfaceTap = () => {
    const now = Date.now();
    if (now - heroTapAt.current < 360) {
      heroTapAt.current = 0;
      void chooseHeroBackground();
    } else {
      heroTapAt.current = now;
    }
  };

  const wakeRenderServer = async () => {
    if (wakingServer) return;
    setWakingServer(true);
    setServerStatus('unknown');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const savedUrl = await AsyncStorage.getItem('custom_server_url').catch(() => null);
      const serverUrl = savedUrl || 'https://my-dream-women-v-3-0.onrender.com';
      const res = await fetch(serverUrl + '/api/healthz', { signal: controller.signal });
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
      clearTimeout(timer);
      setWakingServer(false);
    }
  };

  const version = Constants.expoConfig?.version ?? '1.3.0';
  const versionCode = Constants.expoConfig?.android?.versionCode;
  const versionLabel = 'V' + version + (versionCode ? ' (' + versionCode + ')' : '');

  return (
    <ImageBackground
      source={require('../assets/images/home_floral_bg.png')}
      style={styles.safe}
      resizeMode="cover"
    >
        <SafeAreaView style={styles.safeInner} edges={['top', 'left', 'right', 'bottom']}>
          <StatusBar backgroundColor="#E8EEFB" barStyle="dark-content" />
          <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[styles.page, Platform.OS === 'web' && styles.webPage]}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          if (width !== pageSize.width || height !== pageSize.height) setPageSize({ width, height });
        }}
      >
        <View style={[styles.header, { height: headerHeight, marginBottom: verticalGap }]}>
          <Image
            source={require('../assets/images/icon.png')}
            style={[styles.logo, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize * 0.29 }]}
          />
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={[styles.headerTitle, { fontSize: Math.min(22, headerHeight * 0.35) }]}>My Dream Women</Text>
            <View style={styles.headerMeta}>
              <Text numberOfLines={1} style={styles.headerSubtitle}>your dream companion</Text>
              <Text numberOfLines={1} style={styles.headerVersion}>{versionLabel}</Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={[styles.settingsButton, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize / 2 }]}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={Math.min(26, headerIconSize * 0.46)} color="#18204E" />
          </TouchableOpacity>
        </View>

        <View style={[styles.hero, { height: heroHeight, marginBottom: verticalGap }]}>
          <ImageBackground
            source={heroImageUrl ? { uri: heroImageUrl } : require('../assets/images/splash.png')}
            resizeMode="cover"
            style={styles.heroImage}
            imageStyle={[
              styles.heroImageStyle,
              !heroImageUrl && { left: 0, right: undefined, width: '61%' },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Double tap to change the hero background"
              onPress={handleHeroSurfaceTap}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={['rgba(3, 7, 25, 0.02)', 'rgba(3, 7, 25, 0.10)', 'rgba(3, 7, 25, 0.30)']}
              start={{ x: 0.1, y: 0.05 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={[styles.heroStatusRow, { top: compact ? 8 : 12, right: compact ? 8 : 12, gap: compact ? 6 : 8 }]}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={toggleOnline}
                activeOpacity={0.82}
                style={[
                  styles.statusButton,
                  { minHeight: compact ? 34 : 42, paddingHorizontal: compact ? 9 : 13 },
                  isOnline ? styles.onlineButton : styles.offlineButton,
                ]}
              >
                <View style={[styles.statusDot, { width: compact ? 8 : 10, height: compact ? 8 : 10, backgroundColor: isOnline ? '#35E5B2' : '#F59E0B' }]} />
                <Text style={[styles.statusText, { fontSize: compact ? 12 : 14 }]}>{isOnline ? 'Online' : 'Offline'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={wakeRenderServer}
                disabled={wakingServer}
                activeOpacity={0.82}
                style={[styles.wakeButton, { minWidth: compact ? 62 : 76, height: compact ? 34 : 42, paddingHorizontal: compact ? 9 : 13 }]}
              >
                {wakingServer
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={[styles.statusText, { fontSize: compact ? 12 : 14 }]}>{serverStatus === 'ok' ? 'Server' : 'Wake'}</Text>}
              </TouchableOpacity>
            </View>

            <View style={[styles.heroCopy, { top: compact ? 44 : 62, right: compact ? 10 : 14, bottom: compact ? 10 : 18, width: '43%' }]}>
              <View style={styles.heroTextGroup}>
                <Text style={[styles.heroTitle, { fontSize: compact ? 23 : Math.min(33, pageHeight * 0.039), lineHeight: compact ? 27 : Math.min(38, pageHeight * 0.045) }]}>Your Dream.</Text>
                <Text style={[styles.heroTitleCyan, { fontSize: compact ? 22 : Math.min(32, pageHeight * 0.038), lineHeight: compact ? 26 : Math.min(37, pageHeight * 0.044) }]}>Our Creation.</Text>
                <Text style={[styles.heroEyebrow, { fontSize: compact ? 8 : 10, marginTop: compact ? 6 : 10 }]}>CREATE  ·  CHAT  ·  EXPLORE</Text>
                <Text style={[styles.heroSubtitle, { fontSize: compact ? 10 : 13, marginTop: compact ? 4 : 7, marginBottom: compact ? 8 : 12 }]}>Your Perfect AI partner</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.push('/ai-girls')}
                activeOpacity={0.86}
              >
                <LinearGradient
                  colors={['#E52EFF', '#8A46FF', '#348CFF']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.startChatButton, { minHeight: compact ? 42 : 54, paddingHorizontal: compact ? 10 : 16, gap: compact ? 6 : 9 }]}
                >
                  <Ionicons name="chatbox-ellipses" size={compact ? 17 : 21} color="#FFFFFF" />
                  <Text style={[styles.startChatText, { fontSize: compact ? 12 : 16 }]}>Start Chat</Text>
                  <Ionicons name="arrow-forward" size={compact ? 16 : 20} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Change hero background"
              style={[styles.changeBackgroundButton, { left: compact ? 8 : 12, bottom: compact ? 8 : 12 }]}
              onPress={chooseHeroBackground}
              disabled={coverUploading}
            >
              {coverUploading
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Ionicons name="image-outline" size={compact ? 14 : 16} color="#FFFFFF" />}
              <Text style={[styles.changeBackgroundText, { fontSize: compact ? 9 : 10 }]}>
                {coverUploading ? 'Saving image…' : 'Change background'}
              </Text>
            </TouchableOpacity>
          </ImageBackground>
        </View>

        <View style={[styles.featureGrid, { rowGap: gridRowGap }]}>
          {FEATURES.map(feature => (
            <TouchableOpacity
              key={feature.title}
              accessibilityRole="button"
              accessibilityLabel={feature.title + ', ' + feature.subtitle}
              accessibilityState={{ disabled: !feature.route }}
              activeOpacity={0.84}
              disabled={!feature.route}
              style={[styles.featureCard, { width: tileWidth, height: cardHeight }]}
              onPress={feature.route ? () => {
                if (feature.launchIntent) {
                  router.push({ pathname: '/ai-girls', params: { launch: feature.launchIntent } });
                  return;
                }
                router.push(feature.route as any);
              } : undefined}
            >
              <Image
                source={feature.bgImage}
                style={styles.cardImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  </ImageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', maxWidth: 840, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, justifyContent: 'space-between' },
  webPage: { paddingTop: 67, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 62, height: 62, borderRadius: 18, borderWidth: 1.5, borderColor: '#D64DFF' },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: '#18204E', fontSize: 22, fontWeight: '800' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, minWidth: 0 },
  headerSubtitle: { color: '#4B5573', fontSize: 10, flexShrink: 1 },
  headerVersion: { color: '#4B5573', fontSize: 10, flexShrink: 0 },
  settingsButton: { width: 54, height: 54, borderRadius: 28, borderWidth: 1.5, borderColor: '#A5B4D6', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.88)' },
  hero: { width: '100%', borderRadius: 24, borderWidth: 1.5, borderColor: '#35DFFF', overflow: 'hidden', backgroundColor: '#10172F', shadowColor: '#16CFFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  heroImage: { width: '100%', height: '100%' },
  heroImageStyle: { borderRadius: 22 },
  heroStatusRow: { position: 'absolute', top: 14, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusButton: { minHeight: 42, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: 'rgba(5, 13, 35, 0.72)' },
  onlineButton: { borderColor: '#35E5B2' },
  offlineButton: { borderColor: '#F59E0B' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  wakeButton: { minWidth: 76, height: 42, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1.5, borderColor: '#63B6FF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5, 13, 35, 0.72)' },
  statusText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  heroCopy: { position: 'absolute', top: 76, right: 14, bottom: 18, width: '61%', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroTextGroup: { alignItems: 'flex-end' },
  heroTitle: { color: '#FFF1FF', fontFamily: 'DreamScript', fontSize: 33, lineHeight: 38, textAlign: 'right', textShadowColor: '#F55CFF', textShadowRadius: 9 },
  heroTitleCyan: { color: '#8AF4FF', fontFamily: 'DreamScript', fontSize: 32, lineHeight: 37, textAlign: 'right', textShadowColor: '#2EDCFF', textShadowRadius: 10 },
  heroEyebrow: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.35, marginTop: 10, textAlign: 'right' },
  heroSubtitle: { color: '#E1E7F7', fontSize: 13, marginTop: 7, marginBottom: 12, textAlign: 'right' },
  startChatButton: { minHeight: 54, borderRadius: 29, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, shadowColor: '#C832FF', shadowOpacity: 0.55, shadowRadius: 12, elevation: 6 },
  startChatText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  changeBackgroundButton: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(2,8,24,0.72)' },
  changeBackgroundText: { color: '#FFFFFF', fontWeight: '700' },
  safe: { flex: 1, backgroundColor: '#E8EEFB' },
  safeInner: { flex: 1 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  featureCard: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
});
