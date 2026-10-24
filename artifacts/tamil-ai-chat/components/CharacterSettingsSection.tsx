import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALL_PERSONAS, type Persona } from '../constants/personas';
import {
  getNotificationPermission,
  isPushSupported,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/push-notifications';
import { isModelCached, isWebGPUSupported } from '../services/webllm';
import {
  CHARACTER_SETTINGS_CHANGED_EVENT,
  CHARACTER_VIEW_MODE_KEY,
} from '../services/character-settings';
import { playRingtone, RINGTONES } from '../services/notification-sounds';

const INTERVALS = [10, 20, 30] as const;
const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

type ViewMode = 'list' | 'grid';
type PushStatus = 'idle' | 'subscribing' | 'active' | 'denied' | 'unsupported';

function SettingsToggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onToggle}
      activeOpacity={0.8}
      style={[s.toggle, value ? s.toggleOn : s.toggleOff]}
    >
      {value ? (
        <>
          <Text style={s.toggleLabel}>ON</Text>
          <View style={s.toggleDot} />
        </>
      ) : (
        <>
          <View style={s.toggleDot} />
          <Text style={s.toggleLabel}>OFF</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export default function CharacterSettingsSection() {
  const [personas, setPersonas] = useState<Persona[]>(ALL_PERSONAS);
  const [characterViewMode, setCharacterViewMode] = useState<ViewMode>('list');
  const [isOnline, setIsOnline] = useState(true);
  const [autoMsgEnabled, setAutoMsgEnabled] = useState(false);
  const [intervals, setIntervals] = useState<Record<string, number | null>>({});
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
  const [ringtone, setRingtone] = useState<string>('classic');
  const [existingPin, setExistingPin] = useState<string | null>(null);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinStep, setPinStep] = useState<'set' | 'confirm'>('set');
  const [pinFirst, setPinFirst] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinMsg, setPinMsg] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const customRaw = await AsyncStorage.getItem('custom_personas_v1').catch(() => null);
      const custom: Persona[] = customRaw ? JSON.parse(customRaw) : [];
      const allPersonas = [...ALL_PERSONAS, ...custom];
      setPersonas(allPersonas);

      const [viewMode, online, autoMsg, savedRingtone, pin] = await Promise.all([
        AsyncStorage.getItem(CHARACTER_VIEW_MODE_KEY),
        AsyncStorage.getItem('chat_is_online'),
        AsyncStorage.getItem('auto_msg_enabled'),
        AsyncStorage.getItem('ringtone'),
        AsyncStorage.getItem('app_pin'),
      ]);
      if (viewMode === 'list' || viewMode === 'grid') setCharacterViewMode(viewMode);
      if (online !== null) setIsOnline(online === 'true');
      setAutoMsgEnabled(autoMsg === 'true');
      if (savedRingtone) setRingtone(savedRingtone);
      setExistingPin(pin);

      const savedIntervals = await AsyncStorage.multiGet(
        allPersonas.map(persona => `auto_msg_interval_${persona.id}`),
      );
      const nextIntervals: Record<string, number | null> = {};
      for (const [key, value] of savedIntervals) {
        nextIntervals[key.replace('auto_msg_interval_', '')] = value ? Number.parseInt(value, 10) : null;
      }
      setIntervals(nextIntervals);
    } catch (error) {
      Alert.alert('Settings load ஆகவில்லை', String(error));
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const notifyCharacterList = () => {
    DeviceEventEmitter.emit(CHARACTER_SETTINGS_CHANGED_EVENT);
  };

  const changeCharacterViewMode = async (mode: ViewMode) => {
    try {
      await AsyncStorage.setItem(CHARACTER_VIEW_MODE_KEY, mode);
      setCharacterViewMode(mode);
      notifyCharacterList();
    } catch (error) {
      Alert.alert('அமைப்பைச் சேமிக்க முடியவில்லை', String(error));
    }
  };

  const toggleOnline = async () => {
    const next = !isOnline;
    setIsOnline(next);
    try {
      await AsyncStorage.setItem('chat_is_online', String(next));
      notifyCharacterList();
    } catch (error) {
      Alert.alert('அமைப்பைச் சேமிக்க முடியவில்லை', String(error));
    }
  };

  const buildPushPayload = (intervalMap: Record<string, number | null>) => {
    const activeIntervals: Record<string, number> = {};
    const personaNames: Record<string, string> = {};
    for (const persona of personas) {
      const interval = intervalMap[persona.id];
      if (interval) {
        activeIntervals[persona.id] = interval;
        personaNames[persona.id] = persona.name;
      }
    }
    return { activeIntervals, personaNames };
  };

  const syncPushSubscription = async (enabled: boolean, intervalMap: Record<string, number | null>) => {
    if (!isPushSupported()) {
      setPushStatus('unsupported');
      return;
    }
    if (!enabled) {
      await unsubscribeFromPush();
      setPushStatus('idle');
      return;
    }
    const { activeIntervals, personaNames } = buildPushPayload(intervalMap);
    if (Object.keys(activeIntervals).length === 0) return;
    setPushStatus('subscribing');
    await registerServiceWorker();
    const subscribed = await subscribeToPush(activeIntervals, personaNames);
    if (subscribed) setPushStatus('active');
    else setPushStatus(getNotificationPermission() === 'denied' ? 'denied' : 'idle');
  };

  const toggleAutoMsg = async () => {
    const next = !autoMsgEnabled;
    setAutoMsgEnabled(next);
    try {
      await AsyncStorage.setItem('auto_msg_enabled', String(next));
    } catch {}
    await syncPushSubscription(next, intervals);
    notifyCharacterList();
  };

  const setIntervalForPersona = async (personaId: string, interval: number | null) => {
    const next = { ...intervals, [personaId]: interval };
    setIntervals(next);
    try {
      if (interval) await AsyncStorage.setItem(`auto_msg_interval_${personaId}`, String(interval));
      else await AsyncStorage.removeItem(`auto_msg_interval_${personaId}`);
    } catch {}
    if (autoMsgEnabled) await syncPushSubscription(true, next);
    notifyCharacterList();
  };

  const pickRingtone = async (id: string) => {
    setRingtone(id);
    await AsyncStorage.setItem('ringtone', id).catch(() => {});
    playRingtone(id);
    notifyCharacterList();
  };

  const openPinSetup = () => {
    setPinStep('set');
    setPinFirst('');
    setPinInput('');
    setPinMsg('');
    setShowPinSetup(true);
  };

  const handlePinKey = (key: string) => {
    if (key === '⌫') {
      setPinInput(current => current.slice(0, -1));
      return;
    }
    if (pinInput.length >= 4) return;
    const next = pinInput + key;
    setPinInput(next);
    if (next.length !== 4) return;

    if (pinStep === 'set') {
      setPinFirst(next);
      setPinInput('');
      setPinStep('confirm');
      setPinMsg('மீண்டும் PIN enter பண்ணுங்க (confirm)');
      return;
    }

    if (next === pinFirst) {
      AsyncStorage.setItem('app_pin', next).catch(() => {});
      setExistingPin(next);
      setPinMsg('✅ PIN set ஆகிட்டது!');
      setTimeout(() => setShowPinSetup(false), 1200);
    } else {
      setPinMsg('❌ Match ஆகல! மீண்டும் try பண்ணுங்க');
      setPinInput('');
      setPinStep('set');
      setPinFirst('');
    }
  };

  const removePin = async () => {
    await AsyncStorage.removeItem('app_pin').catch(() => {});
    setExistingPin(null);
  };

  return (
    <View>
      <Text style={s.sectionHeading}>Chat & Character Settings</Text>
      <Text style={s.sectionDescription}>
        Character List-ல் இருந்த settings இங்கே ஒரே இடத்தில் கிடைக்கும்.
      </Text>

      <View style={s.card}>
        <Text style={s.title}>Character display</Text>
        <Text style={s.subtitle}>Character List-ஐ list அல்லது grid-ஆகக் காட்டுங்கள்</Text>
        <View style={s.viewOptions}>
          {(['list', 'grid'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              testID={`character-view-${mode}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: characterViewMode === mode }}
              style={[s.viewOption, characterViewMode === mode && s.viewOptionActive]}
              onPress={() => void changeCharacterViewMode(mode)}
            >
              <Text style={[s.viewOptionIcon, characterViewMode === mode && s.selectedText]}>
                {mode === 'list' ? '☰' : '▦'}
              </Text>
              <Text style={[s.viewOptionText, characterViewMode === mode && s.selectedText]}>
                {mode === 'list' ? 'List view' : 'Grid view'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <View style={s.settingRow}>
          <View style={s.copy}>
            <Text style={s.title}>🌐 Online Mode</Text>
            <Text style={s.subtitle}>{isOnline ? 'Gemini API வழியா chat' : 'Offline / Gemma mode'}</Text>
          </View>
          <SettingsToggle value={isOnline} onToggle={() => void toggleOnline()} />
        </View>
      </View>

      <View style={s.card}>
        <View style={s.settingRow}>
          <View style={s.copy}>
            <Text style={s.title}>💬 Auto Message</Text>
            <Text style={s.subtitle}>App close ஆனாலும் push notification வரும்</Text>
            {autoMsgEnabled && (
              <Text style={[s.pushStatus, pushStatus === 'active' && s.pushStatusActive]}>
                {pushStatus === 'active' ? '🔔 Notifications Active'
                  : pushStatus === 'subscribing' ? '⏳ Enabling...'
                    : pushStatus === 'denied' ? '🔕 Permission Denied — notification allow பண்ணுங்க'
                      : pushStatus === 'unsupported' ? '⚠️ இந்த browser push-ஐ support செய்யவில்லை'
                        : ''}
              </Text>
            )}
          </View>
          <SettingsToggle value={autoMsgEnabled} onToggle={() => void toggleAutoMsg()} />
        </View>
        {autoMsgEnabled && (
          <View style={s.intervalList}>
            <Text style={s.intervalHeading}>⏱ Interval per Character</Text>
            {personas.map(persona => (
              <View key={persona.id} style={s.intervalRow}>
                <Text style={s.intervalName} numberOfLines={1}>{persona.name}</Text>
                <View style={s.intervalButtons}>
                  {INTERVALS.map(interval => (
                    <TouchableOpacity
                      key={interval}
                      style={[s.intervalButton, intervals[persona.id] === interval && s.intervalButtonActive]}
                      onPress={() => void setIntervalForPersona(
                        persona.id,
                        intervals[persona.id] === interval ? null : interval,
                      )}
                    >
                      <Text style={[s.intervalButtonText, intervals[persona.id] === interval && s.selectedText]}>
                        {interval}m
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[s.intervalButton, intervals[persona.id] == null && s.intervalButtonOff]}
                    onPress={() => void setIntervalForPersona(persona.id, null)}
                  >
                    <Text style={[s.intervalButtonText, intervals[persona.id] == null && s.intervalOffText]}>off</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.title}>🧠 Gemma AI (Offline)</Text>
        <View style={s.gemmaStatus}>
          {isWebGPUSupported()
            ? isModelCached()
              ? <Text style={s.successText}>✅ Ready — offline chat கிடைக்கும்</Text>
              : <Text style={s.warningText}>⬇️ Download ஆகல — Chat screen-ல் 🧠 icon tap பண்ணுங்க</Text>
            : <Text style={s.warningText}>⚠️ Chrome 121+ தேவை (WebGPU)</Text>
          }
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.title}>🔔 Notification Ringtone</Text>
        <Text style={s.subtitle}>Auto-message வரும்போது play ஆகும்</Text>
        <View style={s.ringtoneGrid}>
          {RINGTONES.map(item => (
            <TouchableOpacity
              key={item.id}
              style={[s.ringtoneButton, ringtone === item.id && s.ringtoneButtonActive]}
              onPress={() => void pickRingtone(item.id)}
            >
              <Text style={s.ringtoneEmoji}>{item.emoji}</Text>
              <Text style={[s.ringtoneLabel, ringtone === item.id && s.selectedText]}>{item.label}</Text>
              {ringtone === item.id && <Text style={s.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.title}>🔒 App PIN Lock</Text>
        <Text style={s.subtitle}>
          {existingPin ? '✅ PIN set ஆகிருக்கு — மற்றவங்க திறக்க முடியாது' : 'PIN இல்லை — யாரும் திறக்கலாம்'}
        </Text>
        <View style={s.pinActions}>
          <TouchableOpacity style={s.pinButton} onPress={openPinSetup}>
            <Text style={s.pinButtonText}>{existingPin ? '🔄 PIN மாத்து' : '🔒 PIN Set பண்ணு'}</Text>
          </TouchableOpacity>
          {existingPin && (
            <TouchableOpacity style={s.pinRemoveButton} onPress={() => void removePin()}>
              <Text style={s.pinRemoveText}>🗑 Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal
        visible={showPinSetup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPinSetup(false)}
      >
        <View style={s.pinOverlay}>
          <View style={s.pinBox}>
            <Text style={s.pinTitle}>
              {pinStep === 'set' ? '🔒 New PIN Set பண்ணு' : '🔒 PIN Confirm பண்ணு'}
            </Text>
            <Text style={s.pinSubtitle}>4 digits enter பண்ணுங்க</Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3].map(index => (
                <View key={index} style={[s.pinDot, pinInput.length > index && s.pinDotFilled]} />
              ))}
            </View>
            {!!pinMsg && <Text style={s.pinMessage}>{pinMsg}</Text>}
            <View style={s.numpad}>
              {PIN_KEYS.map((key, index) => key === ''
                ? <View key={index} style={s.numKey} />
                : (
                  <TouchableOpacity key={index} style={[s.numKey, s.numKeyActive]} onPress={() => handlePinKey(key)}>
                    <Text style={s.numKeyText}>{key}</Text>
                  </TouchableOpacity>
                ))}
            </View>
            <TouchableOpacity style={s.pinCancel} onPress={() => setShowPinSetup(false)}>
              <Text style={s.pinCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  sectionHeading: { color: '#e6edf3', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  sectionDescription: { color: '#8b949e', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 16,
    marginBottom: 12,
  },
  title: { color: '#e6edf3', fontSize: 15, fontWeight: '700' },
  subtitle: { color: '#8b949e', fontSize: 12, lineHeight: 18, marginTop: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  toggle: {
    width: 62,
    minHeight: 32,
    borderRadius: 18,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleOn: { backgroundColor: '#238636' },
  toggleOff: { backgroundColor: '#424a53' },
  toggleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleLabel: { color: '#fff', fontSize: 9, fontWeight: '800' },
  viewOptions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  viewOption: {
    flex: 1,
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  viewOptionActive: { borderColor: '#51d8f2', backgroundColor: '#10252d' },
  viewOptionIcon: { color: '#8b949e', fontSize: 18, fontWeight: '700' },
  viewOptionText: { color: '#8b949e', fontSize: 13, fontWeight: '700' },
  selectedText: { color: '#51d8f2' },
  pushStatus: { color: '#f0a33a', fontSize: 11, marginTop: 7 },
  pushStatusActive: { color: '#3fb950' },
  intervalList: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#30363d', paddingTop: 12 },
  intervalHeading: { color: '#8b949e', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  intervalName: { flex: 1, color: '#e6edf3', fontSize: 12 },
  intervalButtons: { flexDirection: 'row', gap: 5 },
  intervalButton: {
    minWidth: 39,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  intervalButtonActive: { backgroundColor: '#10252d', borderColor: '#51d8f2' },
  intervalButtonOff: { borderColor: '#7f3434', backgroundColor: '#321719' },
  intervalButtonText: { color: '#8b949e', fontSize: 11, fontWeight: '700' },
  intervalOffText: { color: '#f85149' },
  gemmaStatus: { marginTop: 9 },
  successText: { color: '#3fb950', fontSize: 12 },
  warningText: { color: '#d29922', fontSize: 12, lineHeight: 18 },
  ringtoneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ringtoneButton: {
    width: '48%',
    minHeight: 58,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  ringtoneButtonActive: { borderColor: '#51d8f2', backgroundColor: '#10252d' },
  ringtoneEmoji: { fontSize: 17 },
  ringtoneLabel: { flex: 1, color: '#8b949e', fontSize: 11, fontWeight: '600' },
  checkmark: { color: '#51d8f2', fontWeight: '800' },
  pinActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pinButton: { flex: 1, backgroundColor: '#1f6feb', borderRadius: 8, padding: 11, alignItems: 'center' },
  pinButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pinRemoveButton: { backgroundColor: '#321719', borderRadius: 8, padding: 11, alignItems: 'center' },
  pinRemoveText: { color: '#f85149', fontSize: 12, fontWeight: '700' },
  pinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pinBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#161b22',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#51d8f2',
    padding: 22,
    alignItems: 'center',
  },
  pinTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  pinSubtitle: { color: '#8b949e', fontSize: 13, marginTop: 6 },
  pinDots: { flexDirection: 'row', gap: 18, marginTop: 20, marginBottom: 12 },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#30363d' },
  pinDotFilled: { backgroundColor: '#51d8f2' },
  pinMessage: { color: '#e6edf3', fontSize: 12, textAlign: 'center', marginVertical: 8 },
  numpad: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  numKey: { width: '28%', height: 48, alignItems: 'center', justifyContent: 'center' },
  numKeyActive: { backgroundColor: '#21262d', borderRadius: 10 },
  numKeyText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  pinCancel: { padding: 12, marginTop: 8 },
  pinCancelText: { color: '#8b949e', fontSize: 13, fontWeight: '600' },
});
