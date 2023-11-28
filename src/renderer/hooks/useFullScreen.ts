// Review this eslint rule
/* eslint-disable eqeqeq */
// Review this eslint rule
/* eslint-disable no-restricted-globals */
import { useCallback, useEffect, useState } from 'react';
/**
 * Props interface for the useFullScreen hook
 * @interface FullScreenProps
 */
export type FullScreenProps = {
  isFullScreen: boolean;
  requestFullscreen: () => void;
  exitFullScreen: () => void;
};
/**
 * Custom hook to manage full screen functionality
 * @function
 * @returns {FullScreenProps} FullScreenProps object containing functions and state related to full screen
 */
const useFullScreen = (): FullScreenProps => {
  /**
   * State to track whether the app is in full screen mode
   * @type {boolean}
   */
  const [isFullScreen, setIsFullScreen] = useState(
    window.innerHeight == screen.height,
  );
  /**
   * Reference to the document's root element
   * @type {HTMLElement}
   */
  const { documentElement } = document;
  /**
   * Function to request full screen mode
   * @function
   */
  const requestFullscreen = useCallback(() => {
    if (documentElement && documentElement.requestFullscreen)
      documentElement.requestFullscreen();
  }, [documentElement]);
  /**
   * Function to exit full screen mode
   * @function
   */
  const exitFullScreen = useCallback(() => {
    if (document && document.exitFullscreen) document.exitFullscreen();
  }, []);
  /**
   * Listen for resize events and update full screen state
   */
  useEffect(() => {
    const resize = () => {
      if (window.innerHeight == screen.height) {
        setIsFullScreen(true);
      } else {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  /**
   * Listen for fullscreenchange events and update full screen state
   */
  useEffect(() => {
    const fullscreenchange = () => {
      if (document.fullscreenElement) {
        setIsFullScreen(true);
      } else {
        setIsFullScreen(false);
      }
    };
    document.addEventListener('fullscreenchange', fullscreenchange);
    return () => window.removeEventListener('resize', fullscreenchange);
  }, []);
  /**
   * Return the FullScreenProps object containing functions and state related to full screen
   */
  return {
    requestFullscreen,
    exitFullScreen,
    isFullScreen,
  };
};

export default useFullScreen;
