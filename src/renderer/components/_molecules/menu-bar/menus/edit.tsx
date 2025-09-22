import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import { MenuClasses } from '../constants'

export const EditMenu = () => {
  const {
    editor,
    workspaceActions: { setModalOpen },
    modalActions: { openModal },
    snapshotActions: { undo, redo },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses
  const findInProject = () => {
    setModalOpen('findInProject', true)
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:edit.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} onClick={() => undo(editor.meta.name)}>
            <span>{i18n.t('menu:edit.submenu.undo')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Z'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={() => redo(editor.meta.name)}>
            <span>{i18n.t('menu:edit.submenu.redo')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Y'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM}>
            <span>{i18n.t('menu:edit.submenu.cut')}</span>
            <span className={ACCELERATOR}>{'Ctrl + X'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM}>
            <span>{i18n.t('menu:edit.submenu.copy')}</span>
            <span className={ACCELERATOR}>{'Ctrl + C'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM}>
            <span>{i18n.t('menu:edit.submenu.paste')}</span>
            <span className={ACCELERATOR}>{'Ctrl + V'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.find')}</span>
            <span className={ACCELERATOR}>{'Ctrl + F'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.findNext')}</span>
            <span className={ACCELERATOR}>{'Ctrl + K'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.findPrevious')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Shift + K'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} onClick={() => void findInProject()}>
            <span>{i18n.t('menu:edit.submenu.findInProject')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Shift + F'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />

          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.addElement.label')}</span>
            <span className={ACCELERATOR}>{''}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.selectAll')}</span>
            <span className={ACCELERATOR}>{'Ctrl + A'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={() => openModal('confirm-delete-element', null)}>
            <span>{i18n.t('menu:edit.submenu.deletePou')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Backspace'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
