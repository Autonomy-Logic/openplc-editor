import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { SaveChangesModal } from '../_molecules/menu-bar/modals/save-changes-modal'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    modals,
    workspace: { editingState },
    modalActions: { openModal },
    workspaceActions: { setSystemConfigs, switchAppTheme, toggleMaximizedWindow, setrecent },
  } = useOpenPLCStore()

  useEffect(() => {
    const getUserSystemProps = async () => {
      const { OS, architecture, prefersDarkMode, isWindowMaximized } = await window.bridge.getSystemInfo()
      const recent = await window.bridge.retrieverecent()

      setrecent(recent)
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
    const handleOpenProjectAccelerator = () => {
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

    window.bridge.openProjectAccelerator(handleOpenProjectAccelerator)
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
      </main>
    </>
  )
}

export { AppLayout }
