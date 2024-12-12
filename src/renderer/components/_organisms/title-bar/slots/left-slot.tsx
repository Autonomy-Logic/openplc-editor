import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { MenuBar } from '@process:renderer/components/_molecules/menu-bar'
import { useOpenPLCStore } from '@process:renderer/store'

export const TitleBarLeftSlot = () => {
  /**
   * Get the platform name from the store and check if it's a macOS
   */
  const {
    workspace: {
      systemConfigs: { OS },
    },
    project: {
      meta: { path },
    },
  } = useOpenPLCStore()
  const isMac = OS === 'darwin'

  /**
   * Get information about the current location to perform conditional rendering
   */
  // const navigation = useLocation()
  // const path = navigation.pathname

  /**
   * Create a template for macOS systems
   */
  const DarwinTemplate = () => <></>

  /**
   * Create a template for windows and other systems
   */
  const DefaultTemplate = () =>
    path !== '' ? (
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
    <div className='flex items-center justify-start gap-1 px-4 py-0.5'>
      {isMac ? <DarwinTemplate /> : <DefaultTemplate />}
    </div>
  )
}
