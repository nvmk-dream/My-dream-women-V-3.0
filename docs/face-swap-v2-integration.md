# Face Swap integration notes — My Dream Women V2.0

This is the working log for the private V2 integration branch. Update this file with each meaningful code, build, or design change so V3 integration can reuse the verified decisions.

## Rules that must remain in force

1. **Render deploy stays off.** The V2 GitHub Actions workflow is for APK builds/releases only. The Render redeploy option and API trigger are removed, and the Render Blueprint sets `autoDeploy: false`. Do not manually dispatch a Render deployment.
2. **Keep photos for the main Face Swap route local.** Source photos and results in the integrated Studio must stay on the device. Do not add cloud upload, remote inference, or cloud-storage fallback to this route.
3. **Do not bundle the model pack.** The ONNX pack is about 3.25 GB uncompressed. Users import model files from the device when needed; no ONNX model files belong in the APK or Git history.
4. **Record each integration update here.** This private V2 repository is the handoff record for the later V3 integration.

## Integration approach

- V2 opens the existing native FaceSwap Studio screen as an Android Activity from its `Face Swap` route.
- The current integration is a source snapshot, not yet a Git submodule. The standalone Face Swap app remains independently updateable; updating this V2 copy still requires a new V2 APK build.
- The copied Kotlin/Compose screen, ONNX Runtime and local model import behavior are retained. The main route's source/result photos are processed on-device.
- Imported ONNX files are copied into V2's app-private storage. The V2 and standalone app do not automatically share their private model folders, so importing into V2 can use additional phone storage.
- The existing V3 Render API URL remains configured for the app's unrelated backend features. This Face Swap route does not send images there, but the V2 APK is not fully backend-isolated.
- Before applying this to V3, evaluate extracting the tested native code into a shared module/submodule so both apps can consume the same maintained source.
- The separate Group Chat Face Swap flow still uploads to Cloudinary and calls `/api/face-swap`. It was not changed by this main-route integration; do not describe all app face-swap flows as local until that separate path is addressed.

## Progress log

### 2026-10-24 — private V2 integration started

- Work is isolated on `feature/faceswap-native-v2`; V3 production code is not changed.
- FaceSwap Studio source snapshot: `nvmk-dream/Face-swap`, commit `aed3b3181086706f9f22991c785c0ff75314b500`.
- Added the native screen sources and three small UI images. ONNX model binaries are not included.
- Replaced the old cloud face-swap route with a native-screen launcher; no cloud fallback is included.
- Disabled the Render redeploy path in the V2 APK workflow and set the Render Blueprint to `autoDeploy: false`.
- Expo Android prebuild succeeded and generated the native Activity, React Native bridge, manifest entry, Compose dependencies, and local resources.
- The full TypeScript check still reports 24 errors in unrelated existing files; the new Face Swap route has no reported type errors.
- Found a separate Group Chat cloud face-swap path; it is unchanged and documented as out of scope for this main-route integration.
- Confirmed the existing V3 Render API base URL remains for other app features; no V2 Render deployment or backend change was made.
- The first APK workflow run stalled while installing ImageMagick and was canceled. The workflow now uses the runner's copy when available and limits fallback package installation to five minutes.
- APK workflow run 2 passed JavaScript bundling but failed in Kotlin compilation: the native bridge used an unqualified `currentActivity`, which also caused the activity-launch and `Intent` type errors. `openFaceSwap` now reads the Activity from `ReactApplicationContext`; APK verification is pending. Render was not triggered. [Run 2](https://github.com/nvmk-dream/My-dream-women-V-2-0/actions/runs/40047502052)
- APK workflow run 3 on commit `5947bcd` succeeded: Kotlin compilation and APK validation passed, and the private `v3` GitHub Release was created. The APK is 320,270,593 bytes; no Render deployment was triggered. [Run 3](https://github.com/nvmk-dream/My-dream-women-V-2-0/actions/runs/40913507144)
