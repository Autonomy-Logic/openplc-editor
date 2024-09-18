import * as MenuPrimitive from '@radix-ui/react-menubar'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import { MenuClasses } from '../constants'

export const HelpMenu = () => {
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR } = MenuClasses
  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:help.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:help.submenu.communitySupport')}</span>
            <span className={ACCELERATOR}>{'F1'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:help.submenu.about')}</span>
            <span className={ACCELERATOR}>{'F1'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
