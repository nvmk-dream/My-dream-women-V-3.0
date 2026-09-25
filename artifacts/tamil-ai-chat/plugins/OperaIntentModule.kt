package com.smk1.tamilaichat

import android.content.Intent
import android.net.Uri
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class OperaIntentModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "OperaIntent"

  @ReactMethod
  fun openUrl(url: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        // setPackage is the important part: Android cannot choose the default
        // browser or show a chooser when this package is unavailable.
        setPackage("com.opera.browser")
      }

      if (intent.resolveActivity(reactContext.packageManager) == null) {
        promise.reject("OPERA_NOT_INSTALLED", "Opera Browser is not installed")
        return
      }

      val activity = reactContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "The app activity is not available")
        return
      }

      activity.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OPERA_OPEN_FAILED", error.message, error)
    }
  }
}

class OperaIntentPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(OperaIntentModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}