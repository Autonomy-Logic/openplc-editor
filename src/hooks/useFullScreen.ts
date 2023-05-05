import { useEffect, useState } from 'react';
export type FullScreenProps = {
  isFullScreen: boolean;
  requestFullscreen: () => void;
  exitFullScreen: () => void;
};
const useFullScreen = (): FullScreenProps => {
  const [isFullScreen, setIsFullScreen] = useState(window.innerHeight == screen.height);

  const { documentElement } = document;

  const requestFullscreen = () => {
    if (documentElement && documentElement.requestFullscreen)
      documentElement.requestFullscreen();
  };

  const exitFullScreen = () => {
    if (document && document.exitFullscreen) document.exitFullscreen();
  };

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

  return {
    requestFullscreen,
    exitFullScreen,
    isFullScreen,
  };
};

export default useFullScreen;
