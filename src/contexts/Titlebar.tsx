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
import { useStore } from 'zustand'

import { useFullScreen, useIpcRender } from '@/hooks'
import projectStore from '@/stores/Project'
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
const {
  channels: { set },
} = CONSTANTS
/**
 * Type representing the props of the custom Titlebar.
 */
export type TitlebarProps = InstanceType<typeof Titlebar>
/**
 * Context data type for managing the custom Titlebar.
 */
export type TitlebarContextData = {
  /**
   * The custom Titlebar instance.
   */
  titlebar?: TitlebarProps
  /**
   * Function to dispose of the custom Titlebar.
   */
  dispose: () => void
}
/**
 * Context for managing the custom Titlebar state.
 */
export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
)
/**
 * Provider component for managing the custom Titlebar.
 * @returns A JSX Component with the titlebar context provider
 */
const TitlebarProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * State to hold the custom Titlebar instance
   */
  const [titlebar, setTitlebar] = useState<TitlebarProps>()
  /**
   * Get project data from hooks
   */
  const { projectXmlAsObj } = useStore(projectStore)
  /**
   * Get fullscreen mode state from hooks
   */
  const { isFullScreen } = useFullScreen()
  /**
   * IPC renderer for invoking communication with the main process
   */
  const { invoke } = useIpcRender<undefined, { ok: boolean }>()
  /**
   * Disposes of the custom Titlebar instance.
   */
  const dispose = useCallback(() => titlebar && titlebar.dispose(), [titlebar])

  useEffect(() => {
    /**
     * Initialize the custom Titlebar instance
     */
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
    /**
     * Updates the menu when the project is updated.
     */
    const updateMenu = async () => {
      if (titlebar && projectXmlAsObj) {
        const { ok } = await invoke(set.UPDATE_MENU_PROJECT)
        if (ok) titlebar.refreshMenu()
      }
    }
    updateMenu()
  }, [invoke, titlebar, projectXmlAsObj])

  useEffect(() => {
    /**
     * Updates the container style based on fullscreen mode.
     */
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

  /**
   * Provide the context with Titlebar data.
   */
  return (
    <TitlebarContext.Provider value={{ dispose, titlebar }}>
      {children}
    </TitlebarContext.Provider>
  )
}

export default TitlebarProvider
