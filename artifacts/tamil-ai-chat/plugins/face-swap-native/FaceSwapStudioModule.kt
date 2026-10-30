package com.smk1.tamilaichat

import android.app.Activity
import android.content.Intent
import com.example.FaceSwapActivity
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FaceSwapStudioModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private var pendingPromise: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != REQUEST_CODE) return
      pendingPromise?.resolve(true)
      pendingPromise = null
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "FaceSwapStudio"

  @ReactMethod
  fun openFaceSwap(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "The app activity is not available.")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_ALREADY_OPEN", "Face Swap is already open.")
      return
    }

    pendingPromise = promise
    try {
      activity.startActivityForResult(
        Intent(activity, FaceSwapActivity::class.java),
        REQUEST_CODE,
      )
    } catch (error: Exception) {
      pendingPromise = null
      promise.reject("E_FACE_SWAP_START", error.message ?: "Could not open Face Swap.")
    }
  }

  private companion object {
    const val REQUEST_CODE = 8472
  }
}
