import { useContext } from 'react'

import { SidebarContext } from '@/contexts'
import { SidebarContextData } from '@/contexts/Sidebar'
/**
 * Custom hook to interact with the sidebar context
 * @function
 * @returns {SidebarContextData} - Sidebar context data
 */
const useSidebar = (): SidebarContextData => {
  /**
   * Get the sidebar context from the SidebarProvider
   */
  const context = useContext(SidebarContext)
  /**
   * Throw an error if the hook is not used within a SidebarProvider
   */
  if (!context)
    throw new Error('useSidebar must be used within a SidebarProvider')
  return context
}

export default useSidebar
