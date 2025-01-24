import { useOpenPLCStore } from '@root/renderer/store'

export const useQuitApp = () => {
  const {
    workspace: { systemConfigs },

    workspaceActions: { setCloseApp },
  } = useOpenPLCStore()

  const handleQuitApp = () => {
    setCloseApp()
    if (systemConfigs.OS === 'darwin') {
      window.bridge.handleQuitApp()
      return
    }
    window.bridge.handleCloseOrHideWindow()
  }

  return {
    handleQuitApp,
  }
}
