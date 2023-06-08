import { CONSTANTS } from '@shared/constants';
import { ToastProps as SharedToastMessageProps } from '@shared/types/toast';
import React, { createContext, PropsWithChildren, useCallback } from 'react';
import { toast } from 'react-toastify';

import Toast, { ToastProps } from '@/components/Toast';
import { useIpcRender } from '@/hooks';

const {
  channels: { get },
} = CONSTANTS;

export type ToastContextData = {
  createToast: (message: ToastProps) => void;
};

export const ToastContext = createContext<ToastContextData>({} as ToastContextData);

const ToastProvider: React.FC<PropsWithChildren> = ({ children }) => {
  useIpcRender<undefined, SharedToastMessageProps>({
    channel: get.TOAST,
    callback: (ipcMessage) => {
      if (ipcMessage) {
        toast(({ closeToast }) => <Toast {...ipcMessage} closeToast={closeToast} />, {
          type: ipcMessage.type,
        });
      }
    },
  });

  const createToast = useCallback((message: SharedToastMessageProps) => {
    toast(({ closeToast }) => <Toast {...message} closeToast={closeToast} />, {
      type: message.type,
    });
  }, []);

  return (
    <ToastContext.Provider value={{ createToast }}>{children}</ToastContext.Provider>
  );
};

export default ToastProvider;
