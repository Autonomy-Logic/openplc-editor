import { CONSTANTS } from '@shared/constants';
import { ToastMessageProps } from '@shared/types/message';
import React, { createContext, PropsWithChildren, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';

import Toast, { ToastProps } from '@/components/Toast';
import { useIpcRender } from '@/hooks';

const { channels } = CONSTANTS;

export type ToastContextData = {
  createToast: (message: ToastProps) => void;
};

export const ToastContext = createContext<ToastContextData>({} as ToastContextData);

const ToastProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { data: ipcMessage } = useIpcRender<ToastMessageProps>({
    get: channels.SET_TOAST,
  });

  const createToast = useCallback((message: ToastMessageProps) => {
    toast(({ closeToast }) => <Toast {...message} closeToast={closeToast} />, {
      closeButton: false,
      closeOnClick: false,
      type: message.type,
    });
  }, []);

  useEffect(() => {
    if (ipcMessage) {
      toast(({ closeToast }) => <Toast {...ipcMessage} closeToast={closeToast} />, {
        closeButton: false,
        closeOnClick: false,
        type: ipcMessage.type,
      });
    }
  }, [ipcMessage]);

  return (
    <ToastContext.Provider value={{ createToast }}>{children}</ToastContext.Provider>
  );
};

export default ToastProvider;
