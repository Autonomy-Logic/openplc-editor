import {
  ConfirmDeleteModalProps,
  SaveChangeModalProps,
  SaveChangesFileModalData,
} from '@root/renderer/components/_organisms/modals'
import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import {
  ConfirmDeleteElementModal,
  QuitApplicationModal,
  SaveChangesFileModal,
  SaveChangesModal,
} from '../_organisms/modals'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    modals,
    workspaceActions: { setSystemConfigs, setRecent },
  } = useOpenPLCStore()

  useEffect(() => {
    const getUserSystemProps = async () => {
      try {
        const { OS, architecture, prefersDarkMode, isWindowMaximized } = await window.bridge.getSystemInfo()
        setSystemConfigs({
          OS,
          arch: architecture,
          shouldUseDarkMode: prefersDarkMode,
          isWindowMaximized,
        })
        if (OS === 'darwin' || OS === 'win32') {
          setIsLinux(false)
        }
      } catch (error) {
        console.error('Failed to read system info during app layout initialization:', error)
      }

      try {
        const recent = await window.bridge.retrieveRecent()
        setRecent(recent)
      } catch (error) {
        console.error('Failed to read recent projects during app layout initialization:', error)
      }
    }
    void getUserSystemProps()
  }, [setRecent, setSystemConfigs])

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
          <SaveChangesFileModal
            isOpen={modals['save-changes-file'].open}
            data={modals['save-changes-file'].data as SaveChangesFileModalData}
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
