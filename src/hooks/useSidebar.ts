import { useContext } from 'react'

import { SidebarContext } from '@/contexts'
import { SidebarContextData } from '@/contexts/Sidebar'

const useSidebar = (): SidebarContextData => {
  const context = useContext(SidebarContext)
  if (!context)
    throw new Error('useSidebar must be used within a SidebarProvider')
  return context
}

export default useSidebar
