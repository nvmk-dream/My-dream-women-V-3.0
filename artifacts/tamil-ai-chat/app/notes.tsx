import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, Modal, ScrollView, KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator, Pressable,
  ImageBackground,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALL_PERSONAS } from '../constants/personas';
import { getCloudinaryMeta, setCloudinaryMeta, getPhotoStyles, type PhotoStyleRecord } from '../services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const NOTE_CATEGORIES = ['General Notes', 'Chat Ideas', 'Prompts', 'Story Ideas'];

const ACCENT_COLORS = ['#F5A623', '#E91E8C', '#4A90D9', '#27AE60', '#9B59B6', '#E53935', '#FF7043', '#00ACC1', '#8D6E63', '#558B2F'];

type Page = { id: string; title: string; content: string; updatedAt: number; accent?: string };
type CharNotes = Record<string, Page[]>;
type PersonaMerged = (typeof ALL_PERSONAS)[0] & { avatarPhotoUri?: string };
type NotesOwner = { id: string; name: string; emoji?: string };

const STORAGE_KEY = 'character_notes_v2';
const USER_NOTES_ID = 'user_notes';
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

type NotesBottomNavProps = {
  onBack: () => void;
  onMiddle: () => void;
  middleIcon: string;
  onRight?: () => void;
  rightIcon: string;
  middleIsFab?: boolean;
};

function NotesBottomNav({
  onBack, onMiddle, middleIcon, onRight, rightIcon, middleIsFab = false,
}: NotesBottomNavProps) {
  return (
    <SafeAreaView style={s.bottomNavSafe} edges={['bottom']}>
      <View style={s.notesBottomBar}>
        <TouchableOpacity testID="notes-nav-back" style={s.notesNavBtn} onPress={onBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
        </TouchableOpacity>
        <TouchableOpacity
          testID={middleIsFab ? 'notes-nav-add' : 'notes-nav-home'}
          style={s.notesNavCenterSlot}
          onPress={onMiddle}
        >
          {middleIsFab ? (
            <LinearGradient
              colors={['#E024A5', '#8B5CF6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.notesAddFab}
            >
              <MaterialCommunityIcons name="plus" size={26} color="#FFFFFF" />
            </LinearGradient>
          ) : (
            <View style={s.notesHomeBtn}>
              <MaterialCommunityIcons name="home-variant-outline" size={22} color="#6B46C1" />
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity testID="notes-nav-right" style={s.notesNavBtn} onPress={onRight}>
          <MaterialCommunityIcons name="dots-horizontal" size={22} color="#6B46C1" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<'chars' | 'pages' | 'editor'>('chars');
  const [allNotes, setAllNotes] = useState<CharNotes>({});
  const [personas, setPersonas] = useState<PersonaMerged[]>(ALL_PERSONAS as PersonaMerged[]);
  const [photoStyles, setPhotoStyles] = useState<PhotoStyleRecord[]>([]);
  const [activeChar, setActiveChar] = useState<NotesOwner | null>(null);
  const [userNotesName, setUserNotesName] = useState('User');
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
      const savedUserName = await AsyncStorage.getItem('user_name').catch(() => null);
      if (savedUserName?.trim()) setUserNotesName(savedUserName.trim());
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
      setPhotoStyles(await getPhotoStyles());
    } catch {}
  }, []);

  useEffect(() => { reloadShared(); }, [reloadShared]);
  useEffect(() => {
    if (view === 'chars' || view === 'pages') reloadShared();
  }, [view, reloadShared]);

  // Notes can use styles, but Settings is the only place that manages them.
  const ALL_STYLES = [...NOTE_CATEGORIES, ...photoStyles.map(s => s.name)];

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

  const openChar = (persona: NotesOwner) => { setActiveChar(persona); setSearchQ(''); setShowSearch(false); setView('pages'); };

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

  const userNotesOwner: NotesOwner = { id: USER_NOTES_ID, name: userNotesName, emoji: '👤' };
  const allNotesOwners: NotesOwner[] = [userNotesOwner, ...personas];
  const filteredChars = allNotesOwners.filter(p => !searchQ || p.name.toLowerCase().includes(searchQ.toLowerCase()));
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
      <ImageBackground
        source={require('../assets/images/cloud_spring_bg.png')}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        <SafeAreaView style={s.safe} edges={['bottom']}>
          <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
          <Stack.Screen options={{ headerShown: false }} />

          {/* Glass Header */}
          <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 6 : 14 }]}>
            <View style={s.headerCard}>
              <TouchableOpacity onPress={async () => { await savePage(); setView('pages'); }} style={s.backBtn}>
                <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
              </TouchableOpacity>
              <View style={s.headerCenter}>
                <Text style={s.headerTitle} numberOfLines={1}>{activeChar.name}</Text>
                <Text style={s.headerSub} numberOfLines={1}>{activePage.title || 'Note Editor'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TouchableOpacity onPress={savePage} style={s.savePillBtn} activeOpacity={0.85}>
                  <LinearGradient
                    colors={['#E024A5', '#8B5CF6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.savePillGradient}
                  >
                    <Text style={s.savePillTxt}>Save</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deletePage(activePage)} style={s.actionCircleBtn}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={s.editorCard}>
            <View style={[s.editorAccentBar, { backgroundColor: activePage.accent ?? '#F5A623' }]} />

            <View style={s.editorTitleRow}>
              <TextInput
                style={s.editorTitleInput}
                value={editorTitle}
                onChangeText={setEditorTitle}
                placeholder="Title..."
                placeholderTextColor="#9CA3AF"
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
                <MaterialCommunityIcons name="eraser" size={18} color="#C62828" />
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
                placeholderTextColor="#9CA3AF"
              />
            </KeyboardAvoidingView>

            <View style={s.editorFooter}>
              <Text style={s.editorFooterTxt}>{editorText.length} chars</Text>
              <Text style={s.editorFooterTxt}>{formatDate(activePage.updatedAt)}</Text>
            </View>
          </View>

          <SharedModals />
        </SafeAreaView>
      </ImageBackground>
    );
  }

  // ── PAGES LIST ──
  if (view === 'pages' && activeChar) {
    return (
      <ImageBackground
        source={require('../assets/images/cloud_spring_bg.png')}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        <SafeAreaView style={s.safe} edges={['left', 'right']}>
          <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
          <Stack.Screen options={{ headerShown: false }} />

          {/* Glass Header */}
          <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 6 : 14 }]}>
            <View style={s.headerCard}>
              <TouchableOpacity
                onPress={() => { setView('chars'); setActiveChar(null); setSearchQ(''); setShowSearch(false); }}
                style={s.backBtn}
              >
                <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
              </TouchableOpacity>
              {showSearch ? (
                <TextInput
                  style={s.notesSearchInput}
                  value={searchQ}
                  onChangeText={setSearchQ}
                  placeholder="Search notes..."
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  onBlur={() => { if (!searchQ) setShowSearch(false); }}
                />
              ) : (
                <View style={s.headerCenter}>
                  <Text style={s.headerTitle} numberOfLines={1}>{activeChar.emoji} {activeChar.name}</Text>
                  <Text style={s.headerSub}>{filteredPages.length} notes saved</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setShowSearch(v => !v)} style={s.actionCircleBtn}>
                  <MaterialCommunityIcons name="magnify" size={20} color="#6B46C1" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowOptionsModal(true)} style={s.actionCircleBtn}>
                  <MaterialCommunityIcons name="dots-vertical" size={20} color="#6B46C1" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={s.notesContent}>
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
              style={s.notesList}
              contentContainerStyle={{ paddingBottom: insets.bottom + 16, paddingTop: 4 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.noteCard}
                  onPress={() => openPage(item)}
                  onLongPress={() => setLongPressPage(item)}
                  activeOpacity={0.75}
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
                    <MaterialCommunityIcons name="trash-can-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          )}

          </View>

          <NotesBottomNav
            onBack={() => { setView('chars'); setActiveChar(null); }}
            onMiddle={() => setAddPageModal(true)}
            middleIcon="+"
            middleIsFab
            onRight={() => router.replace('/')}
            rightIcon="🏠"
          />

          <Modal visible={addPageModal} transparent animationType="slide" onRequestClose={() => setAddPageModal(false)}>
            <View style={s.modalOverlay}>
              <View style={s.modalBox}>
                <Text style={s.modalTitle}>New Note</Text>
                <TextInput
                  style={s.modalInput}
                  value={newPageTitle}
                  onChangeText={setNewPageTitle}
                  placeholder="Note title..."
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  onSubmitEditing={() => newPageTitle.trim() && addPage(newPageTitle)}
                />
                <Text style={s.modalSubLabel}>Quick photo styles:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  {ALL_STYLES.map((st, i) => {
                    const accent = ACCENT_COLORS[i % ACCENT_COLORS.length];
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
      </ImageBackground>
    );
  }

  // ── CHARACTER LIST ──
  return (
    <ImageBackground
      source={require('../assets/images/cloud_spring_bg.png')}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <SafeAreaView style={s.safe} edges={['left', 'right']}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

        {/* Glass Header */}
        <View style={[s.headerWrap, { paddingTop: insets.top > 0 ? 6 : 14 }]}>
          <View style={s.headerCard}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <MaterialCommunityIcons name="chevron-left" size={26} color="#6B46C1" />
            </TouchableOpacity>
            {showSearch ? (
              <TextInput
                style={s.notesSearchInput}
                value={searchQ}
                onChangeText={setSearchQ}
                placeholder="Search character..."
                placeholderTextColor="#9CA3AF"
                autoFocus
                onBlur={() => { if (!searchQ) setShowSearch(false); }}
              />
            ) : (
              <View style={s.headerCenter}>
                <Text style={s.headerTitle}>Notes</Text>
                <Text style={s.headerSub}>Characters & Story Notes</Text>
              </View>
            )}
            <TouchableOpacity onPress={() => setShowSearch(v => !v)} style={s.actionCircleBtn}>
              <MaterialCommunityIcons name="magnify" size={20} color="#6B46C1" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.notesContent}>
        <FlatList
          data={filteredChars}
          keyExtractor={p => p.id}
          style={s.notesList}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16, paddingTop: 4 }}
          renderItem={({ item, index }) => {
            const charPages = allNotes[item.id] ?? [];
            const lastPage = charPages.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
            return (
              <TouchableOpacity style={s.noteCard} onPress={() => openChar(item)} activeOpacity={0.75}>
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
                <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" style={{ marginRight: 12 }} />
              </TouchableOpacity>
            );
          }}
        />

        </View>

        <NotesBottomNav
          onBack={() => router.back()}
          onMiddle={() => router.replace('/')}
          middleIcon="🏠"
          onRight={() => {}}
          rightIcon="→"
        />

        <SharedModals />
      </SafeAreaView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  headerWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  headerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.90)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EDE9FE',
    borderWidth: 1.2,
    borderColor: '#C4B5FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EDE9FE',
    borderWidth: 1.2,
    borderColor: '#C4B5FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#18204E', letterSpacing: 0.3 },
  headerSub: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  notesSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#18204E',
    paddingVertical: 4,
    marginHorizontal: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: '#9333EA',
  },
  savePillBtn: { borderRadius: 16, overflow: 'hidden' },
  savePillGradient: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 },
  savePillTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  editorCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 22,
    margin: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  editorAccentBar: { height: 4 },
  editorTitleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226, 232, 240, 0.8)',
  },
  editorTitleInput: { fontSize: 18, fontWeight: '800', color: '#18204E' },
  translateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226, 232, 240, 0.8)',
  },
  translateBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  translateBtnTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  clearBtn2: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: { backgroundColor: '#FEE2E2', paddingHorizontal: 14, paddingVertical: 8 },
  errorBannerTxt: { color: '#DC2626', fontSize: 13 },
  editorBody: {
    flex: 1,
    padding: 16,
    fontSize: 15,
    color: '#1E293B',
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  editorFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.8)',
  },
  editorFooterTxt: { fontSize: 11, color: '#64748B', fontWeight: '600' },

  noteCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    marginHorizontal: 14,
    marginVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    minHeight: 72,
    alignItems: 'center',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  noteAccent: { width: 5, height: '100%', minHeight: 72 },
  noteContent: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  noteTitle: { fontSize: 16, fontWeight: '800', color: '#18204E', marginBottom: 4 },
  noteMetaRow: { flexDirection: 'row', alignItems: 'center' },
  noteDateTxt: { fontSize: 11, color: '#7C3AED', fontWeight: '700', flexShrink: 0 },
  notePreview: { fontSize: 12, color: '#4B5563', flex: 1 },
  noteDeleteBtn: { paddingHorizontal: 14, paddingVertical: 14 },

  emptyPages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyPagesIcon: { fontSize: 56, marginBottom: 14 },
  emptyPagesTxt: { fontSize: 18, fontWeight: '800', color: '#18204E', marginBottom: 8 },
  emptyPagesSub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  notesContent: { flex: 1, minHeight: 0 },
  notesList: { flex: 1 },
  bottomNavSafe: { backgroundColor: 'transparent' },
  notesBottomBar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 24,
    marginHorizontal: 16,
    marginBottom: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
    paddingHorizontal: 12,
  },
  notesNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notesNavCenterSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesHomeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#C4B5FD',
  },
  notesAddFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#E91E8C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-start', paddingTop: 60 },
  modalBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#18204E', marginBottom: 14 },
  modalInput: {
    borderBottomWidth: 2,
    borderBottomColor: '#9333EA',
    fontSize: 16,
    paddingVertical: 8,
    color: '#18204E',
    marginBottom: 16,
  },
  modalSubLabel: { fontSize: 12, color: '#6B7280', marginBottom: 8, fontWeight: '700' },
  styleChip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#FFFFFF',
  },
  styleChipTxt: { fontSize: 12, fontWeight: '700' },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelBtnTxt: { color: '#64748B', fontWeight: '700' },
  createBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#9333EA',
    alignItems: 'center',
  },
  createBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  confirmBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    width: 310,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  confirmTitle: { fontSize: 17, fontWeight: '800', color: '#18204E', marginBottom: 8 },
  confirmMsg: { fontSize: 14, color: '#4B5563', marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  confirmCancelTxt: { color: '#4B5563', fontWeight: '700' },
  confirmDelete: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center' },
  confirmDeleteTxt: { color: '#FFFFFF', fontWeight: '800' },

  translateModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    width: 320,
    maxHeight: '80%',
  },
  translateModalTitle: { fontSize: 17, fontWeight: '800', color: '#18204E', marginBottom: 14 },
  translateModalText: { fontSize: 14, color: '#334155', lineHeight: 22, marginBottom: 16 },
  translateModalBtns: { gap: 8 },
  translateModalBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  translateModalBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  optionsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    width: 280,
  },
  optionsTitle: { fontSize: 16, fontWeight: '800', color: '#18204E', marginBottom: 14 },
  optionRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  optionRowTxt: { fontSize: 15, color: '#1E293B', fontWeight: '600' },

  toast: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(24, 32, 78, 0.9)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  toastTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
