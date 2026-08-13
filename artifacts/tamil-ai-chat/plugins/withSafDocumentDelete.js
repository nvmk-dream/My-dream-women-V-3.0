const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'SafDocumentPackage';
const IMPORT_LINE = 'import com.smk1.tamilaichat.SafDocumentPackage';

function withSafDocumentDelete(config) {
  config = withDangerousMod(config, ['android', async (config) => {
    const packageDir = path.join(
      config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java',
      'com', 'smk1', 'tamilaichat',
    );
    fs.mkdirSync(packageDir, { recursive: true });
    const sourcePath = path.join(__dirname, 'SafDocumentModule.kt');
    fs.copyFileSync(sourcePath, path.join(packageDir, 'SafDocumentModule.kt'));
    return config;
  }]);

  return withMainApplication(config, (config) => {
    const { contents, language } = config.modResults;
    if (contents.includes(IMPORT_LINE)) return config;
    if (language === 'kotlin') {
      config.modResults.contents = contents
        .replace(/^(package [^\n]+\n)/m, '$1\n' + IMPORT_LINE + '\n')
        .replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n      add(' + PACKAGE_NAME + '())',
        );
    } else {
      // Expo may generate MainApplication.java for this project.
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

module.exports = withSafDocumentDelete;
