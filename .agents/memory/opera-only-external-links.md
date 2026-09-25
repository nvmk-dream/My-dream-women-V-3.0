---
name: Opera-only external links
description: The product requirement and implementation constraint for opening chat URLs in Opera on Android.
---

Chat URLs must open only the installed Android Opera Browser package (`com.opera.browser`); they must never silently fall back to the system default browser or a chooser. URLs embedded inside reply text need the same package-targeted intent as standalone URL messages. Expo IntentLauncher v13's `packageName` option alone does not constrain an ACTION_VIEW intent, so use a native intent with `setPackage`.

**Why:** The user explicitly requires Opera, and default `Linking.openURL` behavior can open a different browser.

**How to apply:** Reuse the existing package-targeted external URL helper for every `http://` and `https://` link rendered in chat, and show an explicit error when Opera is unavailable.