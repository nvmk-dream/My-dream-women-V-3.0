package com.smk1.tamilaichat

import android.net.Uri
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class SafDocumentModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SafDocument"

  /**
   * true = document exists, false = provider confirms it is gone,
   * null = provider query failed and deletion cannot be verified.
   */
  private fun documentExists(uri: Uri): Boolean? {
    return try {
      reactContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        cursor.moveToFirst()
      } ?: false
    } catch (error: Exception) {
      android.util.Log.w("SafDocument", "document-query-failed uri=$uri error=${error.message}")
      null
    }
  }

  @ReactMethod
  fun deleteDocument(uriString: String, promise: Promise) {
    if (!uriString.startsWith("content://")) {
      promise.reject("INVALID_URI", "SAF deletion requires a content:// URI")
      return
    }

    try {
      val uri = Uri.parse(uriString)
      val resolver = reactContext.contentResolver
      val existedBefore = documentExists(uri)
      android.util.Log.i("SafDocument", "delete-start uri=$uriString existedBefore=$existedBefore")

      if (existedBefore != true) {
        val result = Arguments.createMap().apply {
          putBoolean("deleted", false)
          putInt("rows", 0)
          putString(
            "detail",
            if (existedBefore == false) {
              "Original document was not accessible before delete"
            } else {
              "Could not verify original document access before delete"
            },
          )
        }
        promise.resolve(result)
        return
      }

      val rows = resolver.delete(uri, null, null)
      val existsAfter = documentExists(uri)
      val verified = existsAfter == false
      val detail = if (verified) {
        "ContentResolver.delete rows=$rows; post-delete query confirms document is gone"
      } else if (existsAfter == true) {
        "ContentResolver.delete rows=$rows; post-delete query still finds the document"
      } else {
        "ContentResolver.delete rows=$rows; post-delete query failed, so deletion cannot be confirmed"
      }
      android.util.Log.i(
        "SafDocument",
        "delete-result uri=$uriString rows=$rows existsAfter=$existsAfter verified=$verified",
      )

      val result = Arguments.createMap().apply {
        putBoolean("deleted", verified)
        putInt("rows", rows)
        putString("detail", detail)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      val detail = "${error.javaClass.simpleName}: ${error.message ?: "unknown error"}"
      android.util.Log.e("SafDocument", "delete-exception uri=$uriString error=$detail", error)
      promise.reject("SAF_DELETE_FAILED", detail, error)
    }
  }
}

class SafDocumentPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(SafDocumentModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
