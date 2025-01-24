import { useOpenPLCStore } from '@root/renderer/store'

export const useQuitApp = () => {
  const {
    workspace: { systemConfigs },

    workspaceActions: { setCloseApp, setCloseWindow },
  } = useOpenPLCStore()

  const handleQuitApp = () => {
    setCloseApp(true)
    if (systemConfigs.OS === 'darwin') {
      window.bridge.handleQuitApp()
      return
    }
    window.bridge.handleCloseOrHideWindow()
  }

  const handleWindowClose = () => {
    setCloseWindow(true)
  }

  const handleCancelWindowClose = () => {
    setCloseWindow(false)
  }

  return {
    handleQuitApp,
    handleWindowClose,
    handleCancelWindowClose,
  }
}
