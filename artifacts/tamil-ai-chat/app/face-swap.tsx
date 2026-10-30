import { Stack, useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  ImageBackground,
  NativeModules,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

type FaceSwapBridge = {
  openFaceSwap: () => Promise<boolean>;
};

export default function FaceSwapRoute() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const launchStudio = () => {
    setError("");
    setRetrying(true);

    if (Platform.OS !== "android") {
      setError("The on-device Face Swap screen is available in the Android app.");
      setRetrying(false);
      return;
    }

    const bridge = NativeModules.FaceSwapStudio as FaceSwapBridge | undefined;
    if (!bridge || typeof bridge.openFaceSwap !== "function") {
      setError("The native Face Swap module is not available in this build. Please generate an APK build with the native studio plugin.");
      setRetrying(false);
      return;
    }

    bridge
      .openFaceSwap()
      .then(() => {
        router.back();
      })
      .catch((err) => {
        const msg = err?.message || "Could not open the on-device Face Swap screen.";
        setError(msg);
      })
      .finally(() => {
        setRetrying(false);
      });
  };

  useEffect(() => {
    launchStudio();
  }, []);

  return (
    <ImageBackground
      source={require("../assets/images/cloud_spring_bg.png")}
      style={styles.bgImage}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <Stack.Screen options={{ headerShown: false }} />

        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#18204E" />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Face Swap Studio</Text>
            <Text style={styles.headerSubtitle}>On-Device AI Engine</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        {/* Center Frosted Glass Card */}
        <Animated.View style={[styles.centerWrap, { opacity: fadeAnim }]}>
          <View style={styles.glassCard}>
            <LinearGradient
              colors={["rgba(255, 255, 255, 0.96)", "rgba(255, 248, 250, 0.88)"]}
              style={styles.glassGradient}
            >
              {error ? (
                <>
                  <View style={styles.errorIconWrap}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#E11D48" />
                  </View>
                  <Text style={styles.cardTitle}>Face Swap Could Not Open</Text>
                  <Text style={styles.cardMsg}>{error}</Text>

                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={launchStudio}
                      disabled={retrying}
                      style={styles.primaryBtn}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={["#E91E8C", "#D81B60"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.btnGradient}
                      >
                        {retrying ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
                            <Text style={styles.primaryBtnText}>Retry</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => router.back()}
                      style={styles.secondaryBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.secondaryBtnText}>Back to App</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.iconGlowWrap}>
                    <LinearGradient
                      colors={["rgba(233, 30, 140, 0.15)", "rgba(244, 114, 182, 0.08)"]}
                      style={styles.iconCircle}
                    >
                      <MaterialCommunityIcons name="face-recognition" size={56} color="#E91E8C" />
                    </LinearGradient>
                  </View>

                  <Text style={styles.cardTitle}>Launching Face Swap Studio</Text>
                  <Text style={styles.cardMsg}>
                    Starting high-performance local AI processing on your device...
                  </Text>

                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="large" color="#E91E8C" />
                    <Text style={styles.loadingTxt}>Opening native studio...</Text>
                  </View>

                  <View style={styles.featureBadgeRow}>
                    <View style={styles.featureBadge}>
                      <MaterialCommunityIcons name="shield-check" size={14} color="#059669" />
                      <Text style={styles.featureBadgeText}>100% On-Device & Private</Text>
                    </View>
                    <View style={styles.featureBadge}>
                      <MaterialCommunityIcons name="lightning-bolt" size={14} color="#D97706" />
                      <Text style={styles.featureBadgeText}>ONNX Accelerated</Text>
                    </View>
                  </View>
                </>
              )}
            </LinearGradient>
          </View>
        </Animated.View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  headerTitleWrap: {
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#18204E",
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#D81B60",
    fontWeight: "700",
    marginTop: 1,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 22,
  },
  glassCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  glassGradient: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: "center",
  },
  iconGlowWrap: {
    marginBottom: 18,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(233, 30, 140, 0.25)",
  },
  errorIconWrap: {
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#18204E",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  cardMsg: {
    fontSize: 13,
    lineHeight: 19,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 20,
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "rgba(255, 240, 245, 0.9)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(233, 30, 140, 0.2)",
    marginBottom: 20,
  },
  loadingTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#D81B60",
  },
  featureBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  featureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  featureBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
  btnRow: {
    width: "100%",
    gap: 10,
    marginTop: 6,
  },
  primaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#E91E8C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: "rgba(241, 245, 249, 0.85)",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(203, 213, 225, 0.7)",
  },
  secondaryBtnText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
});
