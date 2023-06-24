import { CONSTANTS } from '@shared/constants'
import { ToastProps, toastSchema } from '@shared/types/toast'

import { mainWindow } from '../main'

const {
  channels: { get },
} = CONSTANTS

export const toast = {
  send: (arg: ToastProps) => {
    const message = toastSchema.parse(arg)
    mainWindow?.webContents.send(get.TOAST, message)
  },
}
