import * as MenuPrimitive from '@radix-ui/react-menubar'
import { useCallback, useEffect } from 'react'

import { useCapabilities, useProject } from '../../../../../middleware/shared/providers'
import { useHandleRemoveTab } from '../../../../hooks/use-remove-tab'
import { i18n } from '../../../../locales/i18n'
import { useOpenPLCStore } from '../../../../store'
import { prepareSavePayload } from '../../../../utils/save-project'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { MenuClasses } from '../constants'

export const FileMenu = () => {
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const {
    project,
    editor: activeEditor,
    editors,
    deviceDefinitions,
    workspace: { editingState },
    workspaceActions: { setEditingState },
    sharedWorkspaceActions: { closeProject },
    fileActions: { setAllToSaved },
  } = useOpenPLCStore()

  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()

  useEffect(() => {
    setSelectedTab(activeEditor.meta.name)
  }, [activeEditor])

  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const isSaving = editingState === 'save-request'

  const executeSave = useCallback(async () => {
    setEditingState('save-request')
    toast({
      title: 'Save changes',
      description: 'Trying to save the changes in the project file.',
      variant: 'warn',
    })

    try {
      const params = prepareSavePayload({
        projectPath: project.meta.path,
        projectName: project.meta.name,
        projectData: project.data,
        deviceConfiguration: deviceDefinitions.configuration,
        devicePinMapping: deviceDefinitions.pinMapping.pins,
        editors,
        activeEditor,
      })

      const res = await projectPort.saveProject(params)
      if (res.success) {
        setEditingState('saved')
        setAllToSaved()
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      } else {
        setEditingState('unsaved')
        toast({
          title: 'Error in the save request!',
          description: res.error ?? 'Save failed',
          variant: 'fail',
        })
      }
    } catch {
      setEditingState('unsaved')
      toast({
        title: 'Error in the save request!',
        description: 'An unexpected error occurred while saving.',
        variant: 'fail',
      })
    }
  }, [project, deviceDefinitions, editors, activeEditor, projectPort, setEditingState, setAllToSaved])

  const handleSave = () => {
    if (activeEditor.meta.name && !isSaving) {
      void executeSave()
    }
  }

  const handleSaveProject = () => {
    if (!isSaving) {
      void executeSave()
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
