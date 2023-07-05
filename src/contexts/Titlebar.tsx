// import { appConfig } from '@shared/app.config'
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
import colors from 'tailwindcss/colors'

import { useIpcRender, useProject, useTheme } from '@/hooks'

// const { title } = appConfig

const {
  channels: { set },
} = CONSTANTS

export type TitlebarProps = InstanceType<typeof Titlebar>

export type TitlebarContextData = {
  dispose: () => void
  updateTitle: (title: string) => void
}

export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
)

const TitlebarProvider: FC<PropsWithChildren> = ({ children }) => {
  const [titlebar, setTitlebar] = useState<TitlebarProps>()
  const { theme } = useTheme()
  const { project } = useProject()

  const { invoke } = useIpcRender<undefined, { ok: boolean }>()

  const dispose = useCallback(() => titlebar && titlebar.dispose(), [titlebar])

  const updateTitle = useCallback(
    (title: string) => titlebar && titlebar.updateTitle(title),
    [titlebar],
  )

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

  // useEffect(() => {
  //   if (titlebar) updateTitle(title)
  // }, [titlebar, updateTitle])

  return (
    <TitlebarContext.Provider value={{ dispose, updateTitle }}>
      {children}
    </TitlebarContext.Provider>
  )
}

export default TitlebarProvider
