const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const KOTLIN_COMPOSE_VERSION = "2.1.20";
const PACKAGE_IMPORT = "import com.smk1.tamilaichat.FaceSwapStudioPackage";
const PACKAGE_NAME = "FaceSwapStudioPackage";

function withFaceSwapNative(config) {
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const appMainDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
      );
      const pluginDir = path.join(__dirname, "face-swap-native");
      const javaSourceDir = path.join(pluginDir, "source", "java", "com", "example");
      const hostJavaDir = path.join(appMainDir, "java");
      const hostPackageDir = path.join(hostJavaDir, "com", "smk1", "tamilaichat");
      const drawableDir = path.join(appMainDir, "res", "drawable");
      const valuesDir = path.join(appMainDir, "res", "values");

      fs.cpSync(javaSourceDir, path.join(hostJavaDir, "com", "example"), {
        recursive: true,
        force: true,
      });
      fs.mkdirSync(hostPackageDir, { recursive: true });
      fs.copyFileSync(
        path.join(pluginDir, "FaceSwapStudioModule.kt"),
        path.join(hostPackageDir, "FaceSwapStudioModule.kt"),
      );
      fs.copyFileSync(
        path.join(pluginDir, "FaceSwapStudioPackage.kt"),
        path.join(hostPackageDir, "FaceSwapStudioPackage.kt"),
      );

      fs.mkdirSync(drawableDir, { recursive: true });
      fs.cpSync(
        path.join(pluginDir, "source", "res", "drawable"),
        drawableDir,
        { recursive: true, force: true },
      );
      fs.mkdirSync(valuesDir, { recursive: true });
      fs.copyFileSync(
        path.join(pluginDir, "face-swap-strings.xml"),
        path.join(valuesDir, "face_swap_strings.xml"),
      );
      return config;
    },
  ]);

  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Face Swap integration could not find the Android application manifest.");
    }
    application.$ = application.$ ?? {};
    application.$["android:largeHeap"] = "true";
    application.activity = application.activity ?? [];

    const activityName = "com.example.FaceSwapActivity";
    if (!application.activity.some((item) => item?.$?.["android:name"] === activityName)) {
      application.activity.push({
        $: {
          "android:name": activityName,
          "android:exported": "false",
          "android:screenOrientation": "portrait",
          "android:theme": "@style/AppTheme",
        },
      });
    }
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("org.jetbrains.kotlin.plugin.compose")) {
      contents =
        `plugins {\n    id 'org.jetbrains.kotlin.plugin.compose' version '${KOTLIN_COMPOSE_VERSION}'\n}\n\n` +
        contents;
    }

    if (!/buildFeatures\s*\{[^}]*compose\s+true/s.test(contents)) {
      if (/buildFeatures\s*\{/.test(contents)) {
        contents = contents.replace(
          /buildFeatures\s*\{/,
          (match) => `${match}\n        compose true`,
        );
      } else if (/android\s*\{/.test(contents)) {
        contents = contents.replace(
          /android\s*\{/,
          (match) => `${match}\n    buildFeatures {\n        compose true\n    }`,
        );
      } else {
        throw new Error("Face Swap integration could not find the Android Gradle block.");
      }
    }

    const dependencyMarker = "// FaceSwap Studio native dependencies";
    if (!contents.includes(dependencyMarker)) {
      const dependencyBlock = /dependencies\s*\{/;
      if (!dependencyBlock.test(contents)) {
        throw new Error("Face Swap integration could not find the Android dependencies block.");
      }
      const lines = [
        dependencyMarker,
        '    implementation(platform("androidx.compose:compose-bom:2024.09.00"))',
        '    implementation("androidx.activity:activity-compose:1.10.1")',
        '    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")',
        '    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")',
        '    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")',
        '    implementation("androidx.compose.material3:material3")',
        '    implementation("androidx.compose.material:material-icons-extended")',
        '    implementation("androidx.compose.ui:ui")',
        '    implementation("androidx.compose.ui:ui-graphics")',
        '    implementation("androidx.compose.ui:ui-tooling-preview")',
        '    implementation("androidx.core:core-ktx:1.18.0")',
        '    implementation("androidx.exifinterface:exifinterface:1.3.7")',
        '    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")',
        '    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")',
        '    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")',
        '    implementation("com.google.mlkit:face-detection:16.1.7")',
      ].join("\n");
      contents = contents.replace(dependencyBlock, (match) => `${match}\n    ${lines}`);
    }

    config.modResults.contents = contents;
    return config;
  });

  return withMainApplication(config, (config) => {
    const { contents, language } = config.modResults;
    if (contents.includes(PACKAGE_IMPORT)) return config;

    if (language === "kotlin" || language === "kt") {
      if (!contents.includes("PackageList(this).packages.apply {")) {
        throw new Error("Face Swap integration could not find the Kotlin package registration point.");
      }
      config.modResults.contents = contents
        .replace(/^(package [^\n]+\n)/m, `$1\n${PACKAGE_IMPORT}\n`)
        .replace(
          "PackageList(this).packages.apply {",
          `PackageList(this).packages.apply {\n      add(${PACKAGE_NAME}())`,
        );
    } else {
      if (!contents.includes("List<ReactPackage> packages = new PackageList(this).getPackages();")) {
        throw new Error("Face Swap integration could not find the Java package registration point.");
      }
      config.modResults.contents = contents
        .replace(/^(package [^\n]+;\n)/m, `$1\n${PACKAGE_IMPORT};\n`)
        .replace(
          "List<ReactPackage> packages = new PackageList(this).getPackages();",
          `List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ${PACKAGE_NAME}());`,
        );
    }
    return config;
  });
}

module.exports = withFaceSwapNative;
