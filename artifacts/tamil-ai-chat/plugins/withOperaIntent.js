const { withMainApplication, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_NAME = "OperaIntentPackage";
const IMPORT_LINE = "import com.smk1.tamilaichat.OperaIntentPackage";

function withOperaIntent(config) {
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const packageDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "smk1",
        "tamilaichat",
      );
      fs.mkdirSync(packageDir, { recursive: true });
      fs.copyFileSync(
        path.join(__dirname, "OperaIntentModule.kt"),
        path.join(packageDir, "OperaIntentModule.kt"),
      );
      return config;
    },
  ]);

  return withMainApplication(config, (config) => {
    const { contents, language } = config.modResults;
    if (contents.includes(IMPORT_LINE)) return config;

    if (language === "kotlin" || language === "kt") {
      config.modResults.contents = contents
        .replace(/^(package [^\n]+\n)/m, `$1\n${IMPORT_LINE}\n`)
        .replace(
          "PackageList(this).packages.apply {",
          `PackageList(this).packages.apply {\n      add(${PACKAGE_NAME}())`,
        );
    } else {
      config.modResults.contents = contents
        .replace(
          /^(package [^\n]+;\n)/m,
          `$1\n${IMPORT_LINE};\n`,
        )
        .replace(
          "List<ReactPackage> packages = new PackageList(this).getPackages();",
          `List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ${PACKAGE_NAME}());`,
        );
    }
    return config;
  });
}

module.exports = withOperaIntent;