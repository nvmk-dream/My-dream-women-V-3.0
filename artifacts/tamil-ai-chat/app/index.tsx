import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const HERO_IMAGE = require('../assets/images/neon-home-hero.jpg');
const APP_ICON = require('../assets/images/icon.png');
const ONLINE_KEY = 'chat_is_online';
const SERVER_URL_KEY = 'custom_server_url';
const DEFAULT_SERVER_URL = 'https://my-dream-women-v-3-0.onrender.com';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type Feature = {
  title: string;
  subtitle: string;
  icon: IconName;
  color: string;
  route?: string;
  disabled?: boolean;
};

const FEATURES: Feature[] = [
  { title: 'Text to Image', subtitle: 'Create Images', icon: 'image', color: '#e347f3', route: '/prompt-image' },
  { title: 'AI Characters', subtitle: 'Coming later', icon: 'account-outline', color: '#176177', disabled: true },
  { title: 'Group Chat', subtitle: 'Chat Together', icon: 'account-group', color: '#2ce99a', route: '/ai-girls?launch=group' },
  { title: 'Image to Script', subtitle: 'Create Prompts', icon: 'file-image-outline', color: '#f4cb45', route: '/ai-girls?launch=script' },
  { title: 'Face Swap', subtitle: 'Cloud', icon: 'swap-horizontal', color: '#df3ff0', route: '/face-swap' },
  { title: 'Cloud', subtitle: 'Your Gallery', icon: 'cloud-outline', color: '#35c8ee', route: '/home' },
];

function getVersionLabel() {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '—';
  const build = Constants.nativeBuildVersion
    ?? (Constants.expoConfig?.android?.versionCode != null
      ? String(Constants.expoConfig.android.versionCode)
      : Constants.expoConfig?.ios?.buildNumber);
  return `V${version}${build ? ` (${build})` : ''}`;
}

export default function Index() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [isOnline, setIsOnline] = useState(true);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'ready' | 'sleeping'>('unknown');
  const [waking, setWaking] = useState(false);

  const readOnlineStatus = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(ONLINE_KEY);
      if (stored !== null) setIsOnline(stored === 'true');
    } catch {
      // Keep the last known state if local storage is temporarily unavailable.
    }
  }, []);

  const toggleOnline = useCallback(async () => {
    const next = !isOnline;
    setIsOnline(next);
    try {
      await AsyncStorage.setItem(ONLINE_KEY, String(next));
    } catch {
      setIsOnline(!next);
    }
  }, [isOnline]);

  const checkServer = useCallback(async (wake = false) => {
    if (wake) setWaking(true);
    try {
      const savedUrl = await AsyncStorage.getItem(SERVER_URL_KEY).catch(() => null);
      const serverUrl = (savedUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), wake ? 30000 : 8000);
      try {
        const response = await fetch(`${serverUrl}/api/healthz`, { signal: controller.signal });
        setServerStatus(response.ok ? 'ready' : 'sleeping');
      } finally {
        clearTimeout(timer);
      }
    } catch {
      setServerStatus('sleeping');
    } finally {
      if (wake) setWaking(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      readOnlineStatus();
      checkServer();
    }, [checkServer, readOnlineStatus]),
  );

  const heroHeight = Math.max(278, Math.min(width * 0.94, height * 0.49));
  const horizontalPadding = width < 360 ? 16 : 20;
  const tileGap = width < 360 ? 9 : 12;
  const tileWidth = (width - horizontalPadding * 2 - tileGap * 2) / 3;
  const titleSize = width < 360 ? 18 : 22;
  const heroTitleSize = width < 360 ? 20 : 25;
  const versionLabel = getVersionLabel();

  const readyLabel = waking ? 'Waking…' : serverStatus === 'sleeping' ? 'Wake' : 'Ready';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      <View style={[s.header, { paddingHorizontal: horizontalPadding }]}>
        <Image source={APP_ICON} style={[s.appIcon, { width: width < 360 ? 48 : 56, height: width < 360 ? 48 : 56 }]} />
        <View style={s.brandCopy}>
          <Text style={[s.brandTitle, { fontSize: titleSize }]} numberOfLines={1}>
            My Dream Woman <Text style={s.brandAccent}>Pro</Text>
          </Text>
          <Text style={s.brandSub} numberOfLines={1}>your dream companion · {versionLabel}</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Settings"
          testID="home-settings"
          activeOpacity={0.78}
          style={s.settingsButton}
          onPress={() => router.push('/ai-girls?launch=settings' as any)}
        >
          <MaterialCommunityIcons name="cog-outline" size={28} color="#f4f6ff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingHorizontal: horizontalPadding }]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        <View style={[s.hero, { height: heroHeight }]}>
          <ImageBackground source={HERO_IMAGE} resizeMode="cover" style={s.heroImage} />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(5,9,29,0)', 'rgba(5,9,29,0.18)', 'rgba(5,9,29,0.97)', '#05091d']}
            locations={[0, 0.43, 0.7, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={s.heroFade}
          />
          <View style={s.heroShade} pointerEvents="none" />

          <View style={s.statusRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isOnline ? 'Turn Online mode off' : 'Turn Online mode on'}
              accessibilityState={{ selected: isOnline }}
              testID="home-online-toggle"
              activeOpacity={0.78}
              onPress={toggleOnline}
              style={[s.onlinePill, !isOnline && s.offlinePill]}
            >
              <View style={[s.onlineDot, !isOnline && s.offlineDot]} />
              <Text style={[s.onlineText, !isOnline && s.offlineText]}>{isOnline ? 'Online' : 'Offline'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={waking ? 'Waking server' : `Server ${readyLabel}`}
              testID="home-server-ready"
              activeOpacity={0.76}
              disabled={waking}
              onPress={() => checkServer(true)}
              style={s.readyButton}
            >
              {waking
                ? <ActivityIndicator size="small" color="#f4f6ff" />
                : <Text style={s.readyText}>{readyLabel}</Text>}
            </TouchableOpacity>
          </View>

          <View style={s.heroCopy}>
            <Text style={[s.heroHeadline, { fontSize: heroTitleSize }]}>
              Your Dream.{'\n'}
              <Text style={s.heroHeadlineAccent}>Our Creation.</Text>
            </Text>
            <Text style={s.heroEyebrow}>CREATE  ·  CHAT  ·  EXPLORE</Text>
            <Text style={s.heroSub}>Your Perfect AI partner</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Start Chat"
              testID="home-start-chat"
              activeOpacity={0.82}
              style={s.startChatOuter}
              onPress={() => router.push('/ai-girls' as any)}
            >
              <LinearGradient
                colors={['#dc2be8', '#9a2cf5', '#2588f9']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.startChat}
              >
                <MaterialCommunityIcons name="message-text" size={19} color="#fff" />
                <Text numberOfLines={1} style={s.startChatLabel}>Start Chat</Text>
                <MaterialCommunityIcons name="arrow-right" size={21} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[s.grid, { columnGap: tileGap, rowGap: tileGap + 2 }]}>
          {FEATURES.map((feature) => (
            <FeatureTile
              key={feature.title}
              feature={feature}
              width={tileWidth}
              onPress={feature.route ? () => router.push(feature.route as any) : undefined}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureTile({
  feature,
  width,
  onPress,
}: {
  feature: Feature;
  width: number;
  onPress?: () => void;
}) {
  const tileContent = (
    <>
      <View style={[s.iconRing, { borderColor: feature.color, shadowColor: feature.color }]}>
        <MaterialCommunityIcons
          name={feature.icon}
          size={30}
          color={feature.disabled ? '#246177' : feature.color}
        />
      </View>
      <Text
        style={[s.tileTitle, feature.disabled && s.disabledTitle]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {feature.title}
      </Text>
      <Text style={[s.tileSubtitle, feature.disabled && s.disabledSubtitle]} numberOfLines={1}>
        {feature.subtitle}
      </Text>
    </>
  );

  if (feature.disabled) {
    return (
      <View
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={`${feature.title}, ${feature.subtitle}`}
        testID="home-ai-characters-disabled"
        style={[s.tile, s.disabledTile, { width }]}
      >
        {tileContent}
      </View>
    );
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${feature.title}, ${feature.subtitle}`}
      testID={`home-feature-${feature.title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      activeOpacity={0.78}
      onPress={onPress}
      style={[
        s.tile,
        { width, borderColor: feature.color, shadowColor: feature.color },
      ]}
    >
      {tileContent}
    </TouchableOpacity>
  );
}

const COLORS = {
  background: '#05091d',
  panel: '#080e25',
  text: '#f5f5ff',
  muted: '#aebbd6',
};

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 7,
    paddingBottom: 9,
    gap: 11,
  },
  appIcon: {
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(235,80,246,0.72)',
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    color: COLORS.text,
    fontWeight: '800',
    letterSpacing: -0.45,
  },
  brandAccent: {
    color: '#df47ee',
  },
  brandSub: {
    color: '#b8c3de',
    fontSize: 12,
    marginTop: 3,
    letterSpacing: 0.1,
  },
  settingsButton: {
    width: 48,
    height: 48,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(160,177,217,0.35)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 18,
  },
  hero: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: COLORS.panel,
    borderWidth: 1.5,
    borderColor: '#36d9fb',
    shadowColor: '#1ccdf9',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 18,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '63%',
  },
  heroFade: {
    ...StyleSheet.absoluteFillObject,
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,7,22,0.08)',
  },
  statusRow: {
    position: 'absolute',
    top: 14,
    right: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 2,
  },
  onlinePill: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#29eab5',
    backgroundColor: 'rgba(4,32,42,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  offlinePill: {
    borderColor: '#df6479',
    backgroundColor: 'rgba(48,18,38,0.94)',
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#29eab5',
  },
  offlineDot: {
    backgroundColor: '#f1798c',
  },
  onlineText: {
    color: '#e9fff9',
    fontSize: 13,
    fontWeight: '800',
  },
  offlineText: {
    color: '#ffe5eb',
  },
  readyButton: {
    minWidth: 68,
    height: 39,
    paddingHorizontal: 13,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#5ea7ff',
    backgroundColor: 'rgba(10,25,54,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyText: {
    color: '#ecf3ff',
    fontSize: 13,
    fontWeight: '800',
  },
  heroCopy: {
    position: 'absolute',
    right: 13,
    bottom: 17,
    width: '49%',
    alignItems: 'flex-end',
  },
  heroHeadline: {
    color: '#fff2ff',
    textAlign: 'right',
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 1.12 * 25,
    textShadowColor: 'rgba(239,73,242,0.62)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  heroHeadlineAccent: {
    color: '#67e7ff',
    fontStyle: 'italic',
    textShadowColor: 'rgba(41,210,255,0.7)',
    textShadowRadius: 9,
  },
  heroEyebrow: {
    color: '#f1edff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.85,
    marginTop: 14,
    textAlign: 'right',
  },
  heroSub: {
    color: '#bdc8e1',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
  startChatOuter: {
    width: '100%',
    marginTop: 15,
    borderRadius: 28,
    shadowColor: '#c542f2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 4,
  },
  startChat: {
    minHeight: 53,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    gap: 7,
  },
  startChatLabel: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  tile: {
    minHeight: 158,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: 'rgba(7,12,31,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingTop: 13,
    paddingBottom: 12,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 2,
  },
  iconRing: {
    width: 69,
    height: 69,
    borderWidth: 1.5,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(6,13,34,0.96)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  tileTitle: {
    color: '#f5f5ff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 17,
    minHeight: 17,
  },
  tileSubtitle: {
    color: '#b7c6e2',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 3,
  },
  disabledTile: {
    borderColor: '#176177',
    backgroundColor: 'rgba(5,17,35,0.92)',
    shadowOpacity: 0,
  },
  disabledTitle: {
    color: '#8092aa',
  },
  disabledSubtitle: {
    color: '#73839c',
  },
});
