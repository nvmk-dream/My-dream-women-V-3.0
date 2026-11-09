import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  voiceService,
  MASTER_VOICE_1,
  MASTER_VOICE_2,
  type VoiceMode,
  type VoiceProfile,
} from '../services/voice-service';
import type { Persona } from '../constants/personas';

export default function VoiceSettingsSection() {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('universal');
  const [universalVoiceId, setUniversalVoiceId] = useState(MASTER_VOICE_1.id);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [characterVoiceMap, setCharacterVoiceMap] = useState<Record<string, VoiceProfile>>({});
  const [loading, setLoading] = useState(true);

  // Modal for adding/replacing custom character voice
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPersonaForUpload, setSelectedPersonaForUpload] = useState<Persona | null>(null);
  const [pickedAudioUri, setPickedAudioUri] = useState<string | null>(null);
  const [pickedAudioName, setPickedAudioName] = useState<string>('');
  const [transcriptInput, setTranscriptInput] = useState('');
  const [savingVoice, setSavingVoice] = useState(false);

  // Live test speech
  const [testText, setTestText] = useState('டார்லிங், இன்னைக்கு நாள் ரொம்ப நல்லா போகும், கவலைப்படாதே.');
  const [testingVoice, setTestingVoice] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const enabled = await voiceService.isVoiceEnabled();
      const mode = await voiceService.getVoiceMode();
      const uVoiceId = await voiceService.getSelectedUniversalVoiceId();
      const allPersonas = await voiceService.getAllPersonas();
      const charMap = await voiceService.getCharacterVoiceMap();

      setVoiceEnabled(enabled);
      setVoiceMode(mode);
      setUniversalVoiceId(uVoiceId);
      setPersonas(allPersonas);
      setCharacterVoiceMap(charMap);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const toggleVoiceEnabled = async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    await voiceService.setVoiceEnabled(next);
  };

  const changeVoiceMode = async (mode: VoiceMode) => {
    setVoiceMode(mode);
    await voiceService.setVoiceMode(mode);
  };

  const selectUniversalVoice = async (id: string) => {
    setUniversalVoiceId(id);
    await voiceService.setSelectedUniversalVoiceId(id);
  };

  const openAudioPicker = async (persona: Persona) => {
    setSelectedPersonaForUpload(persona);
    setTranscriptInput('');
    setPickedAudioUri(null);
    setPickedAudioName('');

    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        setPickedAudioUri(file.uri);
        setPickedAudioName(file.name);
        setModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert('Audio Error', 'ஆடியோ கோப்பைத் தேர்ந்தெடுக்க முடியவில்லை.');
    }
  };

  const saveCustomVoice = async () => {
    if (!selectedPersonaForUpload || !pickedAudioUri) return;
    if (!transcriptInput.trim()) {
      Alert.alert('விவரம் தேவை', 'ஆடியோவில் பேசப்பட்ட வரியை (Transcript) உள்ளிடவும்.');
      return;
    }

    setSavingVoice(true);
    try {
      const profile: VoiceProfile = {
        id: `voice_${selectedPersonaForUpload.id}`,
        name: `${selectedPersonaForUpload.name} Voice`,
        characterId: selectedPersonaForUpload.id,
        isBuiltIn: false,
        audioUri: pickedAudioUri,
        referenceTranscript: transcriptInput.trim(),
      };

      await voiceService.setCharacterVoice(selectedPersonaForUpload.id, profile);
      const updatedMap = await voiceService.getCharacterVoiceMap();
      setCharacterVoiceMap(updatedMap);
      setModalVisible(false);
      Alert.alert('வெற்றி', `${selectedPersonaForUpload.name} குரல் ஸ்லாட் புதுப்பிக்கப்பட்டது!`);
    } catch (err: any) {
      Alert.alert('சேமிப்பு தோல்வி', err?.message || 'குரலைச் சேமிக்க முடியவில்லை.');
    } finally {
      setSavingVoice(false);
    }
  };

  const resetCharacterVoice = async (persona: Persona) => {
    Alert.alert(
      'குரல் நீக்கம்',
      `${persona.name} தனிப்பயன் குரலை நீக்கிவிட்டு இயல்பு நிலைக்கு மாற்றவா?`,
      [
        { text: 'இல்லை', style: 'cancel' },
        {
          text: 'ஆம், மாற்று',
          style: 'destructive',
          onPress: async () => {
            await voiceService.removeCharacterVoice(persona.id);
            const updatedMap = await voiceService.getCharacterVoiceMap();
            setCharacterVoiceMap(updatedMap);
          },
        },
      ]
    );
  };

  const testSpeak = async (profile?: VoiceProfile) => {
    if (testingVoice) return;
    setTestingVoice(true);
    try {
      let targetProfile = profile;
      if (!targetProfile) {
        if (universalVoiceId === MASTER_VOICE_2.id) {
          targetProfile = MASTER_VOICE_2;
        } else {
          targetProfile = MASTER_VOICE_1;
        }
      }

      await voiceService.speakText(
        testText,
        targetProfile,
        () => {},
        () => setTestingVoice(false)
      );
    } catch (err: any) {
      Alert.alert('Voice Test Error', err?.message || 'குரலை இயக்க முடியவில்லை.');
      setTestingVoice(false);
    }
  };

  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator color="#C084FC" />
      </View>
    );
  }

  return (
    <View style={s.card}>
      {/* ── Card Header ── */}
      <View style={s.cardHeader}>
        <Text style={s.cardIcon}>🎙️</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>Voice (குரல் அமைப்புகள்)</Text>
          <Text style={s.cardBadge}>AI4Bharat IndicF5</Text>
        </View>
      </View>

      <Text style={s.cardDesc}>
        Chat-ல் AI கேரக்டர்களின் பதில்களை அசல் விஸ்பர் மனித குரலில் பேச வைக்கலாம்.
      </Text>

      {/* ── Master Enable Toggle ── */}
      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.toggleTitle}>Chat Voice Reading</Text>
          <Text style={s.toggleSub}>AI பெண்கள் பேச வேண்டுமா (Auto-Voice)</Text>
        </View>
        <TouchableOpacity
          style={[s.toggleBtn, voiceEnabled ? s.toggleOn : s.toggleOff]}
          onPress={toggleVoiceEnabled}
          activeOpacity={0.8}
        >
          <Text style={s.toggleTxt}>{voiceEnabled ? 'ON' : 'OFF'}</Text>
          <View style={s.toggleDot} />
        </TouchableOpacity>
      </View>

      {/* ── General Mode Switch ── */}
      <View style={s.sectionBox}>
        <Text style={s.sectionTitle}>பொதுவான குரல் தேர்வு முறை (Voice Mode)</Text>
        <View style={s.modeRow}>
          <TouchableOpacity
            style={[s.modeOption, voiceMode === 'universal' && s.modeOptionActive]}
            onPress={() => changeVoiceMode('universal')}
          >
            <Ionicons
              name={voiceMode === 'universal' ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={voiceMode === 'universal' ? '#C084FC' : '#94A3B8'}
            />
            <Text style={[s.modeTxt, voiceMode === 'universal' && s.modeTxtActive]}>
              அனைவருக்கும் ஒரே குரல்
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeOption, voiceMode === 'per_character' && s.modeOptionActive]}
            onPress={() => changeVoiceMode('per_character')}
          >
            <Ionicons
              name={voiceMode === 'per_character' ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={voiceMode === 'per_character' ? '#C084FC' : '#94A3B8'}
            />
            <Text style={[s.modeTxt, voiceMode === 'per_character' && s.modeTxtActive]}>
              அந்தந்த கேரக்டரின் தனி குரல்
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Master Built-in Voices ── */}
      <View style={s.sectionBox}>
        <Text style={s.sectionTitle}>Master Built-in Voices (முதன்மை குரல்கள்)</Text>

        {/* Master Voice 1 */}
        <TouchableOpacity
          style={[
            s.voiceRow,
            voiceMode === 'universal' && universalVoiceId === MASTER_VOICE_1.id && s.voiceRowSelected,
          ]}
          onPress={() => selectUniversalVoice(MASTER_VOICE_1.id)}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.voiceName}>{MASTER_VOICE_1.name}</Text>
            <Text style={s.voiceSub}>Transcript: {MASTER_VOICE_1.referenceTranscript}</Text>
          </View>
          <TouchableOpacity
            style={s.testMiniBtn}
            onPress={() => testSpeak(MASTER_VOICE_1)}
            disabled={testingVoice}
          >
            <Ionicons name="volume-high" size={16} color="#FFFFFF" />
            <Text style={s.testMiniTxt}>Test</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Master Voice 2 */}
        <TouchableOpacity
          style={[
            s.voiceRow,
            voiceMode === 'universal' && universalVoiceId === MASTER_VOICE_2.id && s.voiceRowSelected,
          ]}
          onPress={() => selectUniversalVoice(MASTER_VOICE_2.id)}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.voiceName}>{MASTER_VOICE_2.name}</Text>
            <Text style={s.voiceSub}>Transcript: {MASTER_VOICE_2.referenceTranscript}</Text>
          </View>
          <TouchableOpacity
            style={s.testMiniBtn}
            onPress={() => testSpeak(MASTER_VOICE_2)}
            disabled={testingVoice}
          >
            <Ionicons name="volume-high" size={16} color="#FFFFFF" />
            <Text style={s.testMiniTxt}>Test</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </View>

      {/* ── Dynamic Character Voice Slots ── */}
      <View style={s.sectionBox}>
        <Text style={s.sectionTitle}>
          Character Voice Slots ({personas.length} கேரக்டர்கள்)
        </Text>
        <Text style={s.sectionHint}>
          எத்தனை கேரக்டர்கள் உள்ளதோ அத்தனை வாய்ஸ் ஸ்லாட்டுகள் உள்ளன. புதிய கேரக்டர் சேர்க்கப்படும் போது தானாக புதிய ஸ்லாட் உருவாகும்.
        </Text>

        {personas.map((persona) => {
          const customVoice = characterVoiceMap[persona.id];
          const hasCustom = !!customVoice;

          return (
            <View key={persona.id} style={s.charSlotCard}>
              <View style={s.charSlotHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.charSlotTitle}>{persona.name} - Voice Slot</Text>
                  <Text style={s.charSlotStatus}>
                    {hasCustom ? '✨ தனிப்பயன் குரல் இணைக்கப்பட்டுள்ளது' : '🌟 Default Master Voice'}
                  </Text>
                </View>

                {hasCustom && (
                  <TouchableOpacity
                    style={s.resetMiniBtn}
                    onPress={() => resetCharacterVoice(persona)}
                  >
                    <Ionicons name="trash-outline" size={14} color="#F87171" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={s.charSlotActions}>
                <TouchableOpacity
                  style={s.actionBtn}
                  onPress={() => openAudioPicker(persona)}
                >
                  <Ionicons name="cloud-upload-outline" size={15} color="#FFFFFF" />
                  <Text style={s.actionBtnTxt}>
                    {hasCustom ? 'குரல் மாற்று (Replace)' : 'ஆடியோ ஏற்று (Upload)'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.actionBtn, s.actionTestBtn]}
                  onPress={() => testSpeak(customVoice || MASTER_VOICE_1)}
                  disabled={testingVoice}
                >
                  <Ionicons name="play-circle-outline" size={16} color="#C084FC" />
                  <Text style={[s.actionBtnTxt, { color: '#C084FC' }]}>சோதித்து பார்</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* ── Live Test Synthesizer Box ── */}
      <View style={s.testBox}>
        <Text style={s.testBoxTitle}>🔊 நேரடி குரல் சோதனை (Test Voice Speech)</Text>
        <TextInput
          style={s.testInput}
          value={testText}
          onChangeText={setTestText}
          placeholder="தமிழ் உரை தட்டச்சு செய்து கேளுங்கள்..."
          placeholderTextColor="#64748B"
          multiline
        />
        <TouchableOpacity
          style={s.testPlayBtn}
          onPress={() => testSpeak()}
          disabled={testingVoice}
        >
          {testingVoice ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="volume-high" size={18} color="#FFFFFF" />
              <Text style={s.testPlayTxt}>குரலை இயக்கு (Speak with AI4Bharat)</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Modal for uploading custom voice ── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>
              {selectedPersonaForUpload?.name} - புதிய குரல் சேர்த்தல்
            </Text>
            <Text style={s.modalSub}>
              தேர்வு செய்யப்பட்ட ஆடியோ: <Text style={{ color: '#C084FC', fontWeight: 'bold' }}>{pickedAudioName}</Text>
            </Text>

            <Text style={s.inputLabel}>
              ஆடியோவில் பேசப்பட்ட வாக்கியம் (Reference Transcript):
            </Text>
            <TextInput
              style={s.modalInput}
              value={transcriptInput}
              onChangeText={setTranscriptInput}
              placeholder="எ.கா: டார்லிங், இன்னைக்கு நாள் ரொம்ப நல்லா போகும்..."
              placeholderTextColor="#64748B"
              multiline
            />

            <View style={s.modalBtns}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setModalVisible(false)}
                disabled={savingVoice}
              >
                <Text style={s.modalCancelTxt}>ரத்து செய்</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.modalSaveBtn}
                onPress={saveCustomVoice}
                disabled={savingVoice}
              >
                {savingVoice ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={s.modalSaveTxt}>சேமி (Save Voice)</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 10,
    borderWidth: 1.5,
    borderColor: '#E9D5FF',
    shadowColor: '#C084FC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  cardIcon: {
    fontSize: 26,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E1B4B',
  },
  cardBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7C3AED',
    backgroundColor: '#F3E8FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  toggleSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  toggleOn: {
    backgroundColor: '#10B981',
  },
  toggleOff: {
    backgroundColor: '#94A3B8',
  },
  toggleTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
  toggleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  sectionBox: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4338CA',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
    lineHeight: 15,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  modeOptionActive: {
    borderColor: '#C084FC',
    backgroundColor: '#FAF5FF',
  },
  modeTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  modeTxtActive: {
    color: '#6D28D9',
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    gap: 8,
  },
  voiceRowSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#F5F3FF',
  },
  voiceName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B4B',
  },
  voiceSub: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  testMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  testMiniTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  charSlotCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  charSlotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  charSlotTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  charSlotStatus: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 1,
  },
  resetMiniBtn: {
    padding: 6,
  },
  charSlotActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#7C3AED',
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionTestBtn: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#C084FC',
  },
  actionBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  testBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginTop: 6,
  },
  testBoxTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  testInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    fontSize: 12.5,
    color: '#0F172A',
    minHeight: 50,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  testPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7C3AED',
    paddingVertical: 11,
    borderRadius: 10,
  },
  testPlayTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E1B4B',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  modalCancelTxt: {
    color: '#475569',
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
  },
  modalSaveTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
