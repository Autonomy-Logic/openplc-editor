import { useContext } from 'react';

import { ToastContext } from '../contexts';
import { ToastContextData } from '../contexts/Toast';
/**
 * Custom hook to interact with the toast context
 * @function
 * @returns {ToastContextData} - Toast context data
 */
const useToast = (): ToastContextData => {
  /**
   * Get the toast context from the ToastProvider
   */
  const context = useContext(ToastContext);
  /**
   * Throw an error if the hook is not used within a ToastProvider
   */
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};

export default useToast;
