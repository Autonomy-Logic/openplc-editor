import { appConfig } from '@shared/app.config'
import { CONSTANTS } from '@shared/constants'
import { Color, Titlebar } from 'custom-electron-titlebar'
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import colors from 'tailwindcss/colors'

import { useIpcRender, useProject, useTheme } from '@/hooks'

const { title } = appConfig
const {
  channels: { set },
} = CONSTANTS

export type TitlebarProps = InstanceType<typeof Titlebar>

export type TitlebarContextData = {
  dispose: () => void
}

export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
)

const TitlebarProvider: FC<PropsWithChildren> = ({ children }) => {
  const [titlebar, setTitlebar] = useState<TitlebarProps>()
  const { theme } = useTheme()
  const { project } = useProject()

  const { invoke } = useIpcRender<undefined, { ok: boolean }>()

  const dispose = useCallback(() => titlebar?.dispose(), [titlebar])

  useEffect(() => {
    setTitlebar((state) =>
      state
        ? state
        : new Titlebar({
            containerOverflow: 'hidden',
            backgroundColor: Color?.fromHex(colors.gray['900']),
          }),
    )
  }, [theme])

  useEffect(() => {
    const updateMenu = async () => {
      if (titlebar && project) {
        const { ok } = await invoke(set.UPDATE_MENU_PROJECT)
        if (ok) titlebar.refreshMenu()
      }
    }
    updateMenu()
  }, [invoke, titlebar, project])

  return (
    <TitlebarContext.Provider value={{ dispose }}>
      {children}
    </TitlebarContext.Provider>
  )
}

export default TitlebarProvider
