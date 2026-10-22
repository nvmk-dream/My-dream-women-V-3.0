import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  ImageBackground,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width: screenWidth } = Dimensions.get('window');
const HERO_HEIGHT = Math.min(Math.round((screenWidth - 32) * 1.15), 460);
const TILE_WIDTH = (screenWidth - 32 - 24) / 3;

type ServerStatus = 'unknown' | 'ok' | 'sleeping';

type Feature = {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  route: string;
};

const FEATURES: Feature[] = [
  { title: 'Text to Image', subtitle: 'Create Images', icon: 'image-outline', color: '#E64BFF', route: '/prompt-image' },
  { title: 'AI Characters', subtitle: 'Meet AI Girls', icon: 'person-outline', color: '#42D9FF', route: '/ai-girls' },
  { title: 'Group Chat', subtitle: 'Chat Together', icon: 'people-outline', color: '#38E6A1', route: '/ai-girls' },
  { title: 'Image to Script', subtitle: 'Photo Stories', icon: 'document-text-outline', color: '#F5D845', route: '/ai-girls' },
  { title: 'Face Swap', subtitle: 'Cloud', icon: 'swap-horizontal-outline', color: '#E64BFF', route: '/face-swap' },
  { title: 'Cloud', subtitle: 'Your Gallery', icon: 'cloud-outline', color: '#42CFFF', route: '/home' },
];

export default function LaunchHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('unknown');
  const [wakingServer, setWakingServer] = useState(false);

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
  const subtitle = 'your dream companion  ·  V' + version + (versionCode ? ' (' + versionCode + ')' : '');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar backgroundColor="#070A1B" barStyle="light-content" />
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}
      >
        <View style={styles.header}>
          <Image source={require('../assets/images/icon.png')} style={styles.logo} />
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.headerTitle}>My Dream Women</Text>
            <Text numberOfLines={1} style={styles.headerSubtitle}>{subtitle}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={styles.settingsButton}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={26} color="#F4F7FF" />
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <ImageBackground
            source={require('../assets/images/splash.png')}
            resizeMode="cover"
            style={styles.heroImage}
            imageStyle={styles.heroImageStyle}
          >
            <LinearGradient
              colors={['rgba(3, 7, 25, 0.02)', 'rgba(3, 7, 25, 0.22)', 'rgba(3, 7, 25, 0.82)']}
              start={{ x: 0.1, y: 0.05 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroStatusRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={toggleOnline}
                activeOpacity={0.82}
                style={[styles.statusButton, isOnline ? styles.onlineButton : styles.offlineButton]}
              >
                <View style={[styles.statusDot, { backgroundColor: isOnline ? '#35E5B2' : '#F59E0B' }]} />
                <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={wakeRenderServer}
                disabled={wakingServer}
                activeOpacity={0.82}
                style={styles.wakeButton}
              >
                {wakingServer
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.statusText}>{serverStatus === 'ok' ? 'Server' : 'Wake'}</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Your Dream.</Text>
              <Text style={styles.heroTitleCyan}>Our Creation.</Text>
              <Text style={styles.heroEyebrow}>CREATE  ·  CHAT  ·  EXPLORE</Text>
              <Text style={styles.heroSubtitle}>Your Perfect AI partner</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.push('/ai-girls')}
                activeOpacity={0.86}
              >
                <LinearGradient
                  colors={['#E52EFF', '#8A46FF', '#348CFF']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.startChatButton}
                >
                  <Ionicons name="chatbox-ellipses" size={21} color="#FFFFFF" />
                  <Text style={styles.startChatText}>Start Chat</Text>
                  <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.featureGrid}>
          {FEATURES.map(feature => (
            <TouchableOpacity
              key={feature.title}
              accessibilityRole="button"
              accessibilityLabel={feature.title + ', ' + feature.subtitle}
              activeOpacity={0.82}
              style={[styles.featureCard, { borderColor: feature.color, shadowColor: feature.color }]}
              onPress={() => router.push(feature.route as any)}
            >
              <View style={[styles.featureIconRing, { borderColor: feature.color, shadowColor: feature.color }]}>
                <Ionicons name={feature.icon as any} size={31} color={feature.color} />
              </View>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureSubtitle}>{feature.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070A1B' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  logo: { width: 62, height: 62, borderRadius: 18, borderWidth: 1.5, borderColor: '#D64DFF' },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: '#F7F8FF', fontSize: 22, fontWeight: '800' },
  headerSubtitle: { color: '#ABB6D2', fontSize: 12, marginTop: 3 },
  settingsButton: { width: 54, height: 54, borderRadius: 28, borderWidth: 1.5, borderColor: '#54617E', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(16, 23, 48, 0.78)' },
  hero: { height: HERO_HEIGHT, borderRadius: 24, borderWidth: 1.5, borderColor: '#35DFFF', overflow: 'hidden', backgroundColor: '#10172F', marginBottom: 20, shadowColor: '#16CFFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  heroImage: { width: '100%', height: '100%' },
  heroImageStyle: { borderRadius: 22 },
  heroStatusRow: { position: 'absolute', top: 14, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusButton: { minHeight: 42, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: 'rgba(5, 13, 35, 0.72)' },
  onlineButton: { borderColor: '#35E5B2' },
  offlineButton: { borderColor: '#F59E0B' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  wakeButton: { minWidth: 76, height: 42, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1.5, borderColor: '#63B6FF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5, 13, 35, 0.72)' },
  statusText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  heroCopy: { position: 'absolute', right: 14, bottom: 18, width: '61%', alignItems: 'flex-end' },
  heroTitle: { color: '#FFF1FF', fontFamily: 'DreamScript', fontSize: 33, lineHeight: 38, textAlign: 'right', textShadowColor: '#F55CFF', textShadowRadius: 9 },
  heroTitleCyan: { color: '#8AF4FF', fontFamily: 'DreamScript', fontSize: 32, lineHeight: 37, textAlign: 'right', textShadowColor: '#2EDCFF', textShadowRadius: 10 },
  heroEyebrow: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.35, marginTop: 10, textAlign: 'right' },
  heroSubtitle: { color: '#E1E7F7', fontSize: 13, marginTop: 7, marginBottom: 12, textAlign: 'right' },
  startChatButton: { minHeight: 54, borderRadius: 29, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, shadowColor: '#C832FF', shadowOpacity: 0.55, shadowRadius: 12, elevation: 6 },
  startChatText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  featureCard: { width: TILE_WIDTH, minHeight: 176, borderRadius: 22, borderWidth: 1.4, backgroundColor: 'rgba(9, 15, 36, 0.96)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, paddingVertical: 12, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 9, elevation: 3 },
  featureIconRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center', marginBottom: 10, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.32, shadowRadius: 10 },
  featureTitle: { color: '#F6F7FF', fontSize: 14, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  featureSubtitle: { color: '#B5BED5', fontSize: 11, lineHeight: 15, marginTop: 3, textAlign: 'center' },
});
