import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useCompiler } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'

import { MenuClasses } from '../constants'

export const FileMenu = () => {
  // Use granular selectors to prevent re-renders from unrelated store updates (e.g., polling)
  const editingState = useOpenPLCStore((state) => state.workspace.editingState)
  const project = useOpenPLCStore((state) => state.project)
  const deviceDefinitions = useOpenPLCStore((state) => state.deviceDefinitions)
  const selectedTab = useOpenPLCStore((state) => state.selectedTab)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const closeProject = useOpenPLCStore((state) => state.sharedWorkspaceActions.closeProject)
  const openProject = useOpenPLCStore((state) => state.sharedWorkspaceActions.openProject)
  const saveProject = useOpenPLCStore((state) => state.sharedWorkspaceActions.saveProject)
  const saveFile = useOpenPLCStore((state) => state.sharedWorkspaceActions.saveFile)
  const closeFile = useOpenPLCStore((state) => state.sharedWorkspaceActions.closeFile)

  const { handleExportProject } = useCompiler()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const handleUnsavedChanges = (action: 'create-project' | 'open-project') => {
    if (editingState === 'unsaved') {
      openModal('save-changes-project', {
        validationContext: action,
      })
      return true
    }
    return false
  }

  const handleCreateProject = () => {
    if (handleUnsavedChanges('create-project')) return
    openModal('create-project', null)
  }

  const handleOpenProject = async () => {
    if (handleUnsavedChanges('open-project')) return
    await openProject()
  }

  const handleCloseProject = () => {
    closeProject()
  }

  const handleQuitApp = () => {
    window.bridge.handleCloseOrHideWindow()
  }

  return (
    <>
      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:file.label')}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleCreateProject()}>
              <span>{i18n.t('menu:file.submenu.newProject')}</span>
              <span className={ACCELERATOR}>{'Ctrl + N'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleOpenProject()}>
              <span>{i18n.t('menu:file.submenu.openProject')}</span>
              <span className={ACCELERATOR}>{'Ctrl + O'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={SEPARATOR} />
            <MenuPrimitive.Item className={ITEM} onClick={() => selectedTab && void saveFile(selectedTab)}>
              <span>{i18n.t('menu:file.submenu.save')}</span>
              <span className={ACCELERATOR}>{'Ctrl + S'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void saveProject(project, deviceDefinitions)}>
              <span>{i18n.t('menu:file.submenu.saveProject')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Shift + S'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} disabled>
              <span>{i18n.t('menu:file.submenu.saveAs')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Shift + A'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => selectedTab && void closeFile(selectedTab)}>
              <span>{i18n.t('menu:file.submenu.closeTab')}</span>
              <span className={ACCELERATOR}>{'Ctrl + W'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleCloseProject()}>
              <span>{i18n.t('menu:file.submenu.closeProject')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Shift + W'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleExportProject('old-editor')}>
              <span>{i18n.t('menu:file.submenu.exportToPLCOpenXml')}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleExportProject('codesys')}>
              <span>{i18n.t('menu:file.submenu.exportToCodesysXml')}</span>
            </MenuPrimitive.Item>
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
            <MenuPrimitive.Separator className={SEPARATOR} />
            <MenuPrimitive.Item className={ITEM} onClick={handleQuitApp}>
              <span>{i18n.t('menu:file.submenu.quit')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Q'}</span>
            </MenuPrimitive.Item>
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>
    </>
  )
}
