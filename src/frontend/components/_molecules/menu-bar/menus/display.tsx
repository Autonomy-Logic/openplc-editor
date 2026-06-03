import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useEffect, useState } from 'react'

import { i18n } from '../../../../locales/i18n'
import { useOpenPLCStore } from '../../../../store'
import { MenuClasses } from '../constants'

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>
  msRequestFullscreen?: () => Promise<void>
}

type ThemeChoice = 'light' | 'dark' | 'nineties'

// Cycle order for the Display ▸ Theme menu: Light → Dark → 90's → Light.
const THEME_ORDER: readonly ThemeChoice[] = ['light', 'dark', 'nineties']
const THEME_LABEL: Record<ThemeChoice, string> = { light: 'light', dark: 'dark', nineties: "90's" }

function getThemePreference(): ThemeChoice {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light' || stored === 'nineties') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const DisplayMenu = () => {
  const {
    workspaceActions: { setSystemConfigs, toggleCollapse },
  } = useOpenPLCStore()

  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const [theme, setTheme] = useState(getThemePreference())

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light', 'nineties')
    document.documentElement.classList.add(theme)
    setSystemConfigs({ shouldUseDarkMode: theme === 'dark' })
  }, [theme, setSystemConfigs])

  const cycleTheme = () => {
    const newTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    // The desktop bridge only understands the OS-level light/dark themes; the
    // retro skin is a web/UI-only flavour, so don't push it over IPC.
    if ((newTheme === 'light' || newTheme === 'dark') && 'bridge' in window) {
      ;(window as unknown as { bridge: { winHandleUpdateTheme: (t: string) => void } }).bridge.winHandleUpdateTheme(
        newTheme,
      )
    }
  }

  const switchPerspective = () => {
    toggleCollapse()
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:display.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} onClick={() => window.location.reload()}>
            <span>{i18n.t('menu:display.submenu.refresh')}</span>
            <span className={ACCELERATOR}>{'Ctrl + R'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.clearErrors')}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.zoomIn')}</span>
            <span className={ACCELERATOR}>{'Ctrl + +'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.zoomOut')}</span>
            <span className={ACCELERATOR}>{'Ctrl + -'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={switchPerspective}>
            <span>{i18n.t('menu:display.submenu.switchPerspective')}</span>
            <span className={ACCELERATOR}>{'F12'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
            <span className={ACCELERATOR}>{'Shift + F12'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item
            className={ITEM}
            onClick={() => {
              const elem = document.documentElement as FullscreenElement
              if (elem.requestFullscreen) {
                elem.requestFullscreen()
              } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen()
              } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen()
              }
            }}
          >
            <span>{i18n.t('menu:display.submenu.fullScreen')}</span>
            <span className={ACCELERATOR}>{'F11'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.sortAlpha')}</span>
            <span className={ACCELERATOR}>{'F10'}</span>
          </MenuPrimitive.Item>
          <div onClick={cycleTheme}>
            <MenuPrimitive.Item className={ITEM}>
              <span>{i18n.t('menu:display.submenu.theme')}</span>
              <span className={ACCELERATOR}>
                {THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'light']}
              </span>
            </MenuPrimitive.Item>
          </div>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
