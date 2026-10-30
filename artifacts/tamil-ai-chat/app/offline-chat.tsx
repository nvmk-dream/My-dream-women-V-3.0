import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  ImageBackground,
  StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ALL_PERSONAS } from "../constants/personas";
import { ParamsStore } from "../context/params-store";
import {
  isModelDownloaded,
  downloadModel,
  loadModel,
  isModelLoaded,
  chatOffline,
  unloadModel,
  deleteModel,
  MODEL_SIZE_LABEL,
  DownloadProgress,
} from "../services/llama-offline";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
}

type ScreenState = "checking" | "need-download" | "downloading" | "loading-model" | "ready" | "error";

export default function OfflineChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const personaId = ParamsStore.getOfflineChatPersonaId?.() ?? null;
  const persona = personaId ? ALL_PERSONAS.find((p) => p.id === personaId) : undefined;
  const personaName = persona?.name ?? "AI";
  const personaDesc = persona?.description ?? persona?.relationship ?? "";

  const STORAGE_KEY = `offline_ai_msgs_${personaId ?? "default"}`;

  const [screen, setScreen] = useState<ScreenState>("checking");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [dlProgress, setDlProgress] = useState<DownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const listRef = useRef<FlatList>(null);

  // ── Initial check ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const downloaded = await isModelDownloaded();
        if (!downloaded) {
          setScreen("need-download");
          return;
        }
        if (!isModelLoaded()) {
          setScreen("loading-model");
          await loadModel();
        }
        await loadHistory();
        setScreen("ready");
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Unknown error");
        setScreen("error");
      }
    })();
    return () => {
      unloadModel().catch(() => {});
    };
  }, []);

  const loadHistory = async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    if (raw) {
      setMessages(JSON.parse(raw));
    } else {
      const welcome: Msg = {
        id: "w0",
        role: "assistant",
        text:
          persona?.greeting?.trim() ||
          `வணக்கம்! நான் ${personaName}. Offline-ல் chat பண்ணலாம்! 🤗`,
      };
      setMessages([welcome]);
    }
  };

  const save = (msgs: Msg[]) =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs)).catch(() => {});

  // ── Download model ─────────────────────────────────────────────
  const startDownload = useCallback(async () => {
    setScreen("downloading");
    setDlProgress(null);
    try {
      await downloadModel((p) => setDlProgress(p));
      setScreen("loading-model");
      await loadModel();
      await loadHistory();
      setScreen("ready");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Download failed");
      setScreen("error");
    }
  }, []);

  // ── Send message ───────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput("");

    const userMsg: Msg = { id: Date.now().toString(), role: "user", text };
    const next = [...messages, userMsg];
    setMessages(next);
    save(next);
    setTyping(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const history = next.map((m) => ({ role: m.role, content: m.text }));
      const reply = await chatOffline(text, history, personaName, personaDesc);
      const botMsg: Msg = { id: (Date.now() + 1).toString(), role: "assistant", text: reply };
      const final = [...next, botMsg];
      setMessages(final);
      save(final);
    } catch (e: any) {
      const errMsg: Msg = {
        id: (Date.now() + 2).toString(),
        role: "assistant",
        text: "மன்னிக்கவும், ஒரு error வந்துச்சு. மீண்டும் try பண்ணுங்க. 😔",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setTyping(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, typing, messages, personaName, personaDesc]);

  // ── Delete model ───────────────────────────────────────────────
  const handleDeleteModel = async () => {
    setShowDeleteModal(false);
    await unloadModel().catch(() => {});
    await deleteModel().catch(() => {});
    setMessages([]);
    setScreen("need-download");
  };

  const renderMsg = ({ item }: { item: Msg }) => {
    const isUser = item.role === "user";
    if (isUser) {
      return (
        <View style={s.userBubbleContainer}>
          <LinearGradient
            colors={["#8B5CF6", "#7C3AED"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.userBubble}
          >
            <Text style={s.userTxt}>{item.text}</Text>
          </LinearGradient>
        </View>
      );
    }
    return (
      <View style={s.botBubbleContainer}>
        <View style={s.botBubble}>
          <Text style={s.botTxt}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <ImageBackground
      source={require("../assets/images/cloud_spring_bg.png")}
      style={s.rootBackground}
      resizeMode="cover"
    >
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Glass Header Card */}
      <View style={[s.headerCard, { marginTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.circleBtn}
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#6B46C1" />
        </TouchableOpacity>

        <View style={s.headerCopy}>
          <View style={s.headerTitleRow}>
            <Text style={s.headerTitle} numberOfLines={1}>{personaName}</Text>
            <View style={s.offlineChip}>
              <MaterialCommunityIcons name="robot" size={12} color="#7C3AED" />
              <Text style={s.offlineChipText}>Offline</Text>
            </View>
          </View>
          <Text style={s.headerSubtitle} numberOfLines={1}>
            {screen === "ready" ? "Device AI Active" : "On-Device Engine"}
          </Text>
        </View>

        {screen === "ready" ? (
          <TouchableOpacity
            onPress={() => setShowDeleteModal(true)}
            style={s.trashBtn}
            accessibilityLabel="Delete Model"
          >
            <MaterialCommunityIcons name="trash-can-outline" size={20} color="#DC2626" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* ── Checking / Loading Model Screen ──────────────────────────────────────── */}
      {(screen === "checking" || screen === "loading-model") && (
        <View style={s.centerWrap}>
          <View style={s.glassStatusCard}>
            <ActivityIndicator size="large" color="#E024A5" />
            <Text style={s.statusTitle}>
              {screen === "loading-model" ? "AI Model load ஆகுது..." : "சரிபார்க்கிறேன்..."}
            </Text>
            <Text style={s.statusSub}>சற்று நேரம் பொறுங்க 🙏</Text>
          </View>
        </View>
      )}

      {/* ── Need Download Screen ─────────────────────────────────────────────────── */}
      {screen === "need-download" && (
        <View style={s.centerWrap}>
          <View style={s.glassDownloadCard}>
            <View style={s.iconCircleLg}>
              <MaterialCommunityIcons name="robot" size={38} color="#8B5CF6" />
            </View>
            <Text style={s.downloadTitle}>Offline AI Download</Text>
            <Text style={s.downloadDesc}>
              இந்த AI model device-ல் download ஆகும்.{"\n"}
              Download ஆனதும் internet இல்லாம் chat பண்ணலாம்!
            </Text>

            <View style={s.infoPillsContainer}>
              <View style={s.infoPill}>
                <MaterialCommunityIcons name="package-variant-closed" size={16} color="#7C3AED" />
                <Text style={s.infoPillText}>Size: {MODEL_SIZE_LABEL}</Text>
              </View>
              <View style={s.infoPill}>
                <MaterialCommunityIcons name="wifi" size={16} color="#7C3AED" />
                <Text style={s.infoPillText}>WiFi use பண்ணுங்க</Text>
              </View>
              <View style={s.infoPill}>
                <MaterialCommunityIcons name="cellphone-check" size={16} color="#7C3AED" />
                <Text style={s.infoPillText}>One-time download மட்டும்</Text>
              </View>
            </View>

            <TouchableOpacity onPress={startDownload} activeOpacity={0.85} style={{ width: "100%", marginTop: 18 }}>
              <LinearGradient
                colors={["#E024A5", "#8B5CF6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.gradientActionBtn}
              >
                <MaterialCommunityIcons name="download" size={20} color="#FFFFFF" />
                <Text style={s.gradientActionBtnText}>Download & Install</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={s.secondaryBackBtn} onPress={() => router.back()}>
              <Text style={s.secondaryBackText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Downloading Screen ───────────────────────────────────────────────────── */}
      {screen === "downloading" && (() => {
        const pct = dlProgress ? Math.round(dlProgress.progress * 100) : 0;
        const mb = dlProgress ? (dlProgress.bytesWritten / 1_000_000).toFixed(0) : "0";
        const total = dlProgress && dlProgress.totalBytes > 0
          ? (dlProgress.totalBytes / 1_000_000).toFixed(0)
          : "?";
        return (
          <View style={s.centerWrap}>
            <View style={s.glassDownloadCard}>
              <View style={s.iconCircleLg}>
                <MaterialCommunityIcons name="cloud-download" size={38} color="#E024A5" />
              </View>
              <Text style={s.downloadTitle}>Download ஆகுது...</Text>
              <Text style={s.downloadSub}>{mb} MB / {total} MB</Text>

              <View style={s.progressBarTrack}>
                <LinearGradient
                  colors={["#E024A5", "#8B5CF6"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[s.progressBarFill, { width: `${Math.max(4, pct)}%` as any }]}
                />
              </View>

              <Text style={s.pctNumber}>{pct}%</Text>
              <Text style={s.friendlyNote}>App close பண்ணாதீங்க! 🙏</Text>
            </View>
          </View>
        );
      })()}

      {/* ── Error Screen ─────────────────────────────────────────────────────────── */}
      {screen === "error" && (
        <View style={s.centerWrap}>
          <View style={s.glassDownloadCard}>
            <View style={[s.iconCircleLg, { backgroundColor: "#FEE2E2" }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={38} color="#DC2626" />
            </View>
            <Text style={s.downloadTitle}>Error வந்துச்சு</Text>
            <Text style={s.downloadDesc}>{errorMsg}</Text>

            <TouchableOpacity
              onPress={() => setScreen("need-download")}
              activeOpacity={0.85}
              style={{ width: "100%", marginTop: 16 }}
            >
              <LinearGradient
                colors={["#E024A5", "#8B5CF6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.gradientActionBtn}
              >
                <MaterialCommunityIcons name="reload" size={18} color="#FFFFFF" />
                <Text style={s.gradientActionBtnText}>மீண்டும் Try பண்ணு</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={s.secondaryBackBtn} onPress={() => router.back()}>
              <Text style={s.secondaryBackText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Ready Chat Screen ────────────────────────────────────────────────────── */}
      {screen === "ready" && (
        <View style={s.chatBody}>
          <View style={s.badgePillContainer}>
            <View style={s.badgePill}>
              <MaterialCommunityIcons name="shield-check" size={14} color="#059669" />
              <Text style={s.badgePillText}>Offline AI — Device-ல் முற்றிலும் பாதுகாப்பானது</Text>
            </View>
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMsg}
            contentContainerStyle={[s.chatList, { paddingBottom: 16 }]}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
          />

          {typing && (
            <View style={s.typingContainer}>
              <View style={s.typingPill}>
                <ActivityIndicator size="small" color="#8B5CF6" style={{ marginRight: 6 }} />
                <Text style={s.typingTxt}>{personaName} யோசிக்கிறா...</Text>
              </View>
            </View>
          )}

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
          >
            <View style={[s.inputGlassBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TextInput
                style={s.chatInput}
                value={input}
                onChangeText={setInput}
                placeholder="Message..."
                placeholderTextColor="#94A3B8"
                onSubmitEditing={send}
                returnKeyType="send"
                editable={!typing}
              />
              <TouchableOpacity
                onPress={send}
                disabled={typing || !input.trim()}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={typing || !input.trim() ? ["#CBD5E1", "#94A3B8"] : ["#E024A5", "#8B5CF6"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.sendCircleBtn}
                >
                  <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* Delete Model Confirmation Modal */}
      <Modal visible={showDeleteModal} transparent animationType="fade">
        <Pressable style={s.modalBg} onPress={() => setShowDeleteModal(false)}>
          <Pressable style={s.modalGlassCard}>
            <View style={s.modalIconCircle}>
              <MaterialCommunityIcons name="trash-can-outline" size={28} color="#DC2626" />
            </View>
            <Text style={s.modalTitle}>Model Delete பண்ணட்டுமா?</Text>
            <Text style={s.modalDesc}>
              Device-ல் உள்ள AI model delete ஆகும்.{"\n"}
              மீண்டும் use பண்ண download வேணும் ({MODEL_SIZE_LABEL}).
            </Text>
            <View style={s.modalBtns}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowDeleteModal(false)}
              >
                <Text style={s.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalDeleteBtn}
                onPress={handleDeleteModel}
              >
                <Text style={s.modalDeleteTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
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
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    color: "#18204E",
    fontSize: 18,
    fontWeight: "800",
  },
  offlineChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  offlineChipText: {
    color: "#6B46C1",
    fontSize: 10,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: "#7C3AED",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  trashBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    justifyContent: "center",
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  glassStatusCard: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 22,
    padding: 28,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
    width: "86%",
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#18204E",
    marginTop: 16,
    textAlign: "center",
  },
  statusSub: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 6,
  },
  glassDownloadCard: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 5,
    width: "100%",
  },
  iconCircleLg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  downloadTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#18204E",
    marginBottom: 6,
    textAlign: "center",
  },
  downloadDesc: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  downloadSub: {
    fontSize: 15,
    fontWeight: "700",
    color: "#7C3AED",
    marginBottom: 12,
  },
  infoPillsContainer: {
    width: "100%",
    gap: 8,
    marginVertical: 6,
  },
  infoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(243, 232, 255, 0.6)",
    borderWidth: 1,
    borderColor: "#E9D5FF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  infoPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4C1D95",
  },
  gradientActionBtn: {
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
  gradientActionBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryBackBtn: {
    paddingVertical: 12,
    marginTop: 4,
  },
  secondaryBackText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "700",
  },
  progressBarTrack: {
    width: "100%",
    height: 12,
    backgroundColor: "#E2E8F0",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 6,
  },
  pctNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: "#E024A5",
    marginBottom: 6,
  },
  friendlyNote: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
  },
  // Ready chat styles
  chatBody: {
    flex: 1,
  },
  badgePillContainer: {
    alignItems: "center",
    marginBottom: 6,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  badgePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
  },
  chatList: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  userBubbleContainer: {
    alignItems: "flex-end",
    marginBottom: 8,
  },
  userBubble: {
    maxWidth: "82%",
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 15,
    paddingVertical: 10,
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  userTxt: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  botBubbleContainer: {
    alignItems: "flex-start",
    marginBottom: 8,
  },
  botBubble: {
    maxWidth: "82%",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  botTxt: {
    color: "#18204E",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  typingPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.95)",
  },
  typingTxt: {
    color: "#6B46C1",
    fontSize: 12,
    fontWeight: "600",
    fontStyle: "italic",
  },
  inputGlassBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 12,
    paddingTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  chatInput: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontSize: 15,
    color: "#18204E",
    maxHeight: 100,
  },
  sendCircleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalGlassCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 24,
    padding: 24,
    width: "88%",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#EDE9FE",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#18204E",
    marginBottom: 8,
    textAlign: "center",
  },
  modalDesc: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 19,
    marginBottom: 20,
    textAlign: "center",
  },
  modalBtns: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalCancelBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  modalCancelTxt: {
    color: "#64748B",
    fontWeight: "700",
  },
  modalDeleteBtn: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#DC2626",
    paddingVertical: 12,
    alignItems: "center",
  },
  modalDeleteTxt: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
