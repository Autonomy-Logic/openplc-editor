import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

import { useCapabilities, useProject, useSystem, useTheme } from '../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../store'
import type { RungLadderState } from '../../store/slices/ladder'
import { cn } from '../../utils/cn'
import { ResolutionWarning } from '../_atoms/resolution-warning-message'
import Toaster from '../_features/[app]/toast/toaster'
import { ProjectModal } from '../_features/[start]/new-project/project-modal'
import { AIConsentModal } from '../_features/[workspace]/editor/monaco/ai-consent-modal'
import AboutModal from '../_organisms/about-modal'
import { RuntimeCreateUserModal, RuntimeDiscoverDevicesModal, RuntimeLoginModal } from '../_organisms/modals'
import { ConfirmDeleteProjectModal } from '../_organisms/modals/confirm-delete-project-modal'
import { ConfirmInstallLibrariesModal } from '../_organisms/modals/confirm-install-libraries-modal'
import { DebuggerMessageModal } from '../_organisms/modals/debugger-message-modal'
import { ConfirmDeleteElementModal } from '../_organisms/modals/delete-confirmation-modal'
import { MissingLibrariesModal } from '../_organisms/modals/missing-libraries-modal'
import { ProjectReadmeModal } from '../_organisms/modals/project-readme-modal'
import { PublicCatalogBrowserModal } from '../_organisms/modals/public-catalog-browser-modal'
import { QuitApplicationModal } from '../_organisms/modals/quit-application-modal'
import { RuntimeConnectionLostModal } from '../_organisms/modals/runtime-connection-lost-modal'
import type { SaveChangesFileModalData } from '../_organisms/modals/save-changes-file-modal'
import { SaveChangesFileModal } from '../_organisms/modals/save-changes-file-modal'
import type { SaveChangeModalProps } from '../_organisms/modals/save-changes-modal'
import { SaveChangesModal } from '../_organisms/modals/save-changes-modal'
import { ServerIpMismatchModal } from '../_organisms/modals/server-ip-mismatch-modal'
import { TitleBar } from '../_organisms/title-bar'
import { AcceleratorHandler } from './accelerator-handler'

type AppLayoutProps = ComponentPropsWithoutRef<'main'>
const AppLayout = ({ children, ...rest }: AppLayoutProps): ReactNode => {
  const system = useSystem()
  const projectPort = useProject()
  const caps = useCapabilities()
  const [showComponent, setShowComponent] = useState(true)
  const modals = useOpenPLCStore(useCallback((s) => s.modals, []))
  const OS = useOpenPLCStore(useCallback((s) => s.workspace.systemConfigs.OS, []))
  const { setSystemConfigs, setRecent } = useOpenPLCStore(useCallback((s) => s.workspaceActions, []))

  // Theme initialization - the theme port adapter owns reading the stored
  // preference (cross-app cookie → localStorage → OS) and applying the
  // <html> class; here we only seed the Monaco light/dark flag. The retro
  // 'nineties' skin is light-based, so shouldUseDarkMode stays false for it.
  const themePort = useTheme()
  useEffect(() => {
    setSystemConfigs({ shouldUseDarkMode: themePort.getCurrentTheme() === 'dark' })
  }, [themePort, setSystemConfigs])

  // System initialization
  useEffect(() => {
    const initSystem = async () => {
      try {
        const sysInfo = await system.getSystemInfo()
        setSystemConfigs({
          OS: sysInfo.OS,
          arch: sysInfo.architecture,
          isWindowMaximized: sysInfo.isWindowMaximized,
        })
      } catch (error) {
        console.error('Failed to read system info during app layout initialization:', error)
      }

      try {
        const recent = await projectPort.getRecentProjects()
        setRecent(recent)
      } catch (error) {
        console.error('Failed to read recent projects during app layout initialization:', error)
      }
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

  const showTitleBar = !caps.isNativeApplication || OS !== 'linux'

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
              onAfterAction={
                (modals['save-changes-project'].data as SaveChangeModalProps & { onAfterAction?: () => void })
                  ?.onAfterAction
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
          {modals?.['confirm-delete-project']?.open === true && (
            <ConfirmDeleteProjectModal isOpen={modals['confirm-delete-project'].open} />
          )}
          {modals?.['quit-application']?.open === true && (
            <QuitApplicationModal isOpen={modals['quit-application'].open} />
          )}
          {modals?.['server-ip-mismatch']?.open === true && (
            <ServerIpMismatchModal isOpen={modals['server-ip-mismatch'].open} />
          )}
          {modals?.['runtime-connection-lost']?.open === true && <RuntimeConnectionLostModal />}
          {modals?.['debugger-message']?.open === true && <DebuggerMessageModal />}
          {modals?.['missing-libraries']?.open === true && <MissingLibrariesModal />}
          {modals?.['public-catalog-browser']?.open === true && <PublicCatalogBrowserModal />}
          {modals?.['confirm-install-libraries']?.open === true && <ConfirmInstallLibrariesModal />}
          {modals?.['project-readme']?.open === true && <ProjectReadmeModal />}
          {modals?.['runtime-login']?.open === true && <RuntimeLoginModal />}
          {modals?.['runtime-create-user']?.open === true && <RuntimeCreateUserModal />}
          {modals?.['runtime-discover-devices']?.open === true && <RuntimeDiscoverDevicesModal />}
          {modals?.['ai-consent']?.open === true && <AIConsentModal />}
          <AboutModal />
          <AcceleratorHandler />
        </main>
      </div>
      <ResolutionWarning />
    </>
  )
}

export { AppLayout }
