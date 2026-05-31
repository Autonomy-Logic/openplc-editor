import React, { useState, useEffect } from 'react';
import { DownloadService } from '../../services/DownloadService';
import { ConsoleManager } from '../../managers/ConsoleManager';

interface MainWindowProps {
  // existing props
}

const MainWindow: React.FC<MainWindowProps> = (props) => {
  const [consoleVisible, setConsoleVisible] = useState(false);
  
  useEffect(() => {
    const downloadService = DownloadService.getInstance();
    const consoleManager = ConsoleManager.getInstance();
    
    const handleDownloadStart = () => {
      consoleManager.setAutoShow(true);
    };
    
    const handleDownloadComplete = () => {
      consoleManager.setAutoShow(false);
    };
    
    downloadService.on('download-start', handleDownloadStart);
    downloadService.on('download-complete', handleDownloadComplete);
    
    return () => {
      downloadService.off('download-start', handleDownloadStart);
      downloadService.off('download-complete', handleDownloadComplete);
    };
  }, []);
  
  // existing component code
  
  return (
    // existing JSX
  );
};

export default MainWindow;