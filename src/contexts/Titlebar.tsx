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

import { useFullScreen, useIpcRender, useProject } from '@/hooks'

const {
  channels: { set },
} = CONSTANTS

export type TitlebarProps = InstanceType<typeof Titlebar>

export type TitlebarContextData = {
  titlebar?: TitlebarProps
  dispose: () => void
}

export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
)

const TitlebarProvider: FC<PropsWithChildren> = ({ children }) => {
  const [titlebar, setTitlebar] = useState<TitlebarProps>()
  const { project } = useProject()
  const { isFullScreen } = useFullScreen()

  const { invoke } = useIpcRender<undefined, { ok: boolean }>()

  const dispose = useCallback(() => titlebar && titlebar.dispose(), [titlebar])

  useEffect(() => {
    setTitlebar((state) =>
      state
        ? state
        : new Titlebar({
            containerOverflow: 'hidden',
            backgroundColor: Color?.fromHex(colors.gray['900']),
          }),
    )
  }, [])

  useEffect(() => {
    const updateMenu = async () => {
      if (titlebar && project) {
        const { ok } = await invoke(set.UPDATE_MENU_PROJECT)
        if (ok) titlebar.refreshMenu()
      }
    }
    updateMenu()
  }, [invoke, titlebar, project])

  useEffect(() => {
    const [titlebar] = document.getElementsByClassName('cet-titlebar')
    const [container] = document.getElementsByClassName('cet-container')

    if (titlebar && container) {
      if (isFullScreen) {
        container.classList.replace('!top-16', '!top-0')
      } else {
        container.classList.add('!top-16')
        container.classList.replace('!top-0', '!top-16')
      }
    }
  }, [isFullScreen])

  return (
    <TitlebarContext.Provider value={{ dispose, titlebar }}>
      {children}
    </TitlebarContext.Provider>
  )
}

export default TitlebarProvider
