import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Modal, View, TouchableOpacity, Text, StatusBar,
  StyleSheet, Dimensions, ActivityIndicator, Platform,
  PanResponder, Linking,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';

const { width: W, height: H } = Dimensions.get('window');

interface Props {
  uri: string | null;
  onClose: () => void;
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export default function MediaVideoPlayer({ uri, onClose }: Props) {
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition]   = useState(0);
  const [duration, setDuration]   = useState(0);
  const [isLoaded, setIsLoaded]   = useState(false);
  const [isMuted, setIsMuted]     = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const seekBarRef = useRef<View>(null);
  const seekBarWidthRef = useRef(W - 48);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setShowControls(true);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3500);
  }, []);

  useEffect(() => {
    if (uri) {
      setIsPlaying(false);
      setPosition(0);
      setDuration(0);
      setIsLoaded(false);
      setLoadError(false);
      setShowControls(true);
      resetControlsTimer();
    }
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [uri]);

  const handleStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if ((status as any).error) setLoadError(true);
      return;
    }
    setIsLoaded(true);
    setIsPlaying(status.isPlaying);
    setPosition(status.positionMillis ?? 0);
    setDuration(status.durationMillis ?? 0);
    if (status.didJustFinish) {
      setIsPlaying(false);
      videoRef.current?.setPositionAsync(0);
    }
  }, []);

  const togglePlay = useCallback(async () => {
    if (!isLoaded) return;
    resetControlsTimer();
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
    } else {
      await videoRef.current?.playAsync();
    }
  }, [isPlaying, isLoaded, resetControlsTimer]);

  const seekTo = useCallback(async (ratio: number) => {
    if (!isLoaded || duration === 0) return;
    const ms = Math.max(0, Math.min(duration, ratio * duration));
    await videoRef.current?.setPositionAsync(ms);
    resetControlsTimer();
  }, [isLoaded, duration, resetControlsTimer]);

  const seekPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        seekTo(x / seekBarWidthRef.current);
      },
      onPanResponderMove: (evt) => {
        const x = Math.max(0, Math.min(seekBarWidthRef.current, evt.nativeEvent.locationX));
        seekTo(x / seekBarWidthRef.current);
      },
    })
  ).current;

  const openInBrowser = () => {
    if (uri) Linking.openURL(uri);
  };

  const progress = duration > 0 ? position / duration : 0;

  if (!uri) return null;

  return (
    <Modal
      visible={!!uri}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <StatusBar hidden />
      <View style={styles.container}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.videoWrap}
          onPress={() => { setShowControls(v => !v); resetControlsTimer(); }}
        >
          {loadError ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorTxt}>⚠️ Video load error</Text>
              <TouchableOpacity style={styles.browserBtn} onPress={openInBrowser}>
                <Text style={styles.browserTxt}>🌐 Browser-ல் திற</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Video
              ref={videoRef}
              source={{ uri }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={false}
              isLooping={false}
              isMuted={isMuted}
              onPlaybackStatusUpdate={handleStatus}
              onError={() => setLoadError(true)}
              useNativeControls={false}
            />
          )}
          {!isLoaded && !loadError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.loadingTxt}>Video load ஆகுது...</Text>
            </View>
          )}
        </TouchableOpacity>

        {showControls && !loadError && (
          <View style={styles.controls}>
            <View style={styles.topBar}>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeTxt}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openInBrowser} style={styles.browserIconBtn}>
                <Text style={styles.browserIconTxt}>🌐</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.bottomControls}>
              <View
                ref={seekBarRef}
                style={styles.seekBar}
                onLayout={e => { seekBarWidthRef.current = e.nativeEvent.layout.width; }}
                {...seekPanResponder.panHandlers}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` as any }]} />
                </View>
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.timeText}>{fmtTime(position)}</Text>

                <View style={styles.centerBtns}>
                  <TouchableOpacity onPress={() => seekTo(Math.max(0, (position - 10000) / duration))} style={styles.skipBtn}>
                    <Text style={styles.skipTxt}>⏪ 10s</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={togglePlay} style={styles.playBtn} disabled={!isLoaded}>
                    <Text style={styles.playTxt}>{isPlaying ? '⏸' : '▶'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => seekTo(Math.min(1, (position + 10000) / duration))} style={styles.skipBtn}>
                    <Text style={styles.skipTxt}>10s ⏩</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.rightBtns}>
                  <TouchableOpacity onPress={() => setIsMuted(v => !v)} style={styles.muteBtn}>
                    <Text style={styles.muteTxt}>{isMuted ? '🔇' : '🔊'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.timeText}>{fmtTime(duration)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {!showControls && (
          <TouchableOpacity style={styles.closeMinimal} onPress={onClose}>
            <Text style={styles.closeTxt}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: W,
    height: H,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 12,
  },
  loadingTxt: {
    color: '#fff',
    fontSize: 14,
  },
  errorWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 32,
  },
  errorTxt: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  browserBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  browserTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeTxt: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  browserIconBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  browserIconTxt: {
    fontSize: 18,
  },
  bottomControls: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    paddingHorizontal: 16,
    gap: 6,
  },
  seekBar: {
    height: 32,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  seekTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    position: 'relative',
  },
  seekFill: {
    height: 4,
    backgroundColor: '#E91E8C',
    borderRadius: 2,
  },
  seekThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
    top: -5,
    marginLeft: -7,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  centerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skipBtn: {
    padding: 6,
  },
  skipTxt: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '600',
  },
  playBtn: {
    backgroundColor: 'rgba(233,30,140,0.85)',
    borderRadius: 28,
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playTxt: {
    color: '#fff',
    fontSize: 22,
  },
  rightBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  muteBtn: {
    padding: 4,
  },
  muteTxt: {
    fontSize: 18,
  },
  timeText: {
    color: '#ddd',
    fontSize: 12,
    fontWeight: '500',
    minWidth: 36,
  },
  closeMinimal: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 36,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
