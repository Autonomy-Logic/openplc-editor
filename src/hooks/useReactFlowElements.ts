import { useContext } from 'react'

import { ReactFlowElementsContext } from '@/contexts'
import { ReactFlowElementsContextData } from '@/contexts/ReactFlowElements'
/**
 * Custom hook to interact with the React Flow context
 * @function
 * @returns {ReactFlowElementsContextData} - React Flow context data
 */
const useReactFlowElements = (): ReactFlowElementsContextData => {
  /**
   * Get the React Flow context from the ReactFlowElementsProvider
   */
  const context = useContext(ReactFlowElementsContext)
  /**
   * Throw an error if the hook is not used within a ReactFlowProvider
   */
  if (!context)
    throw new Error(
      'useReactFlowElements must be used within a ReactFlowElementsProvider',
    )
  return context
}

export default useReactFlowElements
