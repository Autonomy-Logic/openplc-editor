import * as MenuPrimitive from '@radix-ui/react-menubar'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useHandleRemoveTab } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { FlowType } from '@root/renderer/store/slices/flow/types'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'
import { i18n } from '@utils/i18n'
import _ from 'lodash'
import { useEffect } from 'react'

import { MenuClasses } from '../constants'

export const FileMenu = () => {
  const {
    project,
    editorActions: { clearEditor },
    workspaceActions: { setEditingState, setRecents },
    projectActions: { setProject },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
    editor,
    modalActions: { openModal },
  } = useOpenPLCStore()
  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()
  const { TRIGGER, CONTENT, ITEM, ACCELERATOR, SEPARATOR } = MenuClasses

  const handleCreateProject = () => {
    try {
      openModal('create-project', null)
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to open project creation modal',
        variant: 'fail',
      })
    }
  }

  const handleOpenProject = async () => {
    const { success, data, error } = await window.bridge.openProject()
    if (success && data) {
      clearEditor()
      clearTabs()
      setEditingState('unsaved')
      setRecents([])
      setProject({
        meta: {
          name: data.content.meta.name,
          type: data.content.meta.type,
          path: data.meta.path,
        },
        data: data.content.data,
      })

      const ladderPous = data.content.data.pous.filter((pou) => pou.data.language === 'ld')
      if (ladderPous.length > 0) {
        ladderPous.forEach((pou) => {
          if (pou.data.body.language === 'ld') addFlow(pou.data.body.value as FlowType)
        })
      }

      toast({
        title: 'Project opened!',
        description: 'Your project was opened, and loaded.',
        variant: 'default',
      })
    } else {
      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
    }
  }

  const handleSaveProject = async () => {
    const projectData = PLCProjectSchema.safeParse(project)
    if (!projectData.success) {
      toast({
        title: 'Error in the save request!',
        description: 'The project data is not valid.',
        variant: 'fail',
      })
      return
    }

    const { success, reason } = await window.bridge.saveProject({
      projectPath: project.meta.path,
      //@ts-expect-error overlap
      projectData: project.data,
    })

    if (success) {
      _.debounce(() => setEditingState('saved'), 1000)()
      toast({
        title: 'Changes saved!',
        description: 'The project was saved successfully!',
        variant: 'default',
      })
    } else {
      _.debounce(() => setEditingState('unsaved'), 1000)()
      toast({
        title: 'Error in the save request!',
        description: reason?.description,
        variant: 'fail',
      })
    }
  }

  useEffect(() => {
    setSelectedTab(editor.meta.name)
  }, [editor])

  const handleCloseProject = () => {
    clearEditor()
    clearTabs()
    setEditingState('unsaved')
    setRecents([])
  }

  return (
    <>
      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={TRIGGER}>{i18n.t('menu:file.label')}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleCreateProject()}>
              <span>{i18n.t('menu:file.submenu.new')}</span>
              <span className={ACCELERATOR}>{'Ctrl + N'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleOpenProject()}>
              <span>{i18n.t('menu:file.submenu.open')}</span>
              <span className={ACCELERATOR}>{'Ctrl + O'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={SEPARATOR} />
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleSaveProject()}>
              <span>{i18n.t('menu:file.submenu.save')}</span>
              <span className={ACCELERATOR}>{'Ctrl + S'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} disabled>
              <span>{i18n.t('menu:file.submenu.saveAs')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Shift + S'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleRemoveTab(selectedTab)}>
              <span>{i18n.t('menu:file.submenu.closeTab')}</span>
              <span className={ACCELERATOR}>{'Ctrl + W'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={ITEM} onClick={() => void handleCloseProject()}>
              <span>{i18n.t('menu:file.submenu.closeProject')}</span>
              <span className={ACCELERATOR}>{'Ctrl  + W'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={SEPARATOR} />
            <MenuPrimitive.Item className={ITEM} disabled>
              <span>{i18n.t('menu:file.submenu.pageSetup')}</span>
              <span className={ACCELERATOR}>"Ctrl + Alt + P"</span>
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
            <MenuPrimitive.Item className={ITEM}>
              <span>{i18n.t('menu:file.submenu.quit')}</span>
              <span className={ACCELERATOR}>{'Ctrl + Q'}</span>
            </MenuPrimitive.Item>
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>
    </>
  )
}
