import * as MenuPrimitive from '@radix-ui/react-menubar'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import {
  acceleratorDefaultStyle,
  contentDefaultStyle,
  itemDefaultStyle,
  triggerDefaultStyle,
} from './styles'

export const HelpMenu = () => {
  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:help.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:help.submenu.communitySupport')}</span>
            <span className={acceleratorDefaultStyle}>{'F1'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:help.submenu.about')}</span>
            <span className={acceleratorDefaultStyle}>{'F1'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
