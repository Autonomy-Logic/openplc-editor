import { useContext } from 'react'

import { ThemeContext } from '@/contexts'
import { ThemeContextData } from '@/contexts/Theme'
/**
 * Custom hook to interact with the theme context
 * @function
 * @returns {ThemeContextData} - Theme context data
 */
const useTheme = (): ThemeContextData => {
  /**
   * Get the theme context from the ThemeProvider
   */
  const context = useContext(ThemeContext)
  /**
   * Throw an error if the hook is not used within a ThemeProvider
   */
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

export default useTheme
