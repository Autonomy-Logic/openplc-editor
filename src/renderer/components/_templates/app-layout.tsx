import { ConfirmDeleteModalProps, SaveChangeModalProps } from '@root/renderer/components/_organisms/modals'
import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { ConfirmDeleteElementModal, QuitApplicationModal, SaveChangesModal } from '../_organisms/modals'
import { SaveFileChangeModalProps, SaveFileChangesModal } from '../_organisms/modals/save-file-changes-modal'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    editor,
    files,
    tabs,
    selectedTab,

    modals,
    workspaceActions: { setSystemConfigs, setRecent },
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
    console.log('Files:', files)
    console.log('Editor:', editor)
    console.log('Tabs:', tabs)
    console.log('Selected Tab:', selectedTab)
  }, [files, editor, tabs, selectedTab])

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
            validationContext={(modals['save-changes-project'].data as SaveChangeModalProps).validationContext}
            recentResponse={(modals['save-changes-project'].data as SaveChangeModalProps).recentResponse}
          />
        )}
        {modals?.['save-changes-file']?.open === true && (
          <SaveFileChangesModal
            isOpen={modals['save-changes-file'].open}
            validationContext={(modals['save-changes-file'].data as SaveFileChangeModalProps).validationContext}
            fileName={(modals['save-changes-file'].data as SaveFileChangeModalProps).fileName}
          />
        )}
        {modals?.['quit-application']?.open === true && (
          <QuitApplicationModal isOpen={modals['quit-application'].open} />
        )}
        {modals?.['confirm-delete-element']?.open === true && (
          <ConfirmDeleteElementModal
            isOpen={modals['confirm-delete-element'].open}
            data={modals['confirm-delete-element'].data as ConfirmDeleteModalProps['data']}
          />
        )}
        <AcceleratorHandler />
      </main>
    </>
  )
}

export { AppLayout }
