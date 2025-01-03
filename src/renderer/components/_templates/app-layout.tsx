import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { FlowType } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { toast } from '../_features/[app]/toast/use-toast'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { ConfirmDeleteElementModal } from '../_molecules/menu-bar/modals/delete-confirmation-modal'
import { SaveChangesModal } from '../_molecules/menu-bar/modals/save-changes-modal'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    modals,
    workspace: { editingState },
    modalActions: { openModal },
    workspaceActions: { setSystemConfigs, switchAppTheme, toggleMaximizedWindow, setRecent, setEditingState },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
    libraryActions: { addLibrary },
    projectActions: { setProject },
  } = useOpenPLCStore()

  useEffect(() => {
    const getUserSystemProps = async () => {
      const { OS, architecture, prefersDarkMode, isWindowMaximized } = await window.bridge.getSystemInfo()
      const recent = await window.bridge.retrieveRecent()

      setRecent(recent)
      setSystemConfigs({
        OS,
        arch: architecture,
        shouldUseDarkMode: prefersDarkMode,
        isWindowMaximized,
      })
      if (OS === 'darwin' || OS === 'win32') {
        setIsLinux(false)
      }
    }
    void getUserSystemProps()
  }, [setSystemConfigs])

  useEffect(() => {
    window.bridge.isMaximizedWindow((_event) => {
      toggleMaximizedWindow()
    })
  }, [])

  useEffect(() => {
    window.bridge.handleUpdateTheme((_event) => {
      switchAppTheme()
    })
  }, [])
  useEffect(() => {
    const handleOpenProjectAccelerator = async () => {
      if (editingState === 'initial-state') {
        try {
          const res = await window.bridge.openProject()
          if (res.success && res.data) {
            clearTabs()
            setEditingState('unsaved')
            const projectMeta = {
              name: res.data.content.meta.name,
              type: res.data.content.meta.type,
              path: res.data.meta.path,
            }
            const projectData = res.data.content.data
            setProject({
              meta: projectMeta,
              data: projectData,
            })
            const ladderPous = projectData.pous.filter(
              (pou: { data: { language: string } }) => pou.data.language === 'ld',
            )
            if (ladderPous.length) {
              ladderPous.forEach((pou) => {
                if (pou.data.body.language === 'ld') {
                  addFlow(pou.data.body.value as FlowType)
                }
              })
            }
            res.data.content.data.pous.forEach((pou) => {
              if (pou.type !== 'program') {
                addLibrary(pou.data.name, pou.type)
              }
            })
            toast({
              title: 'Project opened!',
              description: 'Your project was opened and loaded successfully.',
              variant: 'default',
            })
          } else {
            toast({
              title: 'Cannot open the project.',
              description: res.error?.description || 'Failed to open the project.',
              variant: 'fail',
            })
          }
        } catch (_error) {
          toast({
            title: 'An error occurred.',
            description: 'There was a problem opening the project.',
            variant: 'fail',
          })
        }
        return
      }
      if (editingState === 'unsaved') {
        openModal('save-changes-project', 'open-project')
      }
    }

    const handleCreateProjectAccelerator = () => {
      if (editingState !== 'unsaved') {
        openModal('create-project', null)
      } else {
        openModal('save-changes-project', 'create-project')
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    window.bridge.handleOpenProjectRequest(handleOpenProjectAccelerator)
    window.bridge.createProjectAccelerator(handleCreateProjectAccelerator)

    return () => {
      window.bridge.removeOpenProjectAccelerator()
      window.bridge.removeCreateProjectAccelerator()
    }
  }, [editingState])

  return (
    <>
      {!isLinux && <TitleBar />}
      <main
        className={cn(
          'absolute bottom-0 left-0 right-0 flex overflow-hidden',
          `${isLinux ? 'top-0' : 'top-[--oplc-title-bar-height]'}`,
        )}
        {...rest}
      >
        {children}
        <Toaster />
        {modals?.['create-project']?.open === true && <ProjectModal isOpen={modals['create-project'].open} />}
        {modals?.['save-changes-project']?.open === true && (
          <SaveChangesModal
            isOpen={modals['save-changes-project'].open}
            validationContext={modals['save-changes-project'].data as string}
          />
        )}
        {modals?.['confirm-delete-element']?.open === true && (
          <ConfirmDeleteElementModal isOpen={modals['confirm-delete-element'].open} />
        )}
        <AcceleratorHandler />
      </main>
    </>
  )
}

export { AppLayout }
