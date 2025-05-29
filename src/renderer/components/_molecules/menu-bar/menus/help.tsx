import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import { MenuClasses } from '../constants'

export const HelpMenu = () => {
  const {
    workspaceActions: { setModalOpen },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR } = MenuClasses

  const CommunitySupport = 'https://openplc.discussion.community/'

  const handleOpenExternalLinks = (link: string) => {
    window.bridge
      .openExternalLinkAccelerator(link)
      .then((response) => {
        if (!response.success) {
          console.error('Failed to open link:', response)
        }
      })
      .catch((error) => console.error('Error opening link:', error))
  }

  const openAboutModal = () => {
    setModalOpen('aboutOpenPlc', true)
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:help.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} onClick={() => handleOpenExternalLinks(CommunitySupport)}>
            <span>{i18n.t('menu:help.submenu.communitySupport')}</span>
            <span className={ACCELERATOR}>{'F1'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={() => void openAboutModal()}>
            <span>{i18n.t('menu:help.submenu.about')}</span>
            <span className={ACCELERATOR}>{'F1'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
