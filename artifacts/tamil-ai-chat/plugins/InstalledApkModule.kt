package com.smk1.tamilaichat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONArray

class InstalledApkModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val uploadStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val rawState = intent?.getStringExtra(BackupUploadService.EXTRA_STATE_JSON) ?: return
      if (!reactContext.hasActiveCatalystInstance()) return
      val json = try { org.json.JSONObject(rawState) } catch (_: Exception) { return }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("backupUploadState", jsonToWritableMap(json))
    }
  }

  init {
    val filter = IntentFilter(BackupUploadService.ACTION_STATE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(uploadStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(uploadStateReceiver, filter)
    }
  }

  override fun getName(): String = "InstalledApk"

  override fun invalidate() {
    try { reactContext.unregisterReceiver(uploadStateReceiver) } catch (_: Exception) {}
    super.invalidate()
  }

  @ReactMethod
  fun getInstalledApkInfo(promise: Promise) {
    try {
      val appInfo = currentApplicationInfo()
      val packageInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
      promise.resolve(Arguments.createMap().apply {
        putString("packageName", reactContext.packageName)
        putString("versionName", packageInfo.versionName.orEmpty())
        putDouble("versionCode", if (Build.VERSION.SDK_INT >= 28) {
          packageInfo.longVersionCode.toDouble()
        } else {
          @Suppress("DEPRECATION")
          packageInfo.versionCode.toDouble()
        })
        putString("sourcePath", appInfo.sourceDir)
      })
    } catch (error: Exception) {
      promise.reject("APK_INFO_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun startBackupUpload(
    filePath: String,
    outputName: String,
    cloudName: String,
    uploadPreset: String,
    folder: String,
    mimeType: String,
    sizeBytes: Double,
    backupInfoJson: String,
    promise: Promise,
  ) {
    try {
      BackupUploadService.start(reactContext, mapOf(
        "filePath" to filePath,
        "outputName" to outputName,
        "cloudName" to cloudName,
        "uploadPreset" to uploadPreset,
        "folder" to folder,
        "mimeType" to mimeType,
        "sizeBytes" to sizeBytes.toLong().toString(),
        "backupInfoJson" to backupInfoJson,
      ))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKUP_UPLOAD_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getBackupUploadState(promise: Promise) {
    promise.resolve(BackupUploadService.readState(reactContext))
  }

  @ReactMethod
  fun cancelBackupUpload(promise: Promise) {
    try {
      BackupUploadService.cancel(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKUP_UPLOAD_CANCEL_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun clearBackupUploadState(deleteFile: Boolean, promise: Promise) {
    try {
      BackupUploadService.clearState(reactContext, deleteFile)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKUP_UPLOAD_CLEAR_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun createBackup(
    outputName: String,
    backupInfoJson: String,
    projectDataJson: String,
    mediaFilesJson: String,
    promise: Promise,
  ) {
    try {
      promise.resolve(createBackup(outputName, backupInfoJson, projectDataJson, mediaFilesJson))
    } catch (error: Exception) {
      promise.reject("BACKUP_CREATE_FAILED", error.message, error)
    }
  }

  private fun currentApplicationInfo(): ApplicationInfo =
    reactContext.packageManager.getApplicationInfo(reactContext.packageName, 0)

  private fun jsonToWritableMap(json: org.json.JSONObject): WritableMap =
    Arguments.createMap().apply {
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val value = json.opt(key)
        when (value) {
          is Number -> putDouble(key, value.toDouble())
          is Boolean -> putBoolean(key, value)
          org.json.JSONObject.NULL -> putNull(key)
          else -> putString(key, value.toString())
        }
      }
    }

  private fun createBackup(
    outputName: String,
    backupInfoJson: String,
    projectDataJson: String,
    mediaFilesJson: String,
  ): WritableMap {
    val backupDir = File(reactContext.filesDir, "project-backups").apply { mkdirs() }
    val safeName = outputName.replace(Regex("[^A-Za-z0-9_.-]"), "_")
      .ifBlank { "MyDreamWoman_FullBackup.zip" }
    val zipFile = File(backupDir, safeName)
    if (zipFile.exists()) zipFile.delete()

    ZipOutputStream(FileOutputStream(zipFile)).use { zip ->
      val mediaFiles = JSONArray(mediaFilesJson)
      val validMediaEntries = (0 until mediaFiles.length()).mapNotNull { index ->
        val item = mediaFiles.optJSONObject(index) ?: return@mapNotNull null
        val url = item.optString("url")
        val entryPath = safeEntryPath(item.optString("path"))
        if (url.isBlank() || entryPath.isBlank()) null else Triple(entryPath, url, item)
      }
      val totalWorkUnits = (3 + validMediaEntries.size).toDouble()
      var completedWorkUnits = 0.0
      fun reportProgress(currentUnitProgress: Double) {
        val percent = (((completedWorkUnits + currentUnitProgress.coerceIn(0.0, 1.0)) / totalWorkUnits) * 100)
          .toInt()
          .coerceIn(0, 99)
        emitZipProgress(percent)
      }

      emitZipProgress(0)
      addFile(zip, "APK/MyDreamWoman.apk", File(currentApplicationInfo().sourceDir)) { reportProgress(it) }
      completedWorkUnits += 1
      reportProgress(0.0)
      addBytes(zip, "Projects/project-data.json", projectDataJson.toByteArray(Charsets.UTF_8))
      completedWorkUnits += 1
      reportProgress(0.0)
      addBytes(zip, "BackupInfo.json", backupInfoJson.toByteArray(Charsets.UTF_8))
      completedWorkUnits += 1
      reportProgress(0.0)

      for ((entryPath, url, _) in validMediaEntries) {
        downloadIntoZip(zip, entryPath, url) { reportProgress(it) }
        completedWorkUnits += 1
        reportProgress(0.0)
      }
    }
    emitZipProgress(100)

    return Arguments.createMap().apply {
      putString("uri", zipFile.toURI().toString())
      putString("path", zipFile.absolutePath)
      putDouble("sizeBytes", zipFile.length().toDouble())
    }
  }

  private fun addBytes(zip: ZipOutputStream, entryName: String, bytes: ByteArray) {
    zip.putNextEntry(ZipEntry(entryName))
    zip.write(bytes)
    zip.closeEntry()
  }

  private fun addFile(
    zip: ZipOutputStream,
    entryName: String,
    file: File,
    onProgress: (Double) -> Unit = {},
  ) {
    zip.putNextEntry(ZipEntry(entryName))
    BufferedInputStream(FileInputStream(file)).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      val totalBytes = file.length().coerceAtLeast(1L)
      var copiedBytes = 0L
      while (true) {
        val count = input.read(buffer)
        if (count <= 0) break
        zip.write(buffer, 0, count)
        copiedBytes += count
        onProgress(copiedBytes.toDouble() / totalBytes)
      }
    }
    zip.closeEntry()
  }

  private fun downloadIntoZip(
    zip: ZipOutputStream,
    entryName: String,
    url: String,
    onProgress: (Double) -> Unit = {},
  ) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 120_000
      requestMethod = "GET"
    }
    try {
      connection.connect()
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Cloudinary media download failed: HTTP ${connection.responseCode}")
      }
      val expectedBytes = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
      zip.putNextEntry(ZipEntry(entryName))
      connection.inputStream.use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var downloadedBytes = 0L
        while (true) {
          val count = input.read(buffer)
          if (count <= 0) break
          zip.write(buffer, 0, count)
          downloadedBytes += count
          if (expectedBytes > 0) onProgress(downloadedBytes.toDouble() / expectedBytes)
        }
      }
      zip.closeEntry()
    } finally {
      connection.disconnect()
    }
  }

  private fun safeEntryPath(path: String): String {
    val normalized = path.replace('\\', '/').trimStart('/')
    if (normalized.isBlank() || normalized.split('/').any { it == ".." || it.isBlank() }) return ""
    return normalized
  }

  private fun emitZipProgress(percent: Int) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("installedApkZipProgress", Arguments.createMap().apply {
          putInt("percent", percent.coerceIn(0, 100))
        })
    } catch (_: Exception) {
      // Progress is best-effort; archive creation still reports its own failures.
    }
  }
}