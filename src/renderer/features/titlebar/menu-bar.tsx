import * as MenuPrimitive from '@radix-ui/react-menubar'
import RecentProjectIcon from '@root/renderer/assets/icons/interface/Recent'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@utils/cn'
import { i18n } from '@utils/i18n'
import _ from 'lodash'

export const MenuBar = () => {
  const {
    projectData,
    projectPath,
    workspaceActions: { switchAppTheme, setUserWorkspace, setEditingState },
    systemConfigs: { shouldUseDarkMode },
  } = useOpenPLCStore()

  /**
   * Switches the app theme.
   * This must be tested, probably will be broken on Windows OS.
   */
  const handleChangeTheme = () => {
    window.bridge.winHandleUpdateTheme()
    switchAppTheme()
  }

  const handleCreateProject = async () => {
    const { success, data, error } = await window.bridge.createProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
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

  const recentProjects = [
    'project-1',
    'project-2',
    'project-3',
    'project-4',
    'project-5',
    'project-6',
    'project-7',
    'project-8',
    'project-9',
    'project-10',
  ]

  const triggerDefaultStyle =
    'w-fit dark:aria-[expanded="true"]:bg-neutral-900 h-fit px-2 py-px aria-[expanded="true"]:bg-brand-medium text-white font-caption font-light text-xs rounded-sm bg-brand-dark dark:bg-neutral-950  hover:bg-brand-medium-dark hover:shadow-2xl hover:dark:bg-neutral-900 transition-colors'
  const contentDefaultStyle =
    'w-80 flex flex-col relative z-50 drop-shadow-lg  px-4 py-4 gap-2 bg-white dark:bg-neutral-900 dark:border-brand-dark rounded-md shadow-inner backdrop-blur-2xl border border-brand-light'
  const itemDefaultStyle =
    'px-2 py-1 text-neutral-850 dark:aria-[expanded="true"]:bg-neutral-700 aria-[expanded="true"]:bg-neutral-100 outline-none font-normal font-caption text-xs dark:text-white flex items-center justify-between hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent'
  const acceleratorDefaultStyle = 'opacity-50 capitalize '
  const separatorDefaultStyle = 'border-b border-b-neutral-400'

  //each root is a menu
  return (
    <MenuPrimitive.Root className='ml-6 flex h-full flex-1 items-center gap-2'>
      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:file.label')}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
            <MenuPrimitive.Item className={itemDefaultStyle} onClick={void handleCreateProject}>
              <span>{i18n.t('menu:file.submenu.new')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + N'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} onClick={void handleOpenProject}>
              <span>{i18n.t('menu:file.submenu.open')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + O'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} onClick={void handleSaveProject}>
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

      {/*edit menu */}

      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:edit.label')}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.undo')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + Z'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.redo')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + Y'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.cut')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + X'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.copy')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + C'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.paste')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + V'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.find')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + F'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.findNext')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + K'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.findPrevious')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + Shift + K'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.findInProject')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + Shift + F'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />

            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.addElement.label')}</span>
              <span className={acceleratorDefaultStyle}>{''}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.selectAll')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + A'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:edit.submenu.delete')}</span>
              <span className={acceleratorDefaultStyle}>{''}</span>
            </MenuPrimitive.Item>
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>

      {/*display menu */}

      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={triggerDefaultStyle}>{i18n.t('menu:display.label')}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
            <MenuPrimitive.Item className={itemDefaultStyle}>
              <span>{i18n.t('menu:display.submenu.refresh')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + R '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.clearErrors')}</span>
              <span className={acceleratorDefaultStyle}>{''}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.zoomIn')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + + '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.zoomOut')}</span>
              <span className={acceleratorDefaultStyle}>{'Ctrl + - '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.switchPerspective')}</span>
              <span className={acceleratorDefaultStyle}>{'F12 '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
              <span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className={separatorDefaultStyle} />
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
              <span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.fullScreen')}</span>
              <span className={acceleratorDefaultStyle}>{'F11'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} disabled>
              <span>{i18n.t('menu:display.submenu.sortAlpha')}</span>
              <span className={acceleratorDefaultStyle}>{'F10'}</span>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={itemDefaultStyle} onClick={() => void handleChangeTheme()}>
              <span>{i18n.t('menu:display.submenu.theme')}</span>
              <span className={acceleratorDefaultStyle}>{shouldUseDarkMode ? 'dark' : 'light'}</span>
            </MenuPrimitive.Item>
            {/* 
            <MenuPrimitive.Portal>
              <MenuPrimitive.SubContent sideOffset={18} className={contentDefaultStyle}>
                <MenuPrimitive.Item
                  onClick={() => {
                    void handleChangeTheme()
                  }}
                  className={itemDefaultStyle}
                >
                  <span>{i18n.t('menu:display.submenu.theme.submenu.light')}</span>

                  {!shouldUseDarkMode ? <div className={checkboxDefaultStyle}>✓</div> : ''}
                </MenuPrimitive.Item>
                <MenuPrimitive.Item
                  onClick={() => {
                    void handleChangeTheme()
                  }}
                  className={itemDefaultStyle}
                >
                  <span>{i18n.t('menu:display.submenu.theme.submenu.dark')}</span>
                  {shouldUseDarkMode ? <div className={checkboxDefaultStyle}>✓</div> : ''}
                </MenuPrimitive.Item>
              </MenuPrimitive.SubContent>
            </MenuPrimitive.Portal> */}
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>

      {/*** help */}

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
      <MenuPrimitive.Separator className={cn(separatorDefaultStyle, 'h-[1px] w-3 rotate-90 bg-brand-light')} />
      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger className={triggerDefaultStyle}>recent</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
            {recentProjects.map((project) => (
              <MenuPrimitive.Item
                key={project}
                className={cn(
                  itemDefaultStyle,
                  'flex items-center justify-normal gap-2 !overflow-hidden text-xs font-medium text-neutral-900 dark:text-neutral-50',
                )}
              >
                <RecentProjectIcon />
                <span className='flex-1 overflow-hidden capitalize'>{project}</span>
                <span className='text-cp-sm font-normal text-neutral-400'>edited 0 minute ago</span>
              </MenuPrimitive.Item>
            ))}
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>
    </MenuPrimitive.Root>
  )
}
