import { useContext } from 'react'

import { TabsContext } from '@/contexts'
import { TabsContextData } from '@/contexts/Tabs'

const useTabs = (): TabsContextData => {
  const context = useContext(TabsContext)
  if (!context) throw new Error('useTabs must be used within a TabsProvider')
  return context
}

export default useTabs
