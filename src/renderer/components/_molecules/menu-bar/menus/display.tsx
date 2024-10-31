import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import { MenuClasses } from '../constants'

export const DisplayMenu = () => {
  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    workspaceActions: { switchAppTheme },
  } = useOpenPLCStore()

  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  /**
   * Switches the app theme.
   * This must be tested, probably will be broken on Windows OS.
   */
  const handleChangeTheme = () => {
    window.bridge.winHandleUpdateTheme()
    switchAppTheme()
  }



  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:display.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM}>
            <span>{i18n.t('menu:display.submenu.refresh')}</span>
            <span className={ACCELERATOR}>{'Ctrl + R '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.clearErrors')}</span>
            <span className={ACCELERATOR}>{''}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.zoomIn')}</span>
            <span className={ACCELERATOR}>{'Ctrl + + '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.zoomOut')}</span>
            <span className={ACCELERATOR}>{'Ctrl + - '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} >
            <span>{i18n.t('menu:display.submenu.switchPerspective')}</span>
            <span className={ACCELERATOR}>{'F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
            <span className={ACCELERATOR}>{'Shift + F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
            <span className={ACCELERATOR}>{'Shift + F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.fullScreen')}</span>
            <span className={ACCELERATOR}>{'F11'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:display.submenu.sortAlpha')}</span>
            <span className={ACCELERATOR}>{'F10'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={() => void handleChangeTheme()}>
            <span>{i18n.t('menu:display.submenu.theme')}</span>
            <span className={ACCELERATOR}>{shouldUseDarkMode ? 'dark' : 'light'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
