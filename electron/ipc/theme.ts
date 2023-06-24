import { CONSTANTS } from '@shared/constants'
import { ThemeProps, themeSchema } from '@shared/types/theme'
import { ipcMain } from 'electron'

import { store } from '../store'

const {
  channels: { get, set },
} = CONSTANTS

export const themeIpc = () => {
  ipcMain.handle(get.THEME, () => {
    const theme = store.get('theme') as ThemeProps
    return theme
  })

  ipcMain.handle(set.THEME, (_event, arg: ThemeProps) => {
    const theme = themeSchema.parse(arg)
    store.set('theme', theme)
    return { ok: true }
  })
}
