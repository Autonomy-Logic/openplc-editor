import { CONSTANTS } from '@shared/constants'
import { ToastProps as SharedToastMessageProps } from '@shared/types/toast'
import { createContext, FC, PropsWithChildren, useCallback } from 'react'
import { toast } from 'react-toastify'

import Toast, { ToastProps } from '@/components/Toast'
import { useIpcRender } from '@/hooks'
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
const {
  channels: { get },
} = CONSTANTS
/**
 * Context data type for managing toasts.
 */
export type ToastContextData = {
  /**
   * Function to create a toast message.
   * @param message - The toast message properties.
   */
  createToast: (message: ToastProps) => void
}
/**
 * Context for managing toast messages.
 */
export const ToastContext = createContext<ToastContextData>(
  {} as ToastContextData,
)
/**
 * Provider component for managing toast messages.
 */
const ToastProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * IPC renderer to receive toast messages from the main process
   */
  useIpcRender<undefined, SharedToastMessageProps>({
    channel: get.TOAST,
    callback: (ipcMessage) => {
      if (ipcMessage) {
        /**
         * Display toast message using react-toastify
         */
        toast(
          ({ closeToast }) => <Toast {...ipcMessage} closeToast={closeToast} />,
          {
            type: ipcMessage.type,
          },
        )
      }
    },
  })
  /**
   * Function to create a toast message.
   * @param message - The toast message properties.
   */
  const createToast = useCallback((message: SharedToastMessageProps) => {
    toast(({ closeToast }) => <Toast {...message} closeToast={closeToast} />, {
      type: message.type,
    })
  }, [])
  /**
   *  Provide the context with the createToast function.
   * @returns A JSX Component with the toast context provider
   */
  return (
    <ToastContext.Provider value={{ createToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export default ToastProvider
