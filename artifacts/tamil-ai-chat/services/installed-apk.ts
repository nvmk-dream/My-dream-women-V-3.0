import { NativeModules, Platform } from 'react-native';

type InstalledApkNativeModule = {
  getInstalledApkInfo(): Promise<{
    packageName: string;
    versionName: string;
    versionCode: number;
    sourcePath: string;
  }>;
  createBackup(
    outputName: string,
    backupInfoJson: string,
    projectDataJson: string,
    mediaFilesJson: string,
  ): Promise<{ uri: string; path: string; sizeBytes: number }>;
};

function getNativeModule(): InstalledApkNativeModule {
  if (Platform.OS !== 'android') {
    throw new Error('Current installed APK backup is available on Android only.');
  }
  const nativeModule = NativeModules.InstalledApk as InstalledApkNativeModule | undefined;
  if (!nativeModule?.getInstalledApkInfo || !nativeModule.createBackup) {
    throw new Error('Installed APK backup module is unavailable in this APK.');
  }
  return nativeModule;
}

export function getInstalledApkInfo() {
  return getNativeModule().getInstalledApkInfo();
}

export function createBackupZip(options: {
  outputName: string;
  backupInfoJson: string;
  projectDataJson: string;
  mediaFilesJson: string;
}) {
  return getNativeModule().createBackup(
    options.outputName,
    options.backupInfoJson,
    options.projectDataJson,
    options.mediaFilesJson,
  );
}