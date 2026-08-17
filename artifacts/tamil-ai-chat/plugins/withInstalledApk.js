const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');
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
    fs.copyFileSync(
      path.join(__dirname, 'InstalledApkModule.kt'),
      path.join(packageDir, 'InstalledApkModule.kt'),
    );
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