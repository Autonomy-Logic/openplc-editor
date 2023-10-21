import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useMemo,
} from 'react';
import { toast } from 'react-toastify';
import { ToastProps as SharedToastMessageProps } from '../../types/toast';
// import { CONSTANTS } from '../../constants';

import { Toast } from '../components';
// Todo: Resolve ipc communication
// import { useIpcRender } from '@/hooks';
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
// const {
//   channels: { get },
// } = CONSTANTS;
/**
 * Context data type for managing toasts.
 */
type ToastProps = SharedToastMessageProps & {
  // Review this eslint rule
  // eslint-disable-next-line react/require-default-props
  closeToast?: () => void;
};
export type ToastContextData = {
  /**
   * Function to create a toast message.
   * @param message - The toast message properties.
   */
  createToast: (message: ToastProps) => void;
};
/**
 * Context for managing toast messages.
 */
export const ToastContext = createContext<ToastContextData>(
  {} as ToastContextData,
);
/**
 * Provider component for managing toast messages.
 */
// review this eslint rule
// eslint-disable-next-line react/function-component-definition
const ToastProvider: FC<PropsWithChildren> = ({ children }) => {
  // Todo: Resolve ipc communication
  /**
   * IPC renderer to receive toast messages from the main process
   */
  // useIpcRender<undefined, SharedToastMessageProps>({
  //   channel: get.TOAST,
  //   callback: (ipcMessage) => {
  //     if (ipcMessage) {
  //       /**
  //        * Display toast message using react-toastify
  //        */
  //       toast(
  //         ({ closeToast }) => <Toast {...ipcMessage} closeToast={closeToast} />,
  //         {
  //           type: ipcMessage.type,
  //         },
  //       );
  //     }
  //   },
  // });
  /**
   * Function to create a toast message.
   * @param message - The toast message properties.
   */
  const createToast = useCallback((message: SharedToastMessageProps) => {
    // Review eslint rule
    // eslint-disable-next-line react/jsx-props-no-spreading
    toast(({ closeToast }) => <Toast {...message} closeToast={closeToast} />, {
      type: message.type,
    });
  }, []);
  const defaultValue = useMemo(() => ({ createToast }), [createToast]);
  /**
   *  Provide the context with the createToast function.
   * @returns A JSX Component with the toast context provider
   */
  return (
    <ToastContext.Provider value={defaultValue}>
      {children}
    </ToastContext.Provider>
  );
};

export default ToastProvider;
