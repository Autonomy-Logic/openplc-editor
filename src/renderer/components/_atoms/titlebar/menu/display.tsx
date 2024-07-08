import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import {
  acceleratorDefaultStyle,
  contentDefaultStyle,
  itemDefaultStyle,
  separatorDefaultStyle,
  triggerDefaultStyle,
} from './styles'

export const DisplayMenu = () => {
  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    workspaceActions: { switchAppTheme },
  } = useOpenPLCStore()

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
      <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:display.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
          <MenuPrimitive.Item className={itemDefaultStyle}>
            <span>{i18n.t('menu:display.submenu.refresh')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + R '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.clearErrors')}</span>
            <span className={acceleratorDefaultStyle}>{''}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.zoomIn')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + + '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.zoomOut')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + - '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.switchPerspective')}</span>
            <span className={acceleratorDefaultStyle}>{'F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
            <span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
            <span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.fullScreen')}</span>
            <span className={acceleratorDefaultStyle}>{'F11'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:display.submenu.sortAlpha')}</span>
            <span className={acceleratorDefaultStyle}>{'F10'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} onClick={() => void handleChangeTheme()}>
            <span>{i18n.t('menu:display.submenu.theme')}</span>
            <span className={acceleratorDefaultStyle}>{shouldUseDarkMode ? 'dark' : 'light'}</span>
          </MenuPrimitive.Item>
          {/*
            <MenuPrimitive.Portal>
              <MenuPrimitive.SubContent sideOffset={18} className={contentDefaultStyle}>
                <MenuPrimitive.Item
                  onClick={() => {
                    void handleChangeTheme()
                  }}
                  className={itemDefaultStyle}
                >
                  <span>{i18n.t('menu:display.submenu.theme.submenu.light')}</span>

                  {!shouldUseDarkMode ? <div className={checkboxDefaultStyle}>✓</div> : ''}
                </MenuPrimitive.Item>
                <MenuPrimitive.Item
                  onClick={() => {
                    void handleChangeTheme()
                  }}
                  className={itemDefaultStyle}
                >
                  <span>{i18n.t('menu:display.submenu.theme.submenu.dark')}</span>
                  {shouldUseDarkMode ? <div className={checkboxDefaultStyle}>✓</div> : ''}
                </MenuPrimitive.Item>
              </MenuPrimitive.SubContent>
            </MenuPrimitive.Portal> */}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
