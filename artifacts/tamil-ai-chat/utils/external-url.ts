import { Linking } from "react-native";

export function getSafeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname
    ) {
      return parsed.toString();
    }
  } catch {
    // Invalid URLs are rejected instead of being passed to the platform.
  }

  return null;
}

export async function openExternalHttpUrl(value: unknown): Promise<void> {
  const safeUrl = getSafeExternalHttpUrl(value);
  if (!safeUrl) {
    throw new Error("Only valid http:// or https:// URLs can be opened.");
  }

  // React Native's Android implementation uses ACTION_VIEW. Android then
  // resolves the installed browser/default-app choice; no browser is chosen
  // or embedded by the app.
  await Linking.openURL(safeUrl);
}