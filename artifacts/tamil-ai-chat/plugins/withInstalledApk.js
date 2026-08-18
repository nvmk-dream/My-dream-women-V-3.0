const { withMainApplication, withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'InstalledApkPackage';
const IMPORT_LINE = 'import com.smk1.tamilaichat.InstalledApkPackage';

function withInstalledApk(config) {
  config = withDangerousMod(config, ['android', async (config) => {
    const packageDir = path.join(
      config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java',
      'com', 'smk1', 'tamilaichat',
    );
    fs.mkdirSync(packageDir, { recursive: true });
    for (const source of ['InstalledApkModule.kt', 'BackupUploadService.kt']) {
      fs.copyFileSync(
        path.join(__dirname, source),
        path.join(packageDir, source),
      );
    }
    fs.writeFileSync(
      path.join(packageDir, 'InstalledApkPackage.kt'),
      `package com.smk1.tamilaichat

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class InstalledApkPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(InstalledApkModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`,
    );
    return config;
  }]);

  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const permissionNames = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    ];
    const permissions = manifest['uses-permission'] ?? [];
    for (const name of permissionNames) {
      if (!permissions.some((item) => item?.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    }
    manifest['uses-permission'] = permissions;
    const application = manifest.application?.[0];
    if (application) {
      application.service = application.service ?? [];
      const exists = application.service.some((item) => item?.$?.['android:name'] === '.BackupUploadService');
      if (!exists) {
        application.service.push({
          $: {
            'android:name': '.BackupUploadService',
            'android:exported': 'false',
            'android:foregroundServiceType': 'dataSync',
          },
        });
      }
    }
    return config;
  });

  return withMainApplication(config, (config) => {
    const { contents, language } = config.modResults;
    if (contents.includes(IMPORT_LINE)) return config;
    if (language === 'kotlin' || language === 'kt') {
      config.modResults.contents = contents
        .replace(/^(package [^\n]+\n)/m, '$1\n' + IMPORT_LINE + '\n')
        .replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n      add(' + PACKAGE_NAME + '())',
        );
    } else {
      config.modResults.contents = contents
        .replace(/^(package [^\n]+;\n)/m, '$1\n' + IMPORT_LINE + ';\n')
        .replace(
          'List<ReactPackage> packages = new PackageList(this).getPackages();',
          'List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ' + PACKAGE_NAME + '());',
        );
    }
    return config;
  });
}

module.exports = withInstalledApk;