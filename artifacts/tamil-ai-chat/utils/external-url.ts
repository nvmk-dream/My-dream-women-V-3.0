import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";

export const OPERA_BROWSER_PACKAGE = "com.opera.browser";
const ANDROID_VIEW_ACTION = "android.intent.action.VIEW";
export const OPERA_NOT_INSTALLED_MESSAGE =
  "Opera Browser is not installed. Please install Opera Browser to open this URL.";

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

  if (Platform.OS !== "android") {
    throw new Error(OPERA_NOT_INSTALLED_MESSAGE);
  }

  try {
    // An explicit package-targeted ACTION_VIEW intent checks that Opera can
    // handle the URL and launches only Opera. Android will not show a chooser
    // or fall back to another browser.
    await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
      data: safeUrl,
      packageName: OPERA_BROWSER_PACKAGE,
    });
  } catch {
    throw new Error(OPERA_NOT_INSTALLED_MESSAGE);
  }
}