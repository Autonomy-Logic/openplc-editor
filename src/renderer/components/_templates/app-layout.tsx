import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { ConfirmDeleteElementModal } from '../_molecules/menu-bar/modals/delete-confirmation-modal'
import { SaveChangesModal } from '../_molecules/menu-bar/modals/save-changes-modal'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    modals,
    workspaceActions: { setSystemConfigs, switchAppTheme, toggleMaximizedWindow, setRecent },
  } = useOpenPLCStore()
  type ModalData = {
    leafLang: string
    label: string
  }
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
          <ConfirmDeleteElementModal
            isOpen={modals['confirm-delete-element'].open}
            validationContext={modals['confirm-delete-element'].data as string}
            rung={modals['confirm-delete-element'].data as RungState}
            modalData={modals['confirm-delete-element'].data as ModalData}
          />
        )}
        <AcceleratorHandler />
      </main>
    </>
  )
}

export { AppLayout }
