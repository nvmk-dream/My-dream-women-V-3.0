# Face Swap Integration Notes — My Dream Women V3.0

This record documents the integration of the native on-device Face Swap Studio from V2.0 (`feature/faceswap-native-v2`) into V3.0 (`main`).

## Architecture & Integration Details
1. **On-Device Native Processing**:
   - Built on Android Native Kotlin + Jetpack Compose with ONNX Runtime (`com.microsoft.onnxruntime:onnxruntime-android:1.20.0`) and Google MLKit (`com.google.mlkit:face-detection:16.1.7`).
   - All processing runs directly on the device using local hardware acceleration.
2. **Model Handling**:
   - Model files (such as inswapper, ArcFace, SCRFD) are imported locally by the user from device storage.
   - Large model weights (~3.25 GB) are not bundled inside the APK, keeping the build size lightweight and compliant.
3. **React Native Bridge**:
   - Native modules `FaceSwapStudioModule.kt` and `FaceSwapStudioPackage.kt` registered in Android MainApplication via `plugins/withFaceSwapNative.js`.
   - React Native route `artifacts/tamil-ai-chat/app/face-swap.tsx` acts as the seamless bridge launcher styled with the V3 Spring Roses luxury glassmorphism theme.
4. **Build System & Workflow**:
   - Expo config plugin `withFaceSwapNative.js` configures `build.gradle`, adds Compose BOM `2024.09.00`, sets `largeHeap=true`, and injects native sources during prebuild.
   - `.github/workflows/build-apk.yml` includes fast ImageMagick check to prevent pipeline timeouts.
