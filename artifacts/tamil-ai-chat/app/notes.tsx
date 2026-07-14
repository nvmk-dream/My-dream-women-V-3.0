import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, Modal, ScrollView, KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALL_PERSONAS } from '../constants/personas';
import { getCloudinaryMeta, setCloudinaryMeta } from '../services/api';

const BUILTIN_PHOTO_STYLES = [
  'Breast Show', 'Buttocks', 'Cleavage', 'Half Breast',
  'High Slit', 'Legs Spread', 'Lingerie', 'Low Neckline',
  'Nude', 'Seductive', 'Wet Clothes', 'Sleeping',
  'General Notes', 'Chat Ideas', 'Prompts', 'Story Ideas',
];

const ACCENT_COLORS = ['#F5A623', '#E91E8C', '#4A90D9', '#27AE60', '#9B59B6', '#E53935', '#FF7043', '#00ACC1', '#8D6E63', '#558B2F'];

type Page = { id: string; title: string; content: string; updatedAt: number; accent?: string };
type CharNotes = Record<string, Page[]>;
type CustomStyle = { id: string; label: string; prompt?: string };
type PersonaMerged = (typeof ALL_PERSONAS)[0] & { avatarPhotoUri?: string };

const STORAGE_KEY = 'character_notes_v2';
const CUSTOM_STYLES_KEY = 'custom_photo_styles_v1';
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<'chars' | 'pages' | 'editor'>('chars');
  const [allNotes, setAllNotes] = useState<CharNotes>({});
  const [personas, setPersonas] = useState<PersonaMerged[]>(ALL_PERSONAS as PersonaMerged[]);
  const [customStyles, setCustomStyles] = useState<CustomStyle[]>([]);
  const [showAddStyleModal, setShowAddStyleModal] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');
  const [newStylePrompt, setNewStylePrompt] = useState('');
  const [activeChar, setActiveChar] = useState<PersonaMerged | null>(null);
  const [activePage, setActivePage] = useState<Page | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [addPageModal, setAddPageModal] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [translating, setTranslating] = useState(false);

  // ── Custom modal states (replacing Alert.alert) ──
  const [deleteConfirmPage, setDeleteConfirmPage] = useState<Page | null>(null);
  const [translateResult, setTranslateResult] = useState('');
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [longPressPage, setLongPressPage] = useState<Page | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [translateError, setTranslateError] = useState('');

  useEffect(() => {
    const loadNotes = async () => {
      // Step 1: AsyncStorage — instant load (works offline)
      const localRaw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      const local: CharNotes = localRaw ? JSON.parse(localRaw) : {};
      if (Object.keys(local).length) setAllNotes(local);
      // Step 2: Cloudinary meta — restore after reinstall (local wins on conflict)
      try {
        const cloud = await getCloudinaryMeta('character_notes_v2');
        if (cloud && typeof cloud === 'object' && !Array.isArray(cloud)) {
          const merged: CharNotes = { ...(cloud as CharNotes), ...local };
          setAllNotes(merged);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => {});
        }
      } catch { /* cloud offline — local still shown */ }
    };
    loadNotes();
  }, []);

  // Reload merged personas + custom styles whenever screen is focused
  // (so edits in My AI Girls sync, and custom styles added in Chat appear here)
  const reloadShared = useCallback(async () => {
    try {
      const customRaw = await AsyncStorage.getItem('custom_personas_v1').catch(() => null);
      const customs: typeof ALL_PERSONAS = customRaw ? JSON.parse(customRaw) : [];
      const allSrc = [...ALL_PERSONAS, ...customs];
      const merged = await Promise.all(allSrc.map(async p => {
        try {
          const saved = await AsyncStorage.getItem(`persona_edit_${p.id}`);
          const data = saved ? JSON.parse(saved) : {};
          return { ...p, ...data } as PersonaMerged;
        } catch {
          return p as PersonaMerged;
        }
      }));
      setPersonas(merged);
      const stylesRaw = await AsyncStorage.getItem(CUSTOM_STYLES_KEY);
      if (stylesRaw) setCustomStyles(JSON.parse(stylesRaw));
    } catch {}
  }, []);

  useEffect(() => { reloadShared(); }, [reloadShared]);
  useEffect(() => {
    if (view === 'chars' || view === 'pages') reloadShared();
  }, [view, reloadShared]);

  // Race-safe: always re-read storage before merge & write (Chat may have added styles meanwhile)
  const addCustomStyle = async () => {
    const name = newStyleName.trim();
    if (!name) return;
    const newStyle: CustomStyle = {
      id: `custom_${Date.now().toString(36)}`,
      label: name,
      prompt: newStylePrompt.trim() || name.toLowerCase(),
    };
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_STYLES_KEY);
      const current: CustomStyle[] = Array.isArray(raw ? JSON.parse(raw) : null) ? JSON.parse(raw!) : [];
      const merged = [...current, newStyle];
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(merged));
      setCustomStyles(merged);
      setCloudinaryMeta('custom_photo_styles_v1', merged).catch(() => {}); // cloud backup
    } catch {
      const updated = [...customStyles, newStyle];
      setCustomStyles(updated);
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_photo_styles_v1', updated).catch(() => {}); // cloud backup
    }
    setNewStyleName('');
    setNewStylePrompt('');
    setShowAddStyleModal(false);
    showToast(`✅ "${name}" style சேர்க்கப்பட்டது`);
  };

  const removeCustomStyle = async (id: string) => {
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_STYLES_KEY);
      const current: CustomStyle[] = Array.isArray(raw ? JSON.parse(raw) : null) ? JSON.parse(raw!) : [];
      const updated = current.filter(s => s.id !== id);
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
      setCustomStyles(updated);
      setCloudinaryMeta('custom_photo_styles_v1', updated).catch(() => {}); // cloud backup
    } catch {
      const updated = customStyles.filter(s => s.id !== id);
      setCustomStyles(updated);
      await AsyncStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
      setCloudinaryMeta('custom_photo_styles_v1', updated).catch(() => {}); // cloud backup
    }
  };

  // Combined list for display: built-in + custom
  const ALL_STYLES = [...BUILTIN_PHOTO_STYLES, ...customStyles.map(s => s.label)];

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  const save = useCallback(async (updated: CharNotes) => {
    setAllNotes(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setCloudinaryMeta('character_notes_v2', updated).catch(() => {}); // cloud backup
  }, []);

  const pages: Page[] = activeChar ? (allNotes[activeChar.id] ?? []) : [];

  const openChar = (persona: PersonaMerged) => { setActiveChar(persona); setSearchQ(''); setShowSearch(false); setView('pages'); };

  const openPage = (page: Page) => {
    setActivePage(page); setEditorText(page.content); setEditorTitle(page.title); setView('editor');
  };

  const savePage = async () => {
    if (!activeChar || !activePage) return;
    const updated = { ...allNotes };
    const charPages = [...(updated[activeChar.id] ?? [])];
    const idx = charPages.findIndex(p => p.id === activePage.id);
    const newPage: Page = { ...activePage, title: editorTitle, content: editorText, updatedAt: Date.now() };
    if (idx >= 0) charPages[idx] = newPage; else charPages.push(newPage);
    updated[activeChar.id] = charPages;
    await save(updated);
    setActivePage(newPage);
  };

  const deletePage = (page: Page) => setDeleteConfirmPage(page);

  const confirmDelete = async () => {
    if (!activeChar || !deleteConfirmPage) return;
    const updated = { ...allNotes };
    updated[activeChar.id] = (updated[activeChar.id] ?? []).filter(p => p.id !== deleteConfirmPage.id);
    await save(updated);
    setDeleteConfirmPage(null);
    if (view === 'editor') setView('pages');
  };

  const addPage = async (title: string, accent?: string) => {
    if (!activeChar || !title.trim()) return;
    const page: Page = { id: uid(), title: title.trim(), content: '', updatedAt: Date.now(), accent };
    const updated = { ...allNotes };
    updated[activeChar.id] = [page, ...(updated[activeChar.id] ?? [])];
    await save(updated);
    setNewPageTitle(''); setAddPageModal(false);
    openPage(page);
  };

  const addAllStyles = async () => {
    if (!activeChar) return;
    const existing = allNotes[activeChar.id] ?? [];
    const existingTitles = new Set(existing.map(p => p.title));
    const newPages: Page[] = ALL_STYLES
      .filter(st => !existingTitles.has(st))
      .map((st, i) => ({ id: uid(), title: st, content: '', updatedAt: Date.now(), accent: ACCENT_COLORS[i % ACCENT_COLORS.length] }));
    setShowOptionsModal(false);
    if (!newPages.length) { showToast('All photo styles already exist'); return; }
    const updated = { ...allNotes, [activeChar.id]: [...existing, ...newPages] };
    await save(updated);
    showToast(`✅ ${newPages.length} photo style pages added!`);
  };

  const translateText = useCallback(async () => {
    if (!editorText.trim()) { setTranslateError('Translate பண்ண முதல்ல text type பண்ணுங்க'); return; }
    setTranslateError('');
    setTranslating(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Translate the following Tamil text to English. Give ONLY the English translation, no explanations, no censoring, translate everything literally and completely:\n\n${editorText}`,
          }],
          provider: 'gemini',
          personaName: 'Translator',
          mode: 'single',
        }),
      });
      const data = await res.json();
      const translated = data?.message ?? data?.content ?? '';
      if (translated) {
        setTranslateResult(translated);
        setShowTranslateModal(true);
      } else {
        setTranslateError('Translation கிடைக்கல — மீண்டும் try பண்ணுங்க');
      }
    } catch {
      setTranslateError('Server-ஐ reach பண்ண முடியல');
    } finally {
      setTranslating(false);
    }
  }, [editorText]);

  const filteredChars = personas.filter(p => !searchQ || p.name.toLowerCase().includes(searchQ.toLowerCase()));
  const filteredPages = pages.filter(p => !searchQ || p.title.toLowerCase().includes(searchQ.toLowerCase()) || p.content.toLowerCase().includes(searchQ.toLowerCase()));

  // ── Shared modals (rendered in all views) ──
  const SharedModals = () => (
    <>
      {/* Delete confirm */}
      <Modal visible={!!deleteConfirmPage} transparent animationType="fade" onRequestClose={() => setDeleteConfirmPage(null)}>
        <Pressable style={s.overlayCenter} onPress={() => setDeleteConfirmPage(null)}>
          <Pressable style={s.confirmBox} onPress={e => e.stopPropagation()}>
            <Text style={s.confirmTitle}>🗑️ Delete?</Text>
            <Text style={s.confirmMsg}>"{deleteConfirmPage?.title}" delete பண்ணட்டுமா?</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setDeleteConfirmPage(null)}>
                <Text style={s.confirmCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmDelete} onPress={confirmDelete}>
                <Text style={s.confirmDeleteTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Translation result */}
      <Modal visible={showTranslateModal} transparent animationType="slide" onRequestClose={() => setShowTranslateModal(false)}>
        <Pressable style={s.overlayCenter} onPress={() => setShowTranslateModal(false)}>
          <Pressable style={s.translateModal} onPress={e => e.stopPropagation()}>
            <Text style={s.translateModalTitle}>🌐 Translation</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              <Text style={s.translateModalText}>{translateResult}</Text>
            </ScrollView>
            <View style={s.translateModalBtns}>
              <TouchableOpacity style={s.translateModalBtn} onPress={() => { setEditorText(translateResult); setShowTranslateModal(false); }}>
                <Text style={s.translateModalBtnTxt}>Replace Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.translateModalBtn, { backgroundColor: '#1565C0' }]} onPress={() => {
                setEditorText(t => t + '\n\n--- Translation ---\n' + translateResult);
                setShowTranslateModal(false);
              }}>
                <Text style={s.translateModalBtnTxt}>Append Below</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.translateModalBtn, { backgroundColor: '#888' }]} onPress={() => setShowTranslateModal(false)}>
                <Text style={s.translateModalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Clear confirm */}
      <Modal visible={showClearConfirm} transparent animationType="fade" onRequestClose={() => setShowClearConfirm(false)}>
        <Pressable style={s.overlayCenter} onPress={() => setShowClearConfirm(false)}>
          <Pressable style={s.confirmBox} onPress={e => e.stopPropagation()}>
            <Text style={s.confirmTitle}>Clear Text?</Text>
            <Text style={s.confirmMsg}>எல்லா text-உம் delete ஆகும்</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setShowClearConfirm(false)}>
                <Text style={s.confirmCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmDelete} onPress={() => { setEditorText(''); setShowClearConfirm(false); }}>
                <Text style={s.confirmDeleteTxt}>Clear</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ⋮ Options modal */}
      <Modal visible={showOptionsModal} transparent animationType="fade" onRequestClose={() => setShowOptionsModal(false)}>
        <Pressable style={s.overlayCenter} onPress={() => setShowOptionsModal(false)}>
          <Pressable style={s.optionsBox} onPress={e => e.stopPropagation()}>
            <Text style={s.optionsTitle}>Options</Text>
            <TouchableOpacity style={s.optionRow} onPress={addAllStyles}>
              <Text style={s.optionRowTxt}>📋 Add All Photo Styles</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.optionRow} onPress={() => setShowOptionsModal(false)}>
              <Text style={[s.optionRowTxt, { color: '#888' }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Long-press on note card */}
      <Modal visible={!!longPressPage} transparent animationType="fade" onRequestClose={() => setLongPressPage(null)}>
        <Pressable style={s.overlayCenter} onPress={() => setLongPressPage(null)}>
          <Pressable style={s.optionsBox} onPress={e => e.stopPropagation()}>
            <Text style={s.optionsTitle}>{longPressPage?.title}</Text>
            <TouchableOpacity style={s.optionRow} onPress={() => { if (longPressPage) { openPage(longPressPage); setLongPressPage(null); } }}>
              <Text style={s.optionRowTxt}>✏️ Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.optionRow} onPress={() => { if (longPressPage) { setDeleteConfirmPage(longPressPage); setLongPressPage(null); } }}>
              <Text style={[s.optionRowTxt, { color: '#E53935' }]}>🗑️ Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.optionRow} onPress={() => setLongPressPage(null)}>
              <Text style={[s.optionRowTxt, { color: '#888' }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Toast */}
      {!!toastMsg && (
        <View style={s.toast}><Text style={s.toastTxt}>{toastMsg}</Text></View>
      )}
    </>
  );

  // ── EDITOR ──
  if (view === 'editor' && activePage && activeChar) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.editorHeader, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={async () => { await savePage(); setView('pages'); }} style={s.editorBack}>
            <Text style={s.editorBackTxt}>‹ {activeChar.name}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <TouchableOpacity onPress={savePage} style={s.editorSaveBtn}>
              <Text style={s.editorSaveTxt}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => deletePage(activePage)}>
              <Text style={{ fontSize: 20 }}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[s.editorAccentBar, { backgroundColor: activePage.accent ?? '#F5A623' }]} />

        <View style={s.editorTitleRow}>
          <TextInput
            style={s.editorTitleInput}
            value={editorTitle}
            onChangeText={setEditorTitle}
            placeholder="Title..."
            placeholderTextColor="#bbb"
          />
        </View>

        <View style={s.translateBar}>
          <TouchableOpacity
            style={[s.translateBtn, translating && { opacity: 0.6 }]}
            onPress={translateText}
            disabled={translating}
          >
            {translating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.translateBtnTxt}>🌐 Tamil → English Translate</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={s.clearBtn2} onPress={() => setShowClearConfirm(true)}>
            <Text style={s.clearBtn2Txt}>🗑</Text>
          </TouchableOpacity>
        </View>

        {!!translateError && (
          <View style={s.errorBanner}>
            <Text style={s.errorBannerTxt}>{translateError}</Text>
          </View>
        )}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TextInput
            style={s.editorBody}
            value={editorText}
            onChangeText={setEditorText}
            multiline
            textAlignVertical="top"
            placeholder={`${activePage.title} பத்தி notes எழுதுங்க...\n\nPrompt ideas, photo descriptions, story lines...`}
            placeholderTextColor="#ccc"
          />
        </KeyboardAvoidingView>

        <View style={s.editorFooter}>
          <Text style={s.editorFooterTxt}>{editorText.length} chars</Text>
          <Text style={s.editorFooterTxt}>{formatDate(activePage.updatedAt)}</Text>
        </View>

        <SharedModals />
      </SafeAreaView>
    );
  }

  // ── PAGES LIST ──
  if (view === 'pages' && activeChar) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

        <View style={[s.notesHeader, { paddingTop: insets.top + 16 }]}>
          {showSearch ? (
            <TextInput
              style={s.notesSearchInput}
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder="Search notes..."
              autoFocus
              onBlur={() => { if (!searchQ) setShowSearch(false); }}
            />
          ) : (
            <Text style={s.notesHeaderTitle}>{activeChar.emoji} {activeChar.name}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setShowSearch(v => !v)}>
              <Text style={{ fontSize: 20 }}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowOptionsModal(true)}>
              <Text style={{ fontSize: 20, color: '#333' }}>⋮</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.notesBreadcrumb}>
          <TouchableOpacity onPress={() => { setView('chars'); setActiveChar(null); setSearchQ(''); setShowSearch(false); }}>
            <Text style={s.breadcrumbBack}>← All Characters</Text>
          </TouchableOpacity>
          <Text style={s.breadcrumbCount}>{filteredPages.length} notes</Text>
        </View>

        {filteredPages.length === 0 ? (
          <View style={s.emptyPages}>
            <Text style={s.emptyPagesIcon}>📋</Text>
            <Text style={s.emptyPagesTxt}>Notes இல்லை</Text>
            <Text style={s.emptyPagesSub}>+ button tap பண்ணி notes add பண்ணுங்க{'\n'}அல்லது ⋮ → "Add All Photo Styles"</Text>
          </View>
        ) : (
          <FlatList
            data={filteredPages}
            keyExtractor={p => p.id}
            contentContainerStyle={{ paddingBottom: 100 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.noteCard}
                onPress={() => openPage(item)}
                onLongPress={() => setLongPressPage(item)}
                activeOpacity={0.7}
              >
                <View style={[s.noteAccent, { backgroundColor: item.accent ?? '#F5A623' }]} />
                <View style={s.noteContent}>
                  <Text style={s.noteTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={s.noteMetaRow}>
                    <Text style={s.noteDateTxt}>{formatDate(item.updatedAt)}</Text>
                    <Text style={s.notePreview} numberOfLines={1}>
                      {item.content ? '  ' + item.content.replace(/\n/g, ' ').trim() : '  (Empty — tap to write)'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={s.noteDeleteBtn} onPress={() => deletePage(item)}>
                  <Text style={s.noteDeleteIcon}>🗑️</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}

        <View style={s.notesBottomBar}>
          <TouchableOpacity style={s.notesBottomBtn} onPress={() => { setView('chars'); setActiveChar(null); }}>
            <Text style={s.notesBottomIcon}>⊙</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.notesAddFab} onPress={() => setAddPageModal(true)}>
            <Text style={s.notesAddFabTxt}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.notesBottomBtn} onPress={() => router.replace('/')}>
            <Text style={s.notesBottomIcon}>🏠</Text>
          </TouchableOpacity>
        </View>

        {/* ── Add Custom Style modal (shared with Chat) ── */}
        <Modal visible={showAddStyleModal} transparent animationType="slide" onRequestClose={() => setShowAddStyleModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalOverlay}>
            <View style={s.modalBox}>
              <Text style={s.modalTitle}>+ Custom Style சேர்க்க</Text>
              <Text style={s.modalSubLabel}>Style Name (Notes & Chat-ல் தோன்றும்)</Text>
              <TextInput
                style={s.modalInput}
                value={newStyleName}
                onChangeText={setNewStyleName}
                placeholder="e.g. Beach Pose"
                placeholderTextColor="#999"
                autoFocus
              />
              <Text style={s.modalSubLabel}>AI Prompt (optional — chat photo generation-க்கு)</Text>
              <TextInput
                style={[s.modalInput, { height: 60 }]}
                value={newStylePrompt}
                onChangeText={setNewStylePrompt}
                placeholder="e.g. sitting on beach, bikini, sunset"
                placeholderTextColor="#999"
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowAddStyleModal(false); setNewStyleName(''); setNewStylePrompt(''); }}>
                  <Text style={s.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.createBtn, !newStyleName.trim() && { opacity: 0.4 }]}
                  onPress={addCustomStyle}
                  disabled={!newStyleName.trim()}
                >
                  <Text style={s.createBtnTxt}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={addPageModal} transparent animationType="slide" onRequestClose={() => setAddPageModal(false)}>
          <View style={s.modalOverlay}>
            <View style={s.modalBox}>
              <Text style={s.modalTitle}>New Note</Text>
              <TextInput
                style={s.modalInput}
                value={newPageTitle}
                onChangeText={setNewPageTitle}
                placeholder="Note title..."
                autoFocus
                onSubmitEditing={() => newPageTitle.trim() && addPage(newPageTitle)}
              />
              <Text style={s.modalSubLabel}>Quick photo styles:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {ALL_STYLES.map((st, i) => {
                  const isCustom = i >= BUILTIN_PHOTO_STYLES.length;
                  const customId = isCustom ? customStyles[i - BUILTIN_PHOTO_STYLES.length]?.id : null;
                  const accent = ACCENT_COLORS[i % ACCENT_COLORS.length];
                  if (isCustom && customId) {
                    return (
                      <View key={st + i} style={{ flexDirection: 'column', alignItems: 'center', marginRight: 4 }}>
                        <TouchableOpacity
                          style={[s.styleChip, { borderColor: accent }]}
                          onPress={() => addPage(st, accent)}
                        >
                          <Text style={[s.styleChipTxt, { color: accent }]}>{'★ ' + st}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => Alert.alert('Style நீக்கு', '"' + st + '" delete பண்ணணுமா?', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => { removeCustomStyle(customId); showToast('"' + st + '" நீக்கப்பட்டது'); } },
                          ])}
                          style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                        >
                          <Text style={{ fontSize: 14, color: '#e53935' }}>{'🗑️'}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={st + i}
                      style={[s.styleChip, { borderColor: accent }]}
                      onPress={() => addPage(st, accent)}
                    >
                      <Text style={[s.styleChipTxt, { color: accent }]}>{st}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[s.styleChip, { borderColor: '#6C5CE7', borderStyle: 'dashed' }]}
                  onPress={() => { setAddPageModal(false); setTimeout(() => setShowAddStyleModal(true), 250); }}
                >
                  <Text style={[s.styleChipTxt, { color: '#6C5CE7' }]}>+ Add Style</Text>
                </TouchableOpacity>
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setAddPageModal(false); setNewPageTitle(''); }}>
                  <Text style={s.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.createBtn, !newPageTitle.trim() && { opacity: 0.4 }]}
                  onPress={() => addPage(newPageTitle)}
                  disabled={!newPageTitle.trim()}
                >
                  <Text style={s.createBtnTxt}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <SharedModals />
      </SafeAreaView>
    );
  }

  // ── CHARACTER LIST ──
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.notesHeader, { paddingTop: insets.top + 16 }]}>
        {showSearch ? (
          <TextInput
            style={s.notesSearchInput}
            value={searchQ}
            onChangeText={setSearchQ}
            placeholder="Search character..."
            autoFocus
            onBlur={() => { if (!searchQ) setShowSearch(false); }}
          />
        ) : (
          <Text style={s.notesHeaderTitle}>≡  All Notes</Text>
        )}
        <TouchableOpacity onPress={() => setShowSearch(v => !v)}>
          <Text style={{ fontSize: 20 }}>🔍</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredChars}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item, index }) => {
          const charPages = allNotes[item.id] ?? [];
          const lastPage = charPages.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
          return (
            <TouchableOpacity style={s.noteCard} onPress={() => openChar(item)} activeOpacity={0.7}>
              <View style={[s.noteAccent, { backgroundColor: accent }]} />
              <View style={s.noteContent}>
                <Text style={s.noteTitle}>{item.emoji} {item.name}</Text>
                <View style={s.noteMetaRow}>
                  <Text style={s.noteDateTxt}>
                    {lastPage ? formatDate(lastPage.updatedAt) : 'No notes yet'}
                  </Text>
                  <Text style={s.notePreview} numberOfLines={1}>
                    {'  '}{charPages.length > 0
                      ? `${charPages.length} pages${lastPage?.content ? ' • ' + lastPage.content.slice(0, 40).replace(/\n/g, ' ') : ''}`
                      : '(Tap to add notes)'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <View style={s.notesBottomBar}>
        <TouchableOpacity style={s.notesBottomBtn} onPress={() => router.back()}>
          <Text style={s.notesBottomIcon}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.notesAddFab} onPress={() => router.replace('/')}>
          <Text style={{ fontSize: 22 }}>🏠</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.notesBottomBtn}>
          <Text style={s.notesBottomIcon}>→</Text>
        </TouchableOpacity>
      </View>

      <SharedModals />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  notesHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fff',
  },
  notesHeaderTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', flex: 1 },
  notesSearchInput: {
    flex: 1, fontSize: 16, color: '#111', paddingVertical: 4,
    borderBottomWidth: 1.5, borderBottomColor: '#F5A623',
  },
  notesBreadcrumb: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#fafafa',
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  breadcrumbBack: { color: '#555', fontSize: 13, fontWeight: '600' },
  breadcrumbCount: { color: '#aaa', fontSize: 12 },

  noteCard: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
    minHeight: 70, alignItems: 'center',
  },
  noteAccent: { width: 4, minHeight: 70 },
  noteContent: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center' },
  noteTitle: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 5 },
  noteMetaRow: { flexDirection: 'row', alignItems: 'center' },
  noteDateTxt: { fontSize: 12, color: '#888', fontWeight: '500', flexShrink: 0 },
  notePreview: { fontSize: 12, color: '#aaa', flex: 1 },
  noteDeleteBtn: { paddingHorizontal: 14, paddingVertical: 14 },
  noteDeleteIcon: { fontSize: 18 },

  emptyPages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyPagesIcon: { fontSize: 56, marginBottom: 14 },
  emptyPagesTxt: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 8 },
  emptyPagesSub: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 20 },

  notesBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 12, paddingHorizontal: 20, backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  notesBottomBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  notesBottomIcon: { fontSize: 22, color: '#888' },
  notesAddFab: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#F5A623', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  notesAddFabTxt: { color: '#fff', fontSize: 28, fontWeight: '300', marginTop: -2 },

  editorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fff',
  },
  editorBack: {},
  editorBackTxt: { fontSize: 16, color: '#555', fontWeight: '600' },
  editorSaveBtn: { backgroundColor: '#F5A623', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  editorSaveTxt: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  editorAccentBar: { height: 4 },
  editorTitleRow: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  editorTitleInput: { fontSize: 18, fontWeight: '700', color: '#111' },
  translateBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  translateBtn: {
    flex: 1, backgroundColor: '#1565C0', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
  },
  translateBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn2: {
    backgroundColor: '#fce4ec', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#ef9a9a',
  },
  clearBtn2Txt: { fontSize: 18 },
  errorBanner: { backgroundColor: '#FFEBEE', paddingHorizontal: 14, paddingVertical: 8 },
  errorBannerTxt: { color: '#C62828', fontSize: 13 },
  editorBody: {
    flex: 1, padding: 16, fontSize: 15, color: '#222', lineHeight: 24, textAlignVertical: 'top',
  },
  editorFooter: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#fafafa', borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  editorFooterTxt: { fontSize: 11, color: '#bbb' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-start', paddingTop: 60 },
  modalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 14 },
  modalInput: {
    borderBottomWidth: 2, borderBottomColor: '#F5A623',
    fontSize: 16, paddingVertical: 8, color: '#111', marginBottom: 16,
  },
  modalSubLabel: { fontSize: 12, color: '#aaa', marginBottom: 8, fontWeight: '600' },
  styleChip: {
    borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 8, backgroundColor: '#fff',
  },
  styleChipTxt: { fontSize: 12, fontWeight: '600' },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  cancelBtnTxt: { color: '#888', fontWeight: '600' },
  createBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F5A623', alignItems: 'center' },
  createBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  confirmBox: {
    backgroundColor: '#fff', borderRadius: 18, padding: 24, width: 300,
  },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 8 },
  confirmMsg: { fontSize: 14, color: '#555', marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  confirmCancelTxt: { color: '#555', fontWeight: '600' },
  confirmDelete: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#E53935', alignItems: 'center' },
  confirmDeleteTxt: { color: '#fff', fontWeight: '700' },

  translateModal: {
    backgroundColor: '#fff', borderRadius: 18, padding: 22, width: 320, maxHeight: '80%',
  },
  translateModalTitle: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 14 },
  translateModalText: { fontSize: 14, color: '#333', lineHeight: 22, marginBottom: 16 },
  translateModalBtns: { gap: 8 },
  translateModalBtn: { backgroundColor: '#27AE60', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  translateModalBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  optionsBox: {
    backgroundColor: '#fff', borderRadius: 18, padding: 20, width: 280,
  },
  optionsTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 14 },
  optionRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  optionRowTxt: { fontSize: 15, color: '#222', fontWeight: '500' },

  toast: {
    position: 'absolute', bottom: 80, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center',
  },
  toastTxt: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
