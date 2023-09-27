import { useContext } from 'react'

import { TabsContext } from '@/contexts'
import { TabsContextData } from '@/contexts/Tabs'
/**
 * Custom hook to interact with the tabs context
 * @function
 * @returns {TabsContextData} - Tabs context data
 */
const useTabs = (): TabsContextData => {
  /**
   * Get the tabs context from the TabsProvider
   */
  const context = useContext(TabsContext)
  /**
   * Throw an error if the hook is not used within a TabsProvider
   */
  if (!context) throw new Error('useTabs must be used within a TabsProvider')
  return context
}

export default useTabs
