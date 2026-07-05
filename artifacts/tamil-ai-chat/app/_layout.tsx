import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

  // ── Crash log state ──────────────────────────────────────────
  const [crashLog, setCrashLog] = useState<string | null>(null);
  const [crashChecked, setCrashChecked] = useState(false);

  useEffect(() => {
    // Read saved crash on every launch
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
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

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
