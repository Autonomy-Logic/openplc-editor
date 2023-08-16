import { useContext } from 'react'

import { ReactFlowElementsContext } from '@/contexts'
import { ReactFlowElementsContextData } from '@/contexts/ReactFlowElements'

const useReactFlowElements = (): ReactFlowElementsContextData => {
  const context = useContext(ReactFlowElementsContext)
  if (!context)
    throw new Error(
      'useReactFlowElements must be used within a ReactFlowElementsProvider',
    )
  return context
}

export default useReactFlowElements
