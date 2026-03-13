import { useOpenPLCStore } from '../../store'
import { useSystem, useProject, useCapabilities } from '../../../middleware/shared/providers'
import { cn } from '../../utils'
import { ComponentPropsWithoutRef, ReactNode, useEffect, useState } from 'react'

import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { ConfirmDeleteElementModal } from '../_organisms/modals/delete-confirmation-modal'
import { DebuggerMessageModal } from '../_organisms/modals/debugger-message-modal'
import { QuitApplicationModal } from '../_organisms/modals/quit-application-modal'
import { RuntimeConnectionLostModal } from '../_organisms/modals/runtime-connection-lost-modal'
import { SaveChangesFileModal } from '../_organisms/modals/save-changes-file-modal'
import { SaveChangesModal } from '../_organisms/modals/save-changes-modal'
import { ServerIpMismatchModal } from '../_organisms/modals/server-ip-mismatch-modal'
import type { SaveChangeModalProps } from '../_organisms/modals/save-changes-modal'
import type { SaveChangesFileModalData } from '../_organisms/modals/save-changes-file-modal'
import type { RungLadderState } from '../../store/slices'
import { TitleBar } from '../_organisms/title-bar'
import { ResolutionWarning } from '../_atoms/resolution-warning-message'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const capabilities = useCapabilities()
  const system = useSystem()
  const projectPort = useProject()
  const [showComponent, setShowComponent] = useState(true)
  const {
    modals,
    workspace: {
      systemConfigs: { OS },
    },
    workspaceActions: { setSystemConfigs, setRecent },
  } = useOpenPLCStore()

  // System initialization
  useEffect(() => {
    const initSystem = async () => {
      const sysInfo = await system.getSystemInfo()
      setSystemConfigs({
        OS: sysInfo.OS,
        arch: sysInfo.architecture,
        shouldUseDarkMode: sysInfo.prefersDarkMode,
        isWindowMaximized: sysInfo.isWindowMaximized,
      })
      const recent = await projectPort.getRecentProjects()
      setRecent(recent)
    }
    void initSystem()
  }, [system, projectPort, setSystemConfigs, setRecent])

  // Resolution check (web: hides UI below minimum size; harmless on editor)
  useEffect(() => {
    const handleResize = () => {
      const { innerWidth: width, innerHeight: height } = window
      setShowComponent(width >= 1024 && height >= 300)
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const showTitleBar = OS !== 'linux'

  return (
    <>
      <div
        className={`h-full bg-neutral-50 text-gray-500 dark:bg-neutral-950 dark:text-gray-400 ${showComponent ? 'block' : 'hidden'}`}
      >
        {showTitleBar && <TitleBar />}
        <main
          className={cn(
            'absolute bottom-0 left-0 right-0 flex overflow-hidden',
            showTitleBar ? 'top-[--oplc-title-bar-height]' : 'top-0',
          )}
          {...rest}
        >
          {children}
          <Toaster />
          {modals?.['create-project']?.open === true && <ProjectModal isOpen={modals['create-project'].open} />}
          {modals?.['save-changes-project']?.open === true && (
            <SaveChangesModal
              isOpen={modals['save-changes-project'].open}
              validationContext={
                (modals['save-changes-project'].data as SaveChangeModalProps)?.validationContext ?? 'close-project'
              }
            />
          )}
          {modals?.['save-changes-file']?.open === true && (
            <SaveChangesFileModal
              isOpen={modals['save-changes-file'].open}
              data={modals['save-changes-file'].data as SaveChangesFileModalData}
            />
          )}
          {modals?.['confirm-delete-element']?.open === true && (
            <ConfirmDeleteElementModal
              isOpen={modals['confirm-delete-element'].open}
              rung={modals['confirm-delete-element'].data as RungLadderState}
            />
          )}
          {modals?.['quit-application']?.open === true && (
            <QuitApplicationModal isOpen={modals['quit-application'].open} />
          )}
          {modals?.['server-ip-mismatch']?.open === true && (
            <ServerIpMismatchModal isOpen={modals['server-ip-mismatch'].open} />
          )}
          {modals?.['runtime-connection-lost']?.open === true && <RuntimeConnectionLostModal />}
          {modals?.['debugger-message']?.open === true && <DebuggerMessageModal />}
          {capabilities.hasNativeMenu && <AcceleratorHandler />}
        </main>
      </div>
      <ResolutionWarning />
    </>
  )
}

export { AppLayout }
