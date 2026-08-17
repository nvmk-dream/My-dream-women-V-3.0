import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  StatusBar, Dimensions, ScrollView, Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as Notifications from "expo-notifications";
import { requestPhotoVideoPermissionsAsync } from "@/services/media-permissions";

SplashScreen.preventAutoHideAsync();

// ── Global JS crash logger ─────────────────────────────────────
const CRASH_KEY = 'startup_crash_log';

function saveCrash(error: Error | string, isFatal: boolean) {
  try {
    const msg = typeof error === 'string' ? error : `${error?.message ?? error}\n\n${error?.stack ?? ''}`;
    const entry = `[${new Date().toISOString()}] fatal=${isFatal}\n${msg}`;
    AsyncStorage.setItem(CRASH_KEY, entry).catch(() => {});
  } catch {}
}

// Catch uncaught JS exceptions (works in production APK)
const _prevHandler = (global as any).ErrorUtils?.getGlobalHandler?.();
(global as any).ErrorUtils?.setGlobalHandler?.((error: Error, isFatal: boolean) => {
  saveCrash(error, isFatal);
  if (_prevHandler) _prevHandler(error, isFatal);
});

// Catch unhandled Promise rejections
const _origHandler = (global as any).__handleError;
if (typeof (global as any).HermesInternal !== 'undefined') {
  (global as any).__rejectionTrackingOptions = { allRejections: true };
}

// Suppress WebGPU internal errors — web-only (addEventListener doesn't exist in React Native)
if (typeof window !== 'undefined' && typeof (window as any).addEventListener === 'function') {
  const GPU_ERR = ['popErrorScope', 'Instance dropped', 'external Instance', 'GPUDevice', 'GPUBuffer', 'WebGPU'];
  const isGpuErr = (msg: string) => GPU_ERR.some(k => msg.includes(k));
  (window as any).addEventListener('error', (e: any) => {
    if (isGpuErr(e.message ?? '')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  (window as any).addEventListener('unhandledrejection', (e: any) => {
    const msg = String(e.reason?.message ?? e.reason ?? '');
    if (isGpuErr(msg)) { e.preventDefault(); }
  });
}

const { width } = Dimensions.get("window");
const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

// Permission onboarding — one-time on first install
const PERMISSIONS_ONBOARDED_KEY = 'permissions_onboarded_v2';
type OnboardStep = 'intro' | 'requesting';

const AUTO_GREETINGS = [
  'என்ன பண்ற? miss ஆகுது 😊',
  'நீ வருவியா? 🥺',
  'ஏன் chat பண்ணல? 💕',
  'Hello?? 👋 நான் இங்க இருக்கேன்!',
  'என்னங்க, மறந்துட்டீங்களா? 😅',
  'உன்னோட voice கேக்கணும் 🥹',
];

export { AUTO_GREETINGS };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [pinLocked, setPinLocked] = useState(false);
  const [savedPin, setSavedPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [launchSplashVisible, setLaunchSplashVisible] = useState(true);

  // ── Permission onboarding (one-time, Meta AI style) ──────────
  // null = still checking AsyncStorage; undefined = done (no overlay)
  const [onboardStep, setOnboardStep] = useState<OnboardStep | null | undefined>(undefined);

  // Check on mount whether onboarding is needed
  useEffect(() => {
    if (Platform.OS !== 'android') { setOnboardStep(undefined); return; }
    AsyncStorage.getItem(PERMISSIONS_ONBOARDED_KEY)
      .then(val => {
        if (val === 'true') { setOnboardStep(undefined); return; }
        setOnboardStep('intro');
      })
      .catch(() => setOnboardStep(undefined));
  }, []);

  // "Next" tapped on intro screen — request permissions sequentially
  const handleStartPermissions = useCallback(async () => {
    setOnboardStep('requesting');

    // Step 1: Notifications (system dialog)
    try { await Notifications.requestPermissionsAsync(); } catch {}

    // Step 2: Photos & Videos (system dialog)
    try { await requestPhotoVideoPermissionsAsync(); } catch {}

    // All done
    await AsyncStorage.setItem(PERMISSIONS_ONBOARDED_KEY, 'true').catch(() => {});
    setOnboardStep(undefined);
  }, []);

  // ── Crash log state ──────────────────────────────────────────
  const [crashLog, setCrashLog] = useState<string | null>(null);
  const [crashChecked, setCrashChecked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CRASH_KEY).then(log => {
      if (log) setCrashLog(log);
      setCrashChecked(true);
    }).catch(() => setCrashChecked(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('app_pin').then(pin => {
      if (pin) {
        setSavedPin(pin);
        setPinLocked(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
      const timer = setTimeout(() => setLaunchSplashVisible(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  if (launchSplashVisible) {
    return (
      <View style={launchSplash.container}>
        <StatusBar hidden />
        <Image
          source={require("../assets/images/splash.png")}
          style={launchSplash.image}
          resizeMode="cover"
        />
      </View>
    );
  }

  // ── Show crash log screen if a crash was saved ────────────────
  if (crashChecked && crashLog) {
    return (
      <View style={crash.bg}>
        <StatusBar backgroundColor="#1a0000" barStyle="light-content" />
        <View style={crash.header}>
          <Text style={crash.title}>💥 App Crash Log</Text>
          <Text style={crash.sub}>இந்த error-ஐ screenshot எடுத்து share பண்ணுங்க</Text>
        </View>
        <ScrollView style={crash.scroll} contentContainerStyle={crash.scrollContent}>
          <Text selectable style={crash.log}>{crashLog}</Text>
        </ScrollView>
        <View style={crash.btnRow}>
          <TouchableOpacity style={crash.clearBtn} onPress={() => {
            AsyncStorage.removeItem(CRASH_KEY).catch(() => {});
            setCrashLog(null);
          }}>
            <Text style={crash.clearTxt}>🗑 Clear &amp; Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handlePinKey = (key: string) => {
    if (key === '⌫') {
      setPinInput(p => p.slice(0, -1));
      setPinError('');
      return;
    }
    if (pinInput.length >= 4) return;
    const next = pinInput + key;
    setPinInput(next);
    if (next.length === 4) {
      if (next === savedPin) {
        setPinLocked(false);
        setPinInput('');
        setPinError('');
      } else {
        setPinError('தவறான PIN! மீண்டும் try பண்ணு');
        setTimeout(() => setPinInput(''), 400);
      }
    }
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#075E54' },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: 'bold' },
              animation: 'none',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="home" options={{ headerShown: false }} />
            <Stack.Screen name="ai-girls" options={{ headerShown: false }} />
            <Stack.Screen name="keys" options={{ headerShown: false }} />
            <Stack.Screen name="notes" options={{ headerShown: false }} />
            <Stack.Screen name="gallery" options={{ headerShown: false }} />
            <Stack.Screen name="chat" options={{ title: 'Chat' }} />
            <Stack.Screen name="group-chat" options={{ title: 'Group Chat' }} />
            <Stack.Screen name="face-swap" options={{ title: 'Face Swap' }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="edit-character" options={{ title: 'Edit Character' }} />
            <Stack.Screen name="cloud-storage" options={{ headerShown: false }} />
            <Stack.Screen name="ai-girls-cloud" options={{ headerShown: false }} />
            <Stack.Screen name="offline-chat" options={{ title: 'Offline AI' }} />
            <Stack.Screen name="prompt-image" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>

          {/* ── Permission onboarding overlay (one-time, first install) ── */}

          {/* Step 1: Intro — explain all permissions */}
          {onboardStep === 'intro' && (
            <View style={ob.overlay}>
              <StatusBar backgroundColor="#000" barStyle="light-content" />
              <Text style={ob.appName}>My Dream Women ☁️</Text>
              <Text style={ob.heading}>Permissions தேவை</Text>
              <Text style={ob.subheading}>இந்த app சரியாக வேலை செய்ய கீழே உள்ள permissions தேவை. ஒரு முறை மட்டும் கேட்கும்.</Text>

              <View style={ob.card}>
                <View style={ob.row}>
                  <Text style={ob.rowIcon}>🔔</Text>
                  <View style={ob.rowText}>
                    <Text style={ob.rowTitle}>Notifications</Text>
                    <Text style={ob.rowDesc}>Auto-messages & updates receive பண்ண</Text>
                  </View>
                </View>
                <View style={ob.divider} />
                <View style={ob.row}>
                  <Text style={ob.rowIcon}>🖼️</Text>
                  <View style={ob.rowText}>
                    <Text style={ob.rowTitle}>Photos & Videos</Text>
                    <Text style={ob.rowDesc}>Gallery-ல் upload & save பண்ண</Text>
                  </View>
                </View>
                <View style={ob.noteBox}>
                  <Text style={ob.noteText}>⚙️ Settings-ல் permissions-ஐ எந்த நேரத்திலும் மாற்றலாம்</Text>
                </View>
              </View>

              <TouchableOpacity style={ob.nextBtn} onPress={handleStartPermissions} activeOpacity={0.85}>
                <Text style={ob.nextBtnTxt}>Next →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Requesting — system dialogs are showing, show minimal UI */}
          {onboardStep === 'requesting' && (
            <View style={ob.overlay}>
              <StatusBar backgroundColor="#000" barStyle="light-content" />
              <Text style={ob.appName}>My Dream Women ☁️</Text>
              <View style={ob.card}>
                <Text style={ob.requestingIcon}>⏳</Text>
                <Text style={ob.requestingText}>Permissions கேட்கிறோம்...</Text>
                <Text style={ob.requestingDesc}>System dialogs-ல் Allow பண்ணுங்க</Text>
              </View>
            </View>
          )}

          {/* ── 4-Digit PIN Lock Overlay ── */}
          {pinLocked && (
            <View style={pin.overlay}>
              <StatusBar backgroundColor="#000" barStyle="light-content" />
              <Text style={pin.appName}>My Dream Women ☁️</Text>
              <Text style={pin.heading}>🔒 PIN Enter பண்ணுங்க</Text>

              {/* 4 dots */}
              <View style={pin.dots}>
                {[0,1,2,3].map(i => (
                  <View key={i} style={[pin.dot, pinInput.length > i && pin.dotFilled]} />
                ))}
              </View>

              {pinError
                ? <Text style={pin.errorTxt}>{pinError}</Text>
                : <Text style={pin.hintTxt}>உங்க 4-digit PIN பயன்படுத்துங்க</Text>
              }

              {/* Numpad */}
              <View style={pin.numpad}>
                {KEYS.map((k, i) => (
                  k === ''
                    ? <View key={i} style={pin.key} />
                    : <TouchableOpacity key={i} style={[pin.key, pin.keyActive]}
                        onPress={() => handlePinKey(k)} activeOpacity={0.6}>
                        <Text style={k === '⌫' ? pin.keyDel : pin.keyTxt}>{k}</Text>
                      </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const KEY_W = (width - 48 - 24) / 3;

const launchSplash = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

const crash = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#1a0000' },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#3a0000' },
  title: { color: '#FF5252', fontSize: 22, fontWeight: 'bold', marginBottom: 6 },
  sub: { color: '#ff8a80', fontSize: 13 },
  scroll: { flex: 1, margin: 12 },
  scrollContent: { paddingBottom: 12 },
  log: { color: '#ffcdd2', fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
  btnRow: { padding: 16, paddingBottom: 32 },
  clearBtn: { backgroundColor: '#b71c1c', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  clearTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

// Permission onboarding styles
const ob = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    zIndex: 9998,
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  appName: {
    color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 8,
    textShadowColor: '#E91E8C', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 },
  },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subheading: { color: '#6b7280', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  card: {
    backgroundColor: '#141414', borderRadius: 20, padding: 20,
    width: '100%', borderWidth: 1, borderColor: '#1f2937', marginBottom: 24,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowIcon: { fontSize: 28, marginRight: 14 },
  rowText: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  rowDesc: { color: '#6b7280', fontSize: 12, lineHeight: 17 },
  divider: { height: 1, backgroundColor: '#1f2937', marginVertical: 2 },
  noteBox: { marginTop: 14, backgroundColor: '#1f2937', borderRadius: 10, padding: 10 },
  noteText: { color: '#4b5563', fontSize: 12, textAlign: 'center' },
  nextBtn: {
    backgroundColor: '#25D366', borderRadius: 16, paddingVertical: 16,
    width: '100%', alignItems: 'center',
  },
  nextBtnTxt: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  // Requesting step
  requestingIcon: { fontSize: 40, textAlign: 'center', marginBottom: 12 },
  requestingText: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  requestingDesc: { color: '#6b7280', fontSize: 13, textAlign: 'center' },
});

const pin = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    zIndex: 9999,
    alignItems: 'center',
    paddingTop: 80,
  },
  appName: {
    color: '#fff', fontSize: 28, fontWeight: 'bold',
    marginBottom: 40,
    textShadowColor: '#E91E8C', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 },
  },
  heading: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 32 },
  dots: { flexDirection: 'row', gap: 20, marginBottom: 18 },
  dot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#555', backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#25D366', borderColor: '#25D366' },
  errorTxt: { color: '#EF5350', fontSize: 14, fontWeight: '600', marginBottom: 24, height: 24 },
  hintTxt: { color: '#555', fontSize: 13, marginBottom: 24, height: 24 },
  numpad: {
    flexDirection: 'row', flexWrap: 'wrap',
    width: KEY_W * 3 + 48,
    gap: 8, justifyContent: 'center',
    marginTop: 8,
  },
  key: { width: KEY_W, height: 64, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  keyActive: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  keyTxt: { color: '#fff', fontSize: 24, fontWeight: '500' },
  keyDel: { color: '#aaa', fontSize: 22, fontWeight: '400' },
});
