import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useHandleRemoveTab } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Modal, ModalContent } from '../../modal'
import { MenuClasses } from '../constants'

export const EditMenu = () => {
  const {
    editor,
    projectActions: { deletePou },
    workspaceActions: { setModalOpen },
  } = useOpenPLCStore()
  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses
  const [modalDeleteOpen, setModalDeleteOpen] = useState(false)

  useEffect(() => {
    setSelectedTab(editor.meta.name)
  }, [editor])

  const handleDeletePou = () => {
    handleRemoveTab(selectedTab)
    deletePou(selectedTab)
  }

  const handleCloseModal = () => {
    setModalDeleteOpen(false)
  }
  const findInProject = () => {
    setModalOpen('findInProject', true)
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:edit.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.undo')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Z'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.redo')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Y'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.cut')}</span>
            <span className={ACCELERATOR}>{'Ctrl + X'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:edit.submenu.copy')}</span>
            <span className={ACCELERATOR}>{'Ctrl + C'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
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
          <MenuPrimitive.Item className={ITEM} onClick={() => setModalDeleteOpen(true)}>
            <span>{i18n.t('menu:edit.submenu.deletePou')}</span>
            <span className={ACCELERATOR}>{''}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
      {modalDeleteOpen && (
        <Modal open={modalDeleteOpen} onOpenChange={setModalDeleteOpen}>
          <ModalContent
            onClose={handleCloseModal}
            className='flex max-h-80 w-[300px] select-none flex-col items-center justify-evenly rounded-lg'
          >
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Are you sure you want delete this POU?
            </p>

            <div className='flex w-[200px] flex-col space-y-2 text-sm'>
              <button
                onClick={() => {
                  handleDeletePou()
                }}
                className='w-full rounded-lg bg-blue-500 px-4 py-2 text-center font-medium text-white'
              >
                Delete
              </button>
              <button
                onClick={handleCloseModal}
                className='w-full rounded-md bg-neutral-100 px-4 px-4 py-2 dark:bg-neutral-850 dark:text-neutral-100 '
              >
                Cancel
              </button>
            </div>
          </ModalContent>
        </Modal>
      )}
    </MenuPrimitive.Menu>
  )
}
