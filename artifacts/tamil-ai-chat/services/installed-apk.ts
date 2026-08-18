import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

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
  startBackupUpload(
    filePath: string,
    outputName: string,
    cloudName: string,
    uploadPreset: string,
    folder: string,
    mimeType: string,
    sizeBytes: number,
    backupInfoJson: string,
  ): Promise<boolean>;
  getBackupUploadState(): Promise<NativeBackupUploadState | null>;
  cancelBackupUpload(): Promise<boolean>;
  clearBackupUploadState(deleteFile: boolean): Promise<boolean>;
};

export type NativeBackupUploadState = {
  status: 'starting' | 'uploading' | 'paused' | 'failed' | 'completed' | string;
  filePath: string;
  outputName: string;
  cloudName: string;
  uploadPreset: string;
  folder: string;
  mimeType: string;
  totalBytes: number;
  uploadedBytes: number;
  uploadId: string;
  backupInfoJson: string;
  url?: string;
  public_id?: string;
  error?: string;
};

function getNativeModule(): InstalledApkNativeModule {
  if (Platform.OS !== 'android') {
    throw new Error('Current installed APK backup is available on Android only.');
  }
  const nativeModule = NativeModules.InstalledApk as InstalledApkNativeModule | undefined;
  if (!nativeModule?.getInstalledApkInfo || !nativeModule.createBackup || !nativeModule.startBackupUpload) {
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

export function startBackupUpload(options: {
  filePath: string;
  outputName: string;
  cloudName: string;
  uploadPreset: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
  backupInfoJson: string;
}) {
  return getNativeModule().startBackupUpload(
    options.filePath,
    options.outputName,
    options.cloudName,
    options.uploadPreset,
    options.folder,
    options.mimeType,
    options.sizeBytes,
    options.backupInfoJson,
  );
}

export function getBackupUploadState() {
  return getNativeModule().getBackupUploadState();
}

export function cancelBackupUpload() {
  return getNativeModule().cancelBackupUpload();
}

export function clearBackupUploadState(deleteFile = false) {
  return getNativeModule().clearBackupUploadState(deleteFile);
}

export function addBackupUploadListener(listener: (state: NativeBackupUploadState) => void) {
  return DeviceEventEmitter.addListener('backupUploadState', listener);
}
