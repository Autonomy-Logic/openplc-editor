import { useOpenPLCStore } from '@root/renderer/store'

export const useQuitApp = () => {
  const {
    workspace: { systemConfigs },

    workspaceActions: { setCloseApp, setCloseWindow },
  } = useOpenPLCStore()

  const handleAppIsClosing = () => {
    setCloseApp(true)
  }
  const handleCancelAppIsClosing = () => {
    setCloseWindow(true)
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

  return {
    handleQuitApp,
    handleAppIsClosing,
    handleCancelAppIsClosing,
    handleWindowClose,
    handleCancelWindowClose,
  }
}
