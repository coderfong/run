// Avatar rendering for Apple Watch synchronization.
// Renders the user's PASER character head as a base64 image for Watch display.

import React, { useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { CharacterRig } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';

const HEAD_SIZE = 256; // Size for Watch avatar rendering

/**
 * Render the user's PASER character head as a base64 image.
 * This image is sent to the Apple Watch for display.
 * 
 * @param {Object} equipped - The equipped cosmetics object
 * @returns {Promise<string|null>} Base64 encoded PNG data, or null on failure
 */
export async function renderWatchAvatar(equipped) {
  try {
    // Placeholder implementation - would need actual view rendering context
    // This should be integrated into the AvatarContext with a hidden renderer
    return null;
  } catch (error) {
    console.error('Failed to render watch avatar:', error);
    return null;
  }
}

/**
 * Hook component that renders the avatar head for Watch synchronization.
 * Use this in a hidden/offscreen area to generate the avatar image.
 */
export function WatchAvatarRenderer({ equipped, onReady }) {
  const viewRef = useRef(null);
  
  React.useEffect(() => {
    const captureAvatar = async () => {
      try {
        if (viewRef.current) {
          const uri = await captureRef(viewRef, {
            format: 'png',
            quality: 0.9,
            width: HEAD_SIZE,
            height: HEAD_SIZE,
          });
          
          // Convert URI to base64 - would need file system handling
          onReady?.(uri);
        }
      } catch (error) {
        console.error('Failed to capture watch avatar:', error);
        onReady?.(null);
      }
    };
    
    // Small delay to ensure rendering is complete
    const timer = setTimeout(captureAvatar, 100);
    return () => clearTimeout(timer);
  }, [equipped, onReady]);
  
  return (
    <View ref={viewRef} style={styles.hiddenContainer}>
      <CharacterRig
        equipped={equipped}
        size={HEAD_SIZE}
        headOnly={true}
        animate={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    left: -HEAD_SIZE,
    top: -HEAD_SIZE,
    width: HEAD_SIZE,
    height: HEAD_SIZE,
    opacity: 0,
  },
});

/**
 * Simplified version that generates avatar data when cosmetics change.
 * This should be called from the AvatarContext when equipped changes.
 */
export function useWatchAvatarSync(equipped) {
  const [avatarData, setAvatarData] = React.useState(null);
  
  React.useEffect(() => {
    // Trigger avatar render when equipped changes
    // This would integrate with the actual rendering logic
    renderWatchAvatar(equipped).then(setAvatarData);
  }, [equipped]);
  
  return avatarData;
}
