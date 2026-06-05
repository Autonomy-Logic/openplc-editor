import { useState } from 'react'

import { useOpenPLCStore } from '../store'

const useHandleRemoveTab = () => {
  const {
    sharedWorkspaceActions: { closeFile },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState('')

  const handleRemoveTab = (tabToRemove: string) => {
    const result = closeFile(tabToRemove)
    if (result.success) {
      // Tab was closed successfully, update selected tab from current state
      setSelectedTab('')
    }
    // If not successful, closeFile opened a save modal - do nothing
  }

  return { handleRemoveTab, selectedTab, setSelectedTab }
}

export { useHandleRemoveTab }
