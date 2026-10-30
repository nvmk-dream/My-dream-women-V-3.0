import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import { openExternalHttpUrl } from "../utils/external-url";

export default function CharacterUrlsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const openSavedUrl = async (value: string) => {
    try {
      await openExternalHttpUrl(value);
    } catch (error: any) {
      Alert.alert("URL open ஆகவில்லை", error?.message || "Browser open ஆகவில்லை.");
    }
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
    <ImageBackground
      source={require("../assets/images/cloud_spring_bg.png")}
      style={styles.rootBackground}
      resizeMode="cover"
    >
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Glass Header Card */}
      <View style={[styles.headerCard, { marginTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.circleBtn}
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#6B46C1" />
        </TouchableOpacity>

        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>Saved URLs</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{persona?.name ?? "Character"}</Text>
        </View>

        <TouchableOpacity onPress={() => openEditor()} activeOpacity={0.85}>
          <LinearGradient
            colors={["#E024A5", "#8B5CF6"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.addBtnGradient}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
            <Text style={styles.addBtnText}>Add</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#E024A5" size="large" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Notice Card */}
            <View style={styles.noticeCard}>
              <View style={styles.noticeHeader}>
                <View style={styles.noticeIconCircle}>
                  <MaterialCommunityIcons name="link-variant" size={18} color="#E024A5" />
                </View>
                <Text style={styles.noticeTitle}>
                  {persona?.name ?? "இந்த character"} URLs
                </Text>
              </View>
              <Text style={styles.noticeText}>
                Active URLs மட்டும் Chat TXT-ல் வரிசையாக வரும். Disabled URL skip ஆகும்.
              </Text>
            </View>

            {urls.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons name="link-variant" size={32} color="#8B5CF6" />
                </View>
                <Text style={styles.emptyTitle}>URL இன்னும் save செய்யவில்லை</Text>
                <Text style={styles.emptyText}>
                  இந்த character-க்கு மட்டும் பயன்படுத்தப்படும் URL-ஐ add பண்ணுங்க.
                </Text>
                <TouchableOpacity onPress={() => openEditor()} activeOpacity={0.85} style={{ marginTop: 16 }}>
                  <LinearGradient
                    colors={["#E024A5", "#8B5CF6"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.emptyAddBtn}
                  >
                    <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
                    <Text style={styles.emptyAddBtnText}>Add URL</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {urls.map((item, index) => (
                  <View
                    key={item.id}
                    style={[styles.urlCard, !item.isActive && styles.urlCardDisabled]}
                  >
                    {/* Order Controls */}
                    <View style={styles.orderColumn}>
                      <View style={styles.orderBadge}>
                        <Text style={styles.orderText}>{index + 1}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => moveUrl(index, -1)}
                        disabled={index === 0}
                        style={styles.arrowButton}
                      >
                        <MaterialCommunityIcons
                          name="chevron-up"
                          size={20}
                          color={index === 0 ? "#CBD5E1" : "#7C3AED"}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveUrl(index, 1)}
                        disabled={index === urls.length - 1}
                        style={styles.arrowButton}
                      >
                        <MaterialCommunityIcons
                          name="chevron-down"
                          size={20}
                          color={index === urls.length - 1 ? "#CBD5E1" : "#7C3AED"}
                        />
                      </TouchableOpacity>
                    </View>

                    {/* URL Details */}
                    <View style={styles.urlCopy}>
                      <TouchableOpacity
                        onPress={() => openSavedUrl(item.url)}
                        accessibilityRole="link"
                        testID={`character-url-${item.id}`}
                      >
                        <Text
                          style={[styles.urlText, !item.isActive && styles.disabledText]}
                          numberOfLines={3}
                        >
                          {item.url}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.metaRow}>
                        <View style={[styles.statusBadge, item.isActive ? styles.statusActive : styles.statusDisabled]}>
                          <View style={[styles.statusDot, { backgroundColor: item.isActive ? "#059669" : "#94A3B8" }]} />
                          <Text style={[styles.statusBadgeText, { color: item.isActive ? "#065F46" : "#64748B" }]}>
                            {item.isActive ? "Active" : "Disabled"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Action Buttons */}
                    <View style={styles.actions}>
                      <TouchableOpacity
                        onPress={() => toggleActive(item)}
                        style={styles.actionPill}
                      >
                        <Text style={styles.actionPillText}>{item.isActive ? "Disable" : "Enable"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => openEditor(item)}
                        style={styles.actionPill}
                      >
                        <Text style={styles.actionPillText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => deleteUrl(item)}
                        style={[styles.actionPill, styles.deletePill]}
                      >
                        <Text style={styles.deletePillText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                {/* Save URL Order Button */}
                <TouchableOpacity
                  onPress={saveOrder}
                  disabled={saving}
                  activeOpacity={0.85}
                  style={{ marginTop: 10 }}
                >
                  <LinearGradient
                    colors={["#E024A5", "#8B5CF6"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.saveOrderGradient}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="content-save-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.saveOrderText}>Save URL Order</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Editor Modal */}
      {editorVisible && (
        <View style={styles.editorOverlay}>
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>
              {editingUrlId === null ? "Add URL" : "Edit URL"}
            </Text>
            <TextInput
              value={draftUrl}
              onChangeText={setDraftUrl}
              placeholder="https://example.com/..."
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              autoFocus
            />
            <View style={styles.editorActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setEditorVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveUrl}
                disabled={saving}
                style={{ flex: 1 }}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={["#E024A5", "#8B5CF6"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.confirmGradient}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.confirmText}>Save</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  rootBackground: {
    flex: 1,
  },
  headerCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.90)",
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  circleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#EDE9FE",
    borderWidth: 1,
    borderColor: "#C4B5FD",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    color: "#18204E",
    fontSize: 18,
    fontWeight: "800",
  },
  subtitle: {
    color: "#7C3AED",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  addBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: "#E024A5",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  body: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  noticeCard: {
    backgroundColor: "rgba(255, 255, 255, 0.90)",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    padding: 14,
    marginBottom: 12,
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  noticeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  noticeIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FCE7F3",
    alignItems: "center",
    justifyContent: "center",
  },
  noticeTitle: {
    color: "#18204E",
    fontSize: 14,
    fontWeight: "800",
    flex: 1,
  },
  noticeText: {
    color: "#475569",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: "rgba(255, 255, 255, 0.90)",
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    padding: 30,
    alignItems: "center",
    marginTop: 14,
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    color: "#18204E",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyText: {
    color: "#64748B",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 6,
  },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  emptyAddBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  urlCard: {
    backgroundColor: "rgba(255, 255, 255, 0.90)",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  urlCardDisabled: {
    opacity: 0.62,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  orderColumn: {
    width: 34,
    alignItems: "center",
  },
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  orderText: {
    color: "#6B46C1",
    fontSize: 13,
    fontWeight: "800",
  },
  arrowButton: {
    padding: 2,
  },
  urlCopy: {
    flex: 1,
    paddingHorizontal: 10,
  },
  urlText: {
    color: "#18204E",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  disabledText: {
    color: "#94A3B8",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusActive: {
    backgroundColor: "#D1FAE5",
  },
  statusDisabled: {
    backgroundColor: "#F1F5F9",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  actions: {
    alignItems: "flex-end",
    gap: 6,
  },
  actionPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "#EDE9FE",
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  actionPillText: {
    color: "#6B46C1",
    fontSize: 11,
    fontWeight: "700",
  },
  deletePill: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FECACA",
  },
  deletePillText: {
    color: "#DC2626",
    fontSize: 11,
    fontWeight: "700",
  },
  saveOrderGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    paddingVertical: 14,
    shadowColor: "#E024A5",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveOrderText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  editorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 20,
    zIndex: 100,
  },
  editorCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.5,
    borderColor: "#EDE9FE",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  editorTitle: {
    color: "#18204E",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 14,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#DDD6FE",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#18204E",
    fontSize: 14,
    backgroundColor: "rgba(248, 250, 252, 0.9)",
  },
  editorActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  cancelText: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 14,
  },
  confirmGradient: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
});