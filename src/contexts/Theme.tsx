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

const {
  theme: { variants },
  channels: { get, set },
} = CONSTANTS

export type ThemeState = typeof variants.DARK | typeof variants.LIGHT

export type ThemeContextData = {
  theme?: ThemeState
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextData>(
  {} as ThemeContextData,
)

const ThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  const { invoke } = useIpcRender<ThemeProps | undefined, ThemeProps>()

  const [theme, setTheme] = useState<ThemeState>()

  const { documentElement: html } = document

  const addDarkClass = useCallback(() => {
    html.classList.add(variants.DARK)
  }, [html.classList])

  const removeDarkClass = useCallback(() => {
    html.classList.remove(variants.DARK)
  }, [html.classList])

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
