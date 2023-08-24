import { CONSTANTS } from '@shared/constants'
import { ThemeProps } from '@shared/types/theme'
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'

import { useIpcRender } from '@/hooks'
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
const {
  theme: { variants },
  channels: { get, set },
} = CONSTANTS
/**
 * Type representing the possible theme states.
 */
export type ThemeState = typeof variants.DARK | typeof variants.LIGHT
/**
 * Context data type for managing theme.
 */
export type ThemeContextData = {
  /**
   * Current theme state.
   */
  theme?: ThemeState
  /**
   * Function to toggle the theme.
   */
  toggleTheme: () => void
}
/**
 * Context for managing theme state.
 */
export const ThemeContext = createContext<ThemeContextData>(
  {} as ThemeContextData,
)
/**
 * Provider component for managing theme state.
 * @returns A JSX Component with the theme context provider
 */
const ThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * Extract the invoke function from ipc render hook to manipulate the theme state.
   */
  const { invoke } = useIpcRender<ThemeProps | undefined, ThemeProps>()
  /**
   * State to store the current theme.
   */
  const [theme, setTheme] = useState<ThemeState>()
  /**
   * Access the `documentElement` of the `document`.
   */
  const { documentElement: html } = document
  /**
   * Adds the dark theme class to the HTML element.
   */
  const addDarkClass = useCallback(() => {
    html.classList.add(variants.DARK)
  }, [html.classList])
  /**
   * Removes the dark theme class from the HTML element.
   */
  const removeDarkClass = useCallback(() => {
    html.classList.remove(variants.DARK)
  }, [html.classList])
  /**
   * Toggles between light and dark themes.
   */
  const toggleTheme = useCallback(() => {
    setTheme((state) => {
      if (state === variants.LIGHT) {
        addDarkClass()
        invoke(set.THEME, variants.DARK)
        return variants.DARK
      } else {
        removeDarkClass()
        invoke(set.THEME, variants.LIGHT)
        return variants.LIGHT
      }
    })
  }, [addDarkClass, invoke, removeDarkClass])
  /**
   * Use effect hook to set the initial theme based on user preferences or stored theme.
   */
  useEffect(() => {
    const getStoredTheme = async () => {
      const storedTheme = await invoke(get.THEME)
      setTheme(() => {
        if (storedTheme) {
          if (storedTheme === variants.DARK) {
            addDarkClass()
            return variants.DARK
          } else {
            removeDarkClass()
            return variants.LIGHT
          }
        } else if (
          window.matchMedia(`(prefers-color-scheme: ${variants.DARK})`).matches
        ) {
          addDarkClass()
          return variants.DARK
        } else {
          removeDarkClass()
          return variants.LIGHT
        }
      })
    }
    getStoredTheme()
  }, [addDarkClass, invoke, removeDarkClass])
  /**
   * Provide the context with theme data.
   */
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export default ThemeProvider
