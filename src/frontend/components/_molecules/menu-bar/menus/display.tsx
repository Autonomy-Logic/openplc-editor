import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useEffect, useState } from 'react'

import { i18n } from '../../../../locales/i18n'
import { useOpenPLCStore } from '../../../../store'
import { MenuClasses } from '../constants'

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>
  msRequestFullscreen?: () => Promise<void>
}

function getThemePreference(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const DisplayMenu = () => {
  const {
    workspaceActions: { setSystemConfigs, toggleCollapse },
  } = useOpenPLCStore()

  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const [theme, setTheme] = useState(getThemePreference())

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(theme)
    setSystemConfigs({ shouldUseDarkMode: theme === 'dark' })
  }, [theme, setSystemConfigs])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    window.bridge.winHandleUpdateTheme(newTheme)
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
          <div onClick={toggleTheme}>
            <MenuPrimitive.Item className={ITEM}>
              <span>{i18n.t('menu:display.submenu.theme')}</span>
              <span className={ACCELERATOR}>{theme === 'light' ? 'dark' : 'light'}</span>
            </MenuPrimitive.Item>
          </div>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
