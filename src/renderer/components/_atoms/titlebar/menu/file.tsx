import * as MenuPrimitive from '@radix-ui/react-menubar'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

import {
  acceleratorDefaultStyle,
  contentDefaultStyle,
  itemDefaultStyle,
  separatorDefaultStyle,
  triggerDefaultStyle,
} from './styles'

export const FileMenu = () => {
  const {
    workspace: {
      projectData,
      projectPath,
    },
    editorActions: { clearEditor },
    workspaceActions: { setUserWorkspace, setEditingState },
    tabsActions: { clearTabs },
  } = useOpenPLCStore()

  const handleCreateProject = async () => {
    const { success, data, error } = await window.bridge.createProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
      clearEditor()
      clearTabs()
      toast({
        title: 'The project was created successfully!',
        description: 'To begin using the OpenPLC Editor, add a new POU to your project.',
        variant: 'default',
      })
    } else {
      toast({
        title: 'Cannot create a project!',
        description: error?.description,
        variant: 'fail',
      })
    }
  }

  const handleOpenProject = async () => {
    const { success, data, error } = await window.bridge.openProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
      clearEditor()
      clearTabs()
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
    const { success, reason } = await window.bridge.saveProject({ projectPath, projectData })
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
        description: reason.description,
        variant: 'fail',
      })
    }
  }

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:file.label')}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
          <MenuPrimitive.Item className={itemDefaultStyle} onClick={() => void handleCreateProject()}>
            <span>{i18n.t('menu:file.submenu.new')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + N'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} onClick={() => void handleOpenProject()}>
            <span>{i18n.t('menu:file.submenu.open')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + O'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle} onClick={() => void handleSaveProject()}>
            <span>{i18n.t('menu:file.submenu.save')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + S'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.saveAs')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + Shift + S'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.closeTab')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + W'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.closeProject')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl  + W'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.pageSetup')}</span>
            <span className={acceleratorDefaultStyle}>"Ctrl + Alt + P"</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.preview')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + Shift + P'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.print')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + P'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle} disabled>
            <span>{i18n.t('menu:file.submenu.updates')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + U'}</span>
          </MenuPrimitive.Item>
          <MenuPrimitive.Separator className={separatorDefaultStyle} />
          <MenuPrimitive.Item className={itemDefaultStyle}>
            <span>{i18n.t('menu:file.submenu.quit')}</span>
            <span className={acceleratorDefaultStyle}>{'Ctrl + Q'}</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
