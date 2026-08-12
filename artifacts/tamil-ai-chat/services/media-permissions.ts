import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

/**
 * Request the media permissions used by the app's image/video pickers.
 *
 * On Android 13+ / 14+, expo-media-library maps these granular values to
 * READ_MEDIA_IMAGES and READ_MEDIA_VIDEO and also handles
 * READ_MEDIA_VISUAL_USER_SELECTED for partial photo access.
 */
export async function requestPhotoVideoPermissionsAsync() {
  if (Platform.OS === 'web') {
    return { granted: true };
  }

  if (Platform.OS === 'android') {
    return MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  }

  return MediaLibrary.requestPermissionsAsync();
}