const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Custom Expo config plugin to remove READ_MEDIA_VISUAL_USER_SELECTED
 * from AndroidManifest.xml after expo-media-library auto-injects it.
 *
 * Why: On Android 14+, this permission triggers "Ask every time" partial
 * photo access mode — the permission resets even after the user sets
 * "Allowed". Removing it forces Android to use the full "Allow/Deny"
 * model so "Allowed" stays permanent.
 */
module.exports = function removeVisualUserSelected(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const root = manifest.manifest;

    if (Array.isArray(root['uses-permission'])) {
      root['uses-permission'] = root['uses-permission'].filter(
        (perm) =>
          perm.$['android:name'] !==
          'android.permission.READ_MEDIA_VISUAL_USER_SELECTED'
      );
    }

    return config;
  });
};
