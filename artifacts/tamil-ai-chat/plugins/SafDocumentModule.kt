package com.smk1.tamilaichat

import android.os.Build
import android.net.Uri
import android.provider.DocumentsContract
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

  private enum class QueryState { EXISTS, GONE, UNKNOWN }

  private data class UriAudit(
    val authority: String,
    val uriType: String,
    val provider: String,
    val isDocumentProvider: Boolean,
    val supportsDelete: Boolean?,
  )

  private fun queryState(uri: Uri): QueryState {
    return try {
      val cursor = reactContext.contentResolver.query(uri, null, null, null, null)
        ?: return QueryState.UNKNOWN
      cursor.use { if (it.moveToFirst()) QueryState.EXISTS else QueryState.GONE }
    } catch (error: Exception) {
      android.util.Log.w("SafDocument", "document-query-failed uri=$uri error=${error.message}")
      QueryState.UNKNOWN
    }
  }

  private fun documentSupportsDelete(uri: Uri): Boolean? {
    return try {
      val cursor = reactContext.contentResolver.query(
        uri,
        arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
        null,
        null,
        null,
      ) ?: return null
      cursor.use {
        if (!it.moveToFirst()) return false
        val index = it.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS)
        if (index < 0 || it.isNull(index)) return null
        (it.getLong(index) and DocumentsContract.Document.FLAG_SUPPORTS_DELETE.toLong()) != 0L
      }
    } catch (error: Exception) {
      android.util.Log.w("SafDocument", "document-flags-failed uri=$uri error=${error.message}")
      null
    }
  }

  private fun auditUri(uri: Uri): UriAudit {
    val authority = uri.authority ?: "unknown"
    val isDocumentProvider = try {
      DocumentsContract.isDocumentUri(reactContext, uri)
    } catch (_: Exception) {
      false
    }
    val uriType = try {
      reactContext.contentResolver.getType(uri) ?: "unknown"
    } catch (_: Exception) {
      "unknown"
    }
    val provider = when {
      authority == "media" -> "MediaStore"
      authority == "com.android.providers.media.documents" -> "MediaStore DocumentsProvider"
      authority == "com.android.providers.downloads.documents" ||
        authority == "com.android.providers.downloads" -> "Downloads/Documents provider"
      isDocumentProvider -> "DocumentsProvider"
      else -> "Other provider"
    }
    return UriAudit(
      authority = authority,
      uriType = uriType,
      provider = provider,
      isDocumentProvider = isDocumentProvider,
      supportsDelete = if (isDocumentProvider) documentSupportsDelete(uri) else null,
    )
  }

  private fun resolveMediaStoreUri(uri: Uri): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null

    return try {
      // Resolve this API reflectively so the module also compiles with Android
      // SDKs whose android.jar does not expose getMediaUri yet.
      val method = DocumentsContract::class.java.getMethod(
        "getMediaUri",
        android.content.Context::class.java,
        Uri::class.java,
      )
      method.invoke(null, reactContext, uri) as? Uri
    } catch (error: Exception) {
      android.util.Log.w(
        "SafDocument",
        "media-uri-resolution-failed uri=$uri error=${error.message}",
      )
      null
    }
  }

  private fun auditMap(uri: Uri, audit: UriAudit): com.facebook.react.bridge.WritableMap {
    return Arguments.createMap().apply {
      putString("originalUri", uri.toString())
      putString("uriAuthority", audit.authority)
      putString("uriType", audit.uriType)
      putString("provider", audit.provider)
      putBoolean("isDocumentProvider", audit.isDocumentProvider)
      if (audit.supportsDelete == null) putNull("supportsDelete")
      else putBoolean("supportsDelete", audit.supportsDelete)
    }
  }

  private fun resultMap(
    uri: Uri,
    audit: UriAudit,
    deleted: Boolean,
    rows: Int,
    deleteMethod: String,
    deleteResult: String,
    postDeleteVerification: String,
    detail: String,
  ): com.facebook.react.bridge.WritableMap {
    return auditMap(uri, audit).apply {
      putBoolean("deleted", deleted)
      putInt("rows", rows)
      putString("deleteMethod", deleteMethod)
      putString("deleteResult", deleteResult)
      putString("postDeleteVerification", postDeleteVerification)
      putString("detail", detail)
    }
  }

  @ReactMethod
  fun inspectUri(uriString: String, promise: Promise) {
    if (!uriString.startsWith("content://")) {
      promise.resolve(
        Arguments.createMap().apply {
          putString("originalUri", uriString)
          putString("uriAuthority", "none")
          putString("uriType", "non-content URI")
          putString("provider", "Other provider")
          putBoolean("isDocumentProvider", false)
          putNull("supportsDelete")
        },
      )
      return
    }

    try {
      val uri = Uri.parse(uriString)
      val audit = auditUri(uri)
      android.util.Log.i(
        "SafDocument",
        "uri-audit originalUri=$uriString authority=${audit.authority} " +
          "type=${audit.uriType} provider=${audit.provider} " +
          "isDocumentProvider=${audit.isDocumentProvider} supportsDelete=${audit.supportsDelete}",
      )
      promise.resolve(auditMap(uri, audit))
    } catch (error: Exception) {
      promise.reject("URI_AUDIT_FAILED", "${error.javaClass.simpleName}: ${error.message ?: "unknown error"}")
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
      val audit = auditUri(uri)
      val existedBefore = queryState(uri)
      android.util.Log.i(
        "SafDocument",
        "delete-start uri=$uriString authority=${audit.authority} " +
          "type=${audit.uriType} provider=${audit.provider} existedBefore=$existedBefore " +
          "supportsDelete=${audit.supportsDelete}",
      )

      if (existedBefore != QueryState.EXISTS) {
        promise.resolve(
          resultMap(
            uri,
            audit,
            deleted = false,
            rows = 0,
            deleteMethod = "none",
            deleteResult = "not attempted",
            postDeleteVerification = existedBefore.name.lowercase(),
            detail = if (existedBefore == QueryState.GONE) {
              "Original document was already gone"
            } else {
              "Could not verify original document access before delete"
            },
          ),
        )
        return
      }

      // A DocumentsProvider MediaStore URI is a document wrapper around an
      // exact MediaStore row. Convert it through the Android API instead of
      // guessing an ID or calling delete() on the wrapper URI.
      val mediaUri = if (
        audit.provider == "MediaStore DocumentsProvider" &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      ) {
        resolveMediaStoreUri(uri)
      } else if (audit.provider == "MediaStore") {
        uri
      } else {
        null
      }

      if (mediaUri != null) {
        val rows = resolver.delete(mediaUri, null, null)
        val mediaAfter = queryState(mediaUri)
        val originalAfter = queryState(uri)
        val verified = mediaAfter == QueryState.GONE
        val postVerification = "mediaUri=${mediaAfter.name.lowercase()}, originalUri=${originalAfter.name.lowercase()}"
        val detail = if (verified) {
          "Exact MediaStore row deleted and verified"
        } else {
          "MediaStore delete was not verified; original media was retained"
        }
        android.util.Log.i(
          "SafDocument",
          "delete-result uri=$uriString method=MediaStore exactUri=$mediaUri rows=$rows " +
            "mediaAfter=$mediaAfter originalAfter=$originalAfter verified=$verified",
        )
        promise.resolve(
          resultMap(
            uri,
            audit,
            deleted = verified,
            rows = rows,
            deleteMethod = "MediaStore exact URI via ContentResolver.delete",
            deleteResult = "rows=$rows",
            postDeleteVerification = postVerification,
            detail = detail,
          ),
        )
        return
      }

      if (audit.isDocumentProvider) {
        if (audit.supportsDelete != true) {
          promise.resolve(
            resultMap(
              uri,
              audit,
              deleted = false,
              rows = 0,
              deleteMethod = "none",
              deleteResult = "provider does not expose FLAG_SUPPORTS_DELETE",
              postDeleteVerification = "not attempted",
              detail = "This DocumentsProvider does not advertise a supported delete operation; original media was retained",
            ),
          )
          return
        }

        val providerDeleted = DocumentsContract.deleteDocument(resolver, uri)
        val existsAfter = queryState(uri)
        val verified = providerDeleted && existsAfter == QueryState.GONE
        val postVerification = "originalUri=${existsAfter.name.lowercase()}"
        val detail = if (verified) {
          "DocumentsProvider deleteDocument succeeded and deletion was verified"
        } else {
          "DocumentsProvider delete was not verified; original media was retained"
        }
        android.util.Log.i(
          "SafDocument",
          "delete-result uri=$uriString method=DocumentsContract.deleteDocument " +
            "providerDeleted=$providerDeleted existsAfter=$existsAfter verified=$verified",
        )
        promise.resolve(
          resultMap(
            uri,
            audit,
            deleted = verified,
            rows = if (providerDeleted) 1 else 0,
            deleteMethod = "DocumentsContract.deleteDocument",
            deleteResult = "returned=$providerDeleted",
            postDeleteVerification = postVerification,
            detail = detail,
          ),
        )
        return
      }

      promise.resolve(
        resultMap(
          uri,
          audit,
          deleted = false,
          rows = 0,
          deleteMethod = "none",
          deleteResult = "unsupported provider",
          postDeleteVerification = "not attempted",
          detail = "Provider type is not a supported MediaStore or DocumentsProvider delete target; original media was retained",
        ),
      )
    } catch (error: UnsupportedOperationException) {
      val uri = Uri.parse(uriString)
      val audit = auditUri(uri)
      android.util.Log.w(
        "SafDocument",
        "delete-unsupported uri=$uriString authority=${audit.authority} " +
          "type=${audit.uriType} provider=${audit.provider} error=${error.message}",
      )
      promise.resolve(
        resultMap(
          uri,
          audit,
          deleted = false,
          rows = 0,
          deleteMethod = "provider operation rejected",
          deleteResult = "UnsupportedOperationException: ${error.message ?: "Delete not supported"}",
          postDeleteVerification = "not verified",
          detail = "Provider rejected the delete operation; original media was retained",
        ),
      )
    } catch (error: Exception) {
      val detail = "${error.javaClass.simpleName}: ${error.message ?: "unknown error"}"
      android.util.Log.e("SafDocument", "delete-exception uri=$uriString error=$detail", error)
      val uri = Uri.parse(uriString)
      val audit = auditUri(uri)
      promise.resolve(
        resultMap(
          uri,
          audit,
          deleted = false,
          rows = 0,
          deleteMethod = "provider operation failed",
          deleteResult = detail,
          postDeleteVerification = "not verified",
          detail = "Delete failed; original media was retained",
        ),
      )
    }
  }
}

class SafDocumentPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(SafDocumentModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
