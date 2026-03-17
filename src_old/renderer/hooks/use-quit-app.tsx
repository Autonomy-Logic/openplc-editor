import { useOpenPLCStore } from '@root/renderer/store'

export const useQuitApp = () => {
  const {
    workspace: { systemConfigs, close },

    workspaceActions: { setCloseApp, setCloseAppDarwin, setCloseWindow },
  } = useOpenPLCStore()

  const handleAppIsClosing = () => {
    setCloseApp(true)
  }
  const handleCancelAppIsClosing = () => {
    setCloseApp(false)
  }

  const handleAppIsClosingDarwin = () => {
    setCloseAppDarwin(true)
  }
  const handleCancelAppIsClosingDarwin = () => {
    setCloseAppDarwin(false)
  }

  const handleWindowClose = () => {
    setCloseWindow(true)
  }
  const handleCancelWindowClose = () => {
    setCloseWindow(false)
  }

  const handleQuitApp = () => {
    handleAppIsClosing()
    if (systemConfigs.OS === 'darwin') {
      window.bridge.handleQuitApp()
      return
    }
    window.bridge.handleCloseOrHideWindow()
  }
  const handleCancelQuitApp = () => {
    handleCancelWindowClose()
    handleCancelAppIsClosing()
    if (systemConfigs.OS === 'darwin' && close.appDarwin) {
      handleCancelAppIsClosingDarwin()
    }
  }

  return {
    handleQuitApp,
    handleCancelQuitApp,
    handleAppIsClosing,
    handleCancelAppIsClosing,
    handleAppIsClosingDarwin,
    handleCancelAppIsClosingDarwin,
    handleWindowClose,
    handleCancelWindowClose,
  }
}
