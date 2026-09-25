import { NativeModules, Platform } from "react-native";

export const OPERA_BROWSER_PACKAGE = "com.opera.browser";
export const OPERA_NOT_INSTALLED_MESSAGE =
  "Opera Browser is not installed. Please install Opera Browser to open this URL.";

type OperaIntentModule = {
  openUrl(url: string): Promise<boolean>;
};

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

  const operaIntent = NativeModules.OperaIntent as
    | OperaIntentModule
    | undefined;
  if (!operaIntent?.openUrl) {
    throw new Error(OPERA_NOT_INSTALLED_MESSAGE);
  }

  try {
    // The native module calls Intent.setPackage("com.opera.browser"), which
    // prevents Android from resolving this URL through the default browser or
    // displaying a chooser.
    await operaIntent.openUrl(safeUrl);
  } catch {
    throw new Error(OPERA_NOT_INSTALLED_MESSAGE);
  }
}