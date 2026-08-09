const {
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLAY_PROTECT_PACKAGE = 'PlayProtectPackage';
const PLAY_PROTECT_IMPORT = 'import com.smk1.tamilaichat.PlayProtectPackage';

const playProtectModule = `package com.smk1.tamilaichat

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReactPackage
import com.facebook.react.uimanager.ViewManager

class PlayProtectModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PlayProtect"

  @ReactMethod
  fun openPlayProtect(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "The app screen is not available")
      return
    }

    activity.runOnUiThread {
      try {
        val playProtectIntent = Intent().apply {
          component = ComponentName(
            "com.google.android.gms",
            "com.google.android.gms.security.settings.VerifyAppsSettingsActivity"
          )
        }
        activity.startActivity(playProtectIntent)
        promise.resolve(true)
      } catch (_: Exception) {
        try {
          activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
          promise.resolve(true)
        } catch (fallbackError: Exception) {
          promise.reject("OPEN_SETTINGS_FAILED", fallbackError.message, fallbackError)
        }
      }
    }
  }
}

class PlayProtectPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(PlayProtectModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withPlayProtect(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const androidRoot = config.modRequest.platformProjectRoot;
      const packageDir = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        'com',
        'smk1',
        'tamilaichat',
      );
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, 'PlayProtectModule.kt'),
        playProtectModule,
      );
      return config;
    },
  ]);

  return withMainApplication(config, (config) => {
    const { contents, language } = config.modResults;
    if (contents.includes(PLAY_PROTECT_IMPORT)) {
      return config;
    }

    if (language === 'kotlin') {
      config.modResults.contents = contents
        .replace(
          /^(package [^\n]+\n)/m,
          `$1\n${PLAY_PROTECT_IMPORT}\n`,
        )
        .replace(
          'PackageList(this).packages.apply {',
          `PackageList(this).packages.apply {\n      add(${PLAY_PROTECT_PACKAGE}())`,
        );
    } else {
      config.modResults.contents = contents
        .replace(
          /^(package [^\n]+;\n)/m,
          `$1\n${PLAY_PROTECT_IMPORT.replace('import ', 'import ')};\n`,
        )
        .replace(
          'List<ReactPackage> packages = new PackageList(this).getPackages();',
          `List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ${PLAY_PROTECT_PACKAGE}());`,
        );
    }
    return config;
  });
}

module.exports = withPlayProtect;