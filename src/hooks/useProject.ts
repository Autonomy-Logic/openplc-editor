import { useContext } from 'react'

import { ProjectContext } from '@/contexts'
import { ProjectContextData } from '@/contexts/Project'
/**
 * Custom hook to interact with the project context
 * @function
 * @returns {ProjectContextData} - Project context data
 */
const useProject = (): ProjectContextData => {
  /**
   * Get the project context from the ProjectProvider
   */
  const context = useContext(ProjectContext)
  /**
   * Throw an error if the hook is not used within a ProjectProvider
   */
  if (!context)
    throw new Error('useProject must be used within a ProjectProvider')
  return context
}

export default useProject
