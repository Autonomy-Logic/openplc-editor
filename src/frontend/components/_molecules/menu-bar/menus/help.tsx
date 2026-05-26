import * as MenuPrimitive from '@radix-ui/react-menubar'

import { useCapabilities } from '../../../../../middleware/shared/providers'
import { i18n } from '../../../../locales/i18n'
import { useOpenPLCStore } from '../../../../store'
import { MenuClasses } from '../constants'

export const HelpMenu = () => {
  const capabilities = useCapabilities()
  const {
    workspaceActions: { setModalOpen },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR } = MenuClasses

  const handleOpenCommunitySupport = () => {
    try {
      window.open('https://edge.autonomylogic.com/forum', '_blank')
    } catch (error) {
      console.error('Error opening link:', error)
    }
  }

  const handleOpenDocumentation = () => {
    try {
      window.open('https://edge.autonomylogic.com/docs', '_blank')
    } catch (error) {
      console.error('Error opening link:', error)
    }
  }

  const handleOpenAboutModal = () => {
    setModalOpen('aboutOpenPlc', true)
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:help.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} onClick={handleOpenCommunitySupport}>
            <span>{i18n.t('menu:help.submenu.communitySupport')}</span>
            <span className={ACCELERATOR}>{'F1'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={handleOpenDocumentation}>
            <span>{i18n.t('menu:help.submenu.documentation')}</span>
          </MenuPrimitive.Item>
          {capabilities.hasAboutDialog && (
            <MenuPrimitive.Item className={ITEM} onClick={handleOpenAboutModal}>
              <span>{i18n.t('menu:help.submenu.about')}</span>
            </MenuPrimitive.Item>
          )}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
