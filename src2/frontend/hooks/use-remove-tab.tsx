import { useOpenPLCStore } from '../store'
import { useState } from 'react'

const useHandleRemoveTab = () => {
  const {
    sharedWorkspaceActions: { forceCloseFile },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState('')

  const handleRemoveTab = (tabToRemove: string) => {
    const result = forceCloseFile(tabToRemove)
    if (result.success) {
      // Tab was closed successfully, update selected tab from current state
      setSelectedTab('')
    }
    // If not successful, closeFile opened a save modal - do nothing
  }

  return { handleRemoveTab, selectedTab, setSelectedTab }
}

export { useHandleRemoveTab }
