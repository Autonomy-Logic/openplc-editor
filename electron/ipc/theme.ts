import { CONSTANTS } from '@shared/constants'
import { ThemeProps, themeSchema } from '@shared/types/theme'
import { ipcMain } from 'electron'

import { store } from '../store'

const {
  channels: { get, set },
} = CONSTANTS

/**
 * Sets up IPC event handling for theme-related actions.
 */
export const themeIpc = () => {
  /**
   * Handles the IPC event to retrieve the current theme.
   */
  ipcMain.handle(get.THEME, () => {
    const theme = store.get('theme') as ThemeProps
    return theme
  })

  /**
   * Handles the IPC event to set and update the application theme.
   * @param _event - The IPC event.
   * @param arg - The new theme properties.
   * @returns A response indicating the success of the operation.
   */
  ipcMain.handle(set.THEME, (_event, arg: ThemeProps) => {
    const theme = themeSchema.parse(arg)
    store.set('theme', theme)
    return { ok: true }
  })
}
