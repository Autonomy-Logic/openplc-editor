import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useEffect } from 'react'

import { useCapabilities, useProject } from '../../../../../middleware/shared/providers'
import { useHandleRemoveTab } from '../../../../hooks/use-remove-tab'
import { i18n } from '../../../../locales/i18n'
import { executeSaveActiveFile, executeSaveProject } from '../../../../services/save-actions'
import { useOpenPLCStore } from '../../../../store'
import { MenuClasses } from '../constants'

export const FileMenu = () => {
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const {
    editor: activeEditor,
    workspace: { editingState },
    readme: { savedContent: readmeSavedContent },
    sharedWorkspaceActions: { closeProject },
    modalActions: { openModal },
  } = useOpenPLCStore()
  // The README item is only available when the active adapter exposes
  // the README slot (currently: web adapter against the Edge API). The
  // slice's `savedContent === undefined` means "not hydrated" — either
  // dev:local mode or desktop editor, where the menu item would 404.
  const isReadmeAvailable = readmeSavedContent !== undefined

  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()

  useEffect(() => {
    setSelectedTab(activeEditor.meta.name)
  }, [activeEditor])

  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const isSaving = editingState === 'save-request'

  const handleSave = () => {
    if (activeEditor.meta.name && !isSaving) {
      void executeSaveActiveFile(projectPort, capabilities)
    }
  }

  const handleSaveProject = () => {
    if (!isSaving) {
      void executeSaveProject(projectPort, capabilities)
    }
  }

  const handleCloseTab = () => {
    handleRemoveTab(selectedTab)
  }

  const handleCloseProject = () => {
    closeProject()
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:file.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item className={ITEM} onClick={handleSave} disabled={isSaving}>
            <span>{i18n.t('menu:file.submenu.save')}</span>
            <span className={ACCELERATOR}>{'Ctrl + S'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={handleSaveProject} disabled={isSaving}>
            <span>{i18n.t('menu:file.submenu.saveProject')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Shift + S'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={handleCloseTab}>
            <span>{i18n.t('menu:file.submenu.closeTab')}</span>
            <span className={ACCELERATOR}>{'Ctrl + W'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} onClick={handleCloseProject}>
            <span>{i18n.t('menu:file.submenu.closeProject')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Shift + W'}</span>
          </MenuPrimitive.Item>
          {isReadmeAvailable && (
            <>
              <MenuPrimitive.Separator className={SEPARATOR} />
              <MenuPrimitive.Item className={ITEM} onClick={() => openModal('project-readme')}>
                <span>README</span>
              </MenuPrimitive.Item>
            </>
          )}
          {capabilities.hasProjectExport && (
            <>
              <MenuPrimitive.Separator className={SEPARATOR} />
              <MenuPrimitive.Item className={ITEM} disabled>
                <span>{i18n.t('menu:file.submenu.exportToPLCOpenXml')}</span>
              </MenuPrimitive.Item>
            </>
          )}
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:file.submenu.pageSetup')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Alt + P'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:file.submenu.preview')}</span>
            <span className={ACCELERATOR}>{'Ctrl + Shift + P'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:file.submenu.print')}</span>
            <span className={ACCELERATOR}>{'Ctrl + P'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={SEPARATOR} />
          <MenuPrimitive.Item className={ITEM} disabled>
            <span>{i18n.t('menu:file.submenu.updates')}</span>
            <span className={ACCELERATOR}>{'Ctrl + U'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
