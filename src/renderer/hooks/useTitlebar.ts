import { useContext } from 'react';

import { TitlebarContext } from '../contexts';
import { TitlebarContextData } from '../contexts/Titlebar';
/**
 * Custom hook to interact with the titlebar context
 * @function
 * @returns {TitlebarContextData} - Titlebar context data
 */
const useTitlebar = (): TitlebarContextData => {
  /**
   * Get the titlebar context from the TitlebarProvider
   */
  const context = useContext(TitlebarContext);
  /**
   * Throw an error if the hook is not used within a TitlebarProvider
   */
  if (!context)
    throw new Error('useTitlebar must be used within a TitlebarProvider');
  return context;
};

export default useTitlebar;
