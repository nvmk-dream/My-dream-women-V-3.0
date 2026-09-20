import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ALL_PERSONAS, Persona } from "../constants/personas";
import { ParamsStore } from "../context/params-store";
import {
  addCharacterUrl,
  CharacterUrl,
  deleteCharacterUrl,
  getCharacterUrls,
  setCharacterUrlActive,
  updateCharacterUrl,
} from "../services/api";

export default function CharacterUrlsScreen() {
  const router = useRouter();
  const characterId = ParamsStore.getUrlPersonaId() ?? "";
  const [persona, setPersona] = useState<Persona | null>(null);
  const [urls, setUrls] = useState<CharacterUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingUrlId, setEditingUrlId] = useState<number | null>(null);
  const [draftUrl, setDraftUrl] = useState("");

  const load = useCallback(async () => {
    if (!characterId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const builtIn = ALL_PERSONAS.find((item) => item.id === characterId);
      let selected = builtIn;
      if (!selected) {
        const raw = await AsyncStorage.getItem("custom_personas_v1");
        const custom = raw ? JSON.parse(raw) : [];
        selected = Array.isArray(custom)
          ? custom.find((item: Persona) => item.id === characterId)
          : undefined;
      }
      setPersona(selected ?? null);
      setUrls(await getCharacterUrls(characterId));
    } catch (error: any) {
      Alert.alert("URLs load ஆகவில்லை", error?.message || "மீண்டும் try பண்ணுங்க.");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openEditor = (url?: CharacterUrl) => {
    setEditingUrlId(url?.id ?? null);
    setDraftUrl(url?.url ?? "");
    setEditorVisible(true);
  };

  const saveUrl = async () => {
    const value = draftUrl.trim();
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      Alert.alert("தவறான URL", "http:// அல்லது https:// URL enter பண்ணுங்க.");
      return;
    }

    setSaving(true);
    try {
      if (editingUrlId === null) {
        const created = await addCharacterUrl(characterId, value, urls.length);
        setUrls((current) => [...current, created]);
      } else {
        const updated = await updateCharacterUrl(characterId, editingUrlId, { url: value });
        setUrls((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      setEditorVisible(false);
      setDraftUrl("");
    } catch (error: any) {
      Alert.alert("Save ஆகவில்லை", error?.message || "மீண்டும் try பண்ணுங்க.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: CharacterUrl) => {
    setUrls((current) =>
      current.map((url) =>
        url.id === item.id ? { ...url, isActive: !item.isActive } : url,
      ),
    );
    try {
      const updated = await setCharacterUrlActive(
        characterId,
        item.id,
        !item.isActive,
      );
      setUrls((current) =>
        current.map((url) => (url.id === updated.id ? updated : url)),
      );
    } catch (error: any) {
      setUrls((current) =>
        current.map((url) =>
          url.id === item.id ? { ...url, isActive: item.isActive } : url,
        ),
      );
      Alert.alert("Status மாற்ற முடியவில்லை", error?.message || "மீண்டும் try பண்ணுங்க.");
    }
  };

  const deleteUrl = (item: CharacterUrl) => {
    Alert.alert("URL delete பண்ணட்டுமா?", item.url, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCharacterUrl(characterId, item.id);
            setUrls((current) => current.filter((url) => url.id !== item.id));
          } catch (error: any) {
            Alert.alert("Delete ஆகவில்லை", error?.message || "மீண்டும் try பண்ணுங்க.");
          }
        },
      },
    ]);
  };

  const moveUrl = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= urls.length) return;
    setUrls((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      const updated = await Promise.all(
        urls.map((item, index) =>
          updateCharacterUrl(characterId, item.id, { sortOrder: index }),
        ),
      );
      setUrls(updated.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
      Alert.alert("சேமிக்கப்பட்டது", "URL order save ஆகிவிட்டது.");
    } catch (error: any) {
      Alert.alert("Order save ஆகவில்லை", error?.message || "மீண்டும் try பண்ணுங்க.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Saved URLs</Text>
          <Text style={styles.subtitle}>{persona?.name ?? "Character"}</Text>
        </View>
        <TouchableOpacity onPress={() => openEditor()} style={styles.addButton}>
          <Text style={styles.addButtonText}>＋ Add</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#075E54" size="large" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>🔗 {persona?.name ?? "இந்த character"} URLs</Text>
              <Text style={styles.noticeText}>
                Active URLs மட்டும் Chat TXT-ல் வரிசையாக வரும். Disabled URL skip ஆகும்.
              </Text>
            </View>

            {urls.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🔗</Text>
                <Text style={styles.emptyTitle}>URL இன்னும் save செய்யவில்லை</Text>
                <Text style={styles.emptyText}>இந்த character-க்கு மட்டும் பயன்படுத்தப்படும் URL-ஐ add பண்ணுங்க.</Text>
                <TouchableOpacity style={styles.emptyButton} onPress={() => openEditor()}>
                  <Text style={styles.emptyButtonText}>＋ Add URL</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {urls.map((item, index) => (
                  <View key={item.id} style={[styles.urlCard, !item.isActive && styles.urlCardDisabled]}>
                    <View style={styles.orderColumn}>
                      <Text style={styles.orderText}>{index + 1}</Text>
                      <TouchableOpacity
                        onPress={() => moveUrl(index, -1)}
                        disabled={index === 0}
                        style={styles.arrowButton}
                      >
                        <Text style={[styles.arrowText, index === 0 && styles.muted]}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveUrl(index, 1)}
                        disabled={index === urls.length - 1}
                        style={styles.arrowButton}
                      >
                        <Text style={[styles.arrowText, index === urls.length - 1 && styles.muted]}>▼</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.urlCopy}>
                      <Text style={[styles.urlText, !item.isActive && styles.disabledText]} numberOfLines={3}>
                        {item.url}
                      </Text>
                      <Text style={[styles.statusText, item.isActive ? styles.activeText : styles.disabledText]}>
                        {item.isActive ? "● Active" : "○ Disabled"}
                      </Text>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity onPress={() => toggleActive(item)} style={styles.actionButton}>
                        <Text style={styles.actionText}>{item.isActive ? "Disable" : "Enable"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEditor(item)} style={styles.actionButton}>
                        <Text style={styles.actionText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteUrl(item)} style={[styles.actionButton, styles.deleteButton]}>
                        <Text style={styles.deleteText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity style={styles.saveOrderButton} onPress={saveOrder} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveOrderText}>💾 Save URL Order</Text>}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {editorVisible && (
        <View style={styles.editorOverlay}>
          <View style={styles.editor}>
            <Text style={styles.editorTitle}>{editingUrlId === null ? "Add URL" : "Edit URL"}</Text>
            <TextInput
              value={draftUrl}
              onChangeText={setDraftUrl}
              placeholder="https://example.com/..."
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              autoFocus
            />
            <View style={styles.editorActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditorVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={saveUrl} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f3f7f6" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#075E54",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  backButton: { paddingHorizontal: 8, paddingVertical: 2 },
  backText: { color: "#fff", fontSize: 34, lineHeight: 34 },
  headerCopy: { flex: 1, marginLeft: 6 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#d7f4ee", fontSize: 13, marginTop: 2 },
  addButton: { backgroundColor: "#25D366", borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  addButtonText: { color: "#073b35", fontSize: 13, fontWeight: "800" },
  body: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  notice: { backgroundColor: "#e6f4f1", borderRadius: 14, padding: 14, marginBottom: 14 },
  noticeTitle: { color: "#075E54", fontSize: 15, fontWeight: "800" },
  noticeText: { color: "#38655f", fontSize: 13, lineHeight: 19, marginTop: 5 },
  empty: { backgroundColor: "#fff", borderRadius: 18, padding: 28, alignItems: "center", marginTop: 12 },
  emptyIcon: { fontSize: 34, marginBottom: 10 },
  emptyTitle: { color: "#222", fontSize: 16, fontWeight: "800" },
  emptyText: { color: "#777", fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 6 },
  emptyButton: { backgroundColor: "#075E54", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, marginTop: 16 },
  emptyButtonText: { color: "#fff", fontWeight: "800" },
  urlCard: { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", elevation: 1 },
  urlCardDisabled: { opacity: 0.65 },
  orderColumn: { width: 34, alignItems: "center" },
  orderText: { color: "#075E54", fontSize: 18, fontWeight: "800" },
  arrowButton: { padding: 2 },
  arrowText: { color: "#075E54", fontSize: 12 },
  muted: { color: "#ccc" },
  urlCopy: { flex: 1, paddingHorizontal: 8 },
  urlText: { color: "#222", fontSize: 13, lineHeight: 18 },
  disabledText: { color: "#999" },
  statusText: { fontSize: 11, marginTop: 5, fontWeight: "700" },
  activeText: { color: "#16804c" },
  actions: { alignItems: "flex-end", gap: 5 },
  actionButton: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: "#e8f5e9" },
  actionText: { color: "#075E54", fontSize: 11, fontWeight: "700" },
  deleteButton: { backgroundColor: "#ffebee" },
  deleteText: { color: "#c62828", fontSize: 11, fontWeight: "700" },
  saveOrderButton: { backgroundColor: "#075E54", borderRadius: 13, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  saveOrderText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  editorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  editor: { backgroundColor: "#fff", borderRadius: 18, padding: 20 },
  editorTitle: { color: "#075E54", fontSize: 19, fontWeight: "800", marginBottom: 14 },
  input: { borderWidth: 1, borderColor: "#b7d8d2", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, color: "#222", fontSize: 15 },
  editorActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 11, paddingVertical: 12, alignItems: "center" },
  cancelText: { color: "#555", fontWeight: "700" },
  confirmButton: { flex: 1, backgroundColor: "#075E54", borderRadius: 11, paddingVertical: 12, alignItems: "center" },
  confirmText: { color: "#fff", fontWeight: "800" },
});