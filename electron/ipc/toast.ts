import { CONSTANTS } from '../../shared/constants'
import { ToastProps, toastSchema } from '../../shared/types/toast'
import { mainWindow } from '../main'

const {
  channels: { get },
} = CONSTANTS

/**
 * Provides methods for displaying toast messages.
 */
export const toast = {
  /**
   * Sends a toast message to the main window.
   * @param arg - The toast message properties.
   */
  send: (arg: ToastProps) => {
    const message = toastSchema.parse(arg)
    mainWindow?.webContents.send(get.TOAST, message)
  },
}
