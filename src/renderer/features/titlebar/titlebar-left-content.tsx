import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { useOpenPLCStore } from '@process:renderer/store'
import { useLocation } from 'react-router-dom'

import { MenuBar } from './menu-bar'

export const TitlebarLeftContent = () => {
  /**
   * Get the platform name from the store and check if it's macOS
   */
  const OS = useOpenPLCStore().workspaceState.systemConfigs.OS
  const isMac = OS === 'darwin'
  /**
   * Get information about the current location to perform conditional rendering
   */
  const navigation = useLocation()
  const path = navigation.pathname
  /**
   * Create a template for macOS systems
   */
  const DarwinTemplate = () => <></>
  /**
   * Create a template for windows and other systems
   */
  const DefaultTemplate = () =>
    path.includes('/workspace') ? (
      <>
        <OpenPLCIcon />
        <MenuBar />
      </>
    ) : (
      <></>
    )
  /**
   * Render the appropriate template based on the platform
   */
  return (
    <div className='flex items-center justify-start px-4 py-0.5 gap-1'>
      {' '}
      {isMac ? <DarwinTemplate /> : <DefaultTemplate />}
    </div>
  )
}
