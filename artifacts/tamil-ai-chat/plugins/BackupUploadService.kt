package com.smk1.tamilaichat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min
import org.json.JSONObject

class BackupUploadService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val stopRequested = AtomicBoolean(false)
  private val running = AtomicBoolean(false)

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_CANCEL -> {
        stopRequested.set(true)
        // User cancellation is permanent: clear the saved resumable upload state.
        // The next backup must always start as a fresh upload, never resume this job.
        val cancelled = loadState() ?: JSONObject()
        cancelled.put("status", "cancelled")
        cancelled.put("error", "Upload cancelled by user")
        sendBroadcast(
          Intent(ACTION_STATE)
            .setPackage(packageName)
            .putExtra(EXTRA_STATE_JSON, cancelled.toString()),
        )
        clearState(this, deleteFile = true)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        stopRequested.set(false)
        if (!running.compareAndSet(false, true)) return START_REDELIVER_INTENT
        startForegroundCompat(buildNotification(loadState() ?: JSONObject().put("status", "starting")))
        val filePath = intent.getStringExtra(EXTRA_FILE_PATH).orEmpty()
        val outputName = intent.getStringExtra(EXTRA_OUTPUT_NAME).orEmpty()
        val cloudName = intent.getStringExtra(EXTRA_CLOUD_NAME).orEmpty()
        val uploadPreset = intent.getStringExtra(EXTRA_UPLOAD_PRESET).orEmpty()
        val folder = intent.getStringExtra(EXTRA_FOLDER).orEmpty()
        val mimeType = intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty().ifBlank { "application/zip" }
        val sizeBytes = intent.getLongExtra(EXTRA_SIZE_BYTES, 0L)
        val backupInfoJson = intent.getStringExtra(EXTRA_BACKUP_INFO_JSON).orEmpty()
        executor.execute {
          upload(
            filePath = filePath,
            outputName = outputName,
            cloudName = cloudName,
            uploadPreset = uploadPreset,
            folder = folder,
            mimeType = mimeType,
            sizeBytes = sizeBytes,
            backupInfoJson = backupInfoJson,
          )
        }
      }
    }
    return START_REDELIVER_INTENT
  }

  private fun upload(
    filePath: String,
    outputName: String,
    cloudName: String,
    uploadPreset: String,
    folder: String,
    mimeType: String,
    sizeBytes: Long,
    backupInfoJson: String,
  ) {
    try {
      val file = File(filePath)
      if (!file.exists() || !file.isFile) throw IOException("Backup ZIP not found")
      if (cloudName.isBlank() || uploadPreset.isBlank()) throw IOException("Cloudinary upload configuration is missing")

      val total = if (sizeBytes > 0) sizeBytes else file.length()
      val previous = loadState()
      val sameJob = previous != null &&
        previous.optString("filePath") == file.absolutePath &&
        previous.optLong("totalBytes", total) == total &&
        previous.optLong("fileLength", file.length()) == file.length() &&
        previous.optString("status") != "completed"
      val state = if (sameJob && previous != null) previous else JSONObject()
      val uploadId = state.optString("uploadId").ifBlank { UUID.randomUUID().toString() }
      var offset = if (sameJob) state.optLong("uploadedBytes", 0L) else 0L
      offset = offset.coerceIn(0L, total)
      state.put("status", "uploading")
        .put("filePath", file.absolutePath)
        .put("outputName", outputName)
        .put("cloudName", cloudName)
        .put("uploadPreset", uploadPreset)
        .put("folder", folder)
        .put("mimeType", mimeType)
        .put("totalBytes", total)
        .put("fileLength", file.length())
        .put("uploadedBytes", offset)
        .put("uploadId", uploadId)
        .put("backupInfoJson", backupInfoJson)
        .put("error", "")
      updateState(state)
      notifyState(state)

      while (offset < total && !stopRequested.get()) {
        val end = min(offset + CHUNK_SIZE, total) - 1L
        val response = uploadChunkWithRetry(
          file = file,
          start = offset,
          end = end,
          total = total,
          uploadId = uploadId,
          cloudName = cloudName,
          uploadPreset = uploadPreset,
          folder = folder,
          mimeType = mimeType,
          outputName = outputName,
        )
        offset = end + 1L
        state.put("uploadedBytes", offset).put("status", "uploading").put("error", "")
        response.url?.let { state.put("url", it) }
        response.publicId?.let { state.put("public_id", it) }
        updateState(state)
        notifyState(state)
      }

      if (stopRequested.get()) {
        state.put("status", "paused").put("error", "Upload paused")
        updateState(state)
        notifyState(state)
        return
      }

      state.put("status", "completed").put("uploadedBytes", total).put("finishedAt", System.currentTimeMillis()).put("error", "")
      updateState(state)
      notifyState(state)
    } catch (error: Exception) {
      val state = loadState() ?: JSONObject()
      state.put("status", "failed")
        .put("error", error.message ?: "Backup upload failed")
      updateState(state)
      notifyState(state)
    } finally {
      running.set(false)
      stopForeground(STOP_FOREGROUND_DETACH)
      stopSelf()
    }
  }

  private fun uploadChunkWithRetry(
    file: File,
    start: Long,
    end: Long,
    total: Long,
    uploadId: String,
    cloudName: String,
    uploadPreset: String,
    folder: String,
    mimeType: String,
    outputName: String,
  ): ChunkResponse {
    var attempt = 0
    while (!stopRequested.get()) {
      try {
        return uploadChunk(
          file = file,
          start = start,
          end = end,
          total = total,
          uploadId = uploadId,
          cloudName = cloudName,
          uploadPreset = uploadPreset,
          folder = folder,
          mimeType = mimeType,
          outputName = outputName,
        )
      } catch (error: Exception) {
        if (!isRetryable(error)) throw error
        attempt += 1
        val delaySeconds = (2L shl (attempt - 1).coerceAtMost(5)).coerceAtMost(60L)
        val state = loadState() ?: JSONObject()
        state.put("status", "uploading")
          .put("error", "Network unavailable. Retrying in ${delaySeconds}s")
        updateState(state)
        notifyState(state)
        try {
          Thread.sleep(delaySeconds * 1000L)
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          throw IOException("Upload paused")
        }
      }
    }
    throw IOException("Upload paused")
  }

  private fun isRetryable(error: Exception): Boolean =
    when (error) {
      is CloudinaryUploadException ->
        error.statusCode == 408 || error.statusCode == 429 || error.statusCode >= 500
      is IOException -> true
      else -> false
    }

  private fun uploadChunk(
    file: File,
    start: Long,
    end: Long,
    total: Long,
    uploadId: String,
    cloudName: String,
    uploadPreset: String,
    folder: String,
    mimeType: String,
    outputName: String,
  ): ChunkResponse {
    val boundary = "----MyDreamWomen-${UUID.randomUUID()}"
    val endpoint = URL("https://api.cloudinary.com/v1_1/$cloudName/raw/upload")
    val connection = (endpoint.openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 180_000
      requestMethod = "POST"
      doOutput = true
      setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      setRequestProperty("Content-Range", "bytes $start-$end/${if (end + 1L >= total) total else -1}")
      setRequestProperty("X-Unique-Upload-Id", uploadId)
    }

    val prefix = buildString {
      append("--$boundary\r\n")
      append("Content-Disposition: form-data; name=\"upload_preset\"\r\n\r\n")
      append(uploadPreset)
      append("\r\n--$boundary\r\n")
      append("Content-Disposition: form-data; name=\"folder\"\r\n\r\n")
      append(folder)
      append("\r\n--$boundary\r\n")
      append("Content-Disposition: form-data; name=\"file\"; filename=\"$outputName\"\r\n")
      append("Content-Type: $mimeType\r\n\r\n")
    }.toByteArray(StandardCharsets.UTF_8)
    val suffix = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
    val chunkLength = end - start + 1L
    val bodyLength = prefix.size.toLong() + chunkLength + suffix.size.toLong()
    connection.setFixedLengthStreamingMode(bodyLength)

    try {
      connection.outputStream.use { output ->
        output.write(prefix)
        RandomAccessFile(file, "r").use { input ->
          input.seek(start)
          val buffer = ByteArray(BUFFER_SIZE)
          var remaining = chunkLength
          while (remaining > 0) {
            if (stopRequested.get()) throw IOException("Upload paused")
            val read = input.read(buffer, 0, min(buffer.size.toLong(), remaining).toInt())
            if (read <= 0) throw IOException("Backup ZIP ended before upload completed")
            output.write(buffer, 0, read)
            remaining -= read
          }
        }
        output.write(suffix)
      }
      val status = connection.responseCode
      val body = try {
        (if (status in 200..299) connection.inputStream else connection.errorStream)
          ?.bufferedReader()?.use { it.readText() }.orEmpty()
      } catch (_: Exception) { "" }
      if (status !in 200..299) {
        val message = try { JSONObject(body).optJSONObject("error")?.optString("message") } catch (_: Exception) { null }
        throw CloudinaryUploadException(
          status,
          message?.ifBlank { null } ?: "Cloudinary upload failed: HTTP $status",
        )
      }
      val json = try { JSONObject(body) } catch (_: Exception) { JSONObject() }
      return ChunkResponse(
        url = json.optString("secure_url").ifBlank { null },
        publicId = json.optString("public_id").ifBlank { null },
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Backup uploads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shows My Dream Women backup upload progress"
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(state: JSONObject): Notification {
    val status = state.optString("status", "starting")
    val total = state.optLong("totalBytes", 0L)
    val uploaded = state.optLong("uploadedBytes", 0L)
    val percent = if (total > 0) ((uploaded * 100L) / total).toInt().coerceIn(0, 100) else 0
    val title = when (status) {
      "completed" -> "Backup completed"
      "failed" -> "Backup upload failed"
      "paused" -> "Backup paused"
      else -> "Uploading backup"
    }
    val text = when (status) {
      "completed" -> state.optString("outputName", "Backup is ready")
      "failed", "paused" -> state.optString("error", "Tap the app to resume")
      "uploading" -> state.optString("error").ifBlank {
        "${state.optString("outputName", "Backup.zip")} • $percent% • ${formatBytes(uploaded)} / ${formatBytes(total)}"
      }
      else -> "${state.optString("outputName", "Backup.zip")} • $percent% • ${formatBytes(uploaded)} / ${formatBytes(total)}"
    }
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    builder.setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title)
      .setContentText(text)
      .setOnlyAlertOnce(true)
      .setAutoCancel(status == "completed" || status == "failed")
    pendingIntent?.let { builder.setContentIntent(it) }
    if (status == "uploading" || status == "starting") builder.setProgress(100, percent, false)
    else if (status == "completed") builder.setProgress(100, 100, false)
    return builder.build()
  }

  private fun notifyState(state: JSONObject) {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(state))
    sendBroadcast(
      Intent(ACTION_STATE)
        .setPackage(packageName)
        .putExtra(EXTRA_STATE_JSON, state.toString()),
    )
  }

  private fun loadState(): JSONObject? {
    val raw = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATE, null) ?: return null
    return try { JSONObject(raw) } catch (_: Exception) { null }
  }

  private fun updateState(state: JSONObject) {
    getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_STATE, state.toString()).commit()
  }

  private fun formatBytes(value: Long): String {
    if (value <= 0) return "0 B"
    if (value < 1024 * 1024) return "${value / 1024} KB"
    return "${"%.1f".format(value.toDouble() / (1024 * 1024))} MB"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopRequested.set(true)
    executor.shutdownNow()
    super.onDestroy()
  }

  data class ChunkResponse(val url: String?, val publicId: String?)
  class CloudinaryUploadException(val statusCode: Int, message: String) : IOException(message)

  companion object {
    const val ACTION_START = "com.smk1.tamilaichat.BACKUP_UPLOAD_START"
    const val ACTION_CANCEL = "com.smk1.tamilaichat.BACKUP_UPLOAD_CANCEL"
    const val ACTION_STATE = "com.smk1.tamilaichat.BACKUP_UPLOAD_STATE"
    const val EXTRA_STATE_JSON = "stateJson"
    private const val CHANNEL_ID = "backup-uploads"
    private const val NOTIFICATION_ID = 4107
    private const val PREFS = "backup_upload_state"
    private const val KEY_STATE = "state"
    private const val CHUNK_SIZE = 8L * 1024L * 1024L
    private const val BUFFER_SIZE = 64 * 1024
    private const val EXTRA_FILE_PATH = "filePath"
    private const val EXTRA_OUTPUT_NAME = "outputName"
    private const val EXTRA_CLOUD_NAME = "cloudName"
    private const val EXTRA_UPLOAD_PRESET = "uploadPreset"
    private const val EXTRA_FOLDER = "folder"
    private const val EXTRA_MIME_TYPE = "mimeType"
    private const val EXTRA_SIZE_BYTES = "sizeBytes"
    private const val EXTRA_BACKUP_INFO_JSON = "backupInfoJson"

    fun start(context: Context, options: Map<String, String>) {
      val intent = Intent(context, BackupUploadService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_FILE_PATH, options["filePath"])
        putExtra(EXTRA_OUTPUT_NAME, options["outputName"])
        putExtra(EXTRA_CLOUD_NAME, options["cloudName"])
        putExtra(EXTRA_UPLOAD_PRESET, options["uploadPreset"])
        putExtra(EXTRA_FOLDER, options["folder"])
        putExtra(EXTRA_MIME_TYPE, options["mimeType"])
        putExtra(EXTRA_SIZE_BYTES, options["sizeBytes"]?.toLongOrNull() ?: 0L)
        putExtra(EXTRA_BACKUP_INFO_JSON, options["backupInfoJson"])
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }

    fun cancel(context: Context) {
      context.startService(Intent(context, BackupUploadService::class.java).setAction(ACTION_CANCEL))
    }

    fun readState(context: Context): WritableMap? {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATE, null) ?: return null
      val json = try { JSONObject(raw) } catch (_: Exception) { return null }
      return Arguments.createMap().apply {
        val keys = json.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          val value = json.opt(key)
          when (value) {
            is Number -> putDouble(key, value.toDouble())
            is Boolean -> putBoolean(key, value)
            JSONObject.NULL -> putNull(key)
            else -> putString(key, value.toString())
          }
        }
      }
    }

    fun clearState(context: Context, deleteFile: Boolean) {
      if (deleteFile) {
        val state = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATE, null)
        try { state?.let { JSONObject(it).optString("filePath").takeIf(String::isNotBlank)?.let { path -> File(path).delete() } } } catch (_: Exception) {}
      }
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
      context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }
  }
}
