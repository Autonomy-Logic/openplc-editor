import { CloseButton, MaximizeButton, MinimizeButton } from '@process:renderer/components/_atoms/titlebar/right-content/buttons'
import { useOpenPLCStore } from '@process:renderer/store'

export const TitlebarRightContent = () => {
  /**
   * Get the platform name from the store and check if it's macOS
   */
  const OS = useOpenPLCStore().workspace.systemConfigs.OS
  const isMac = OS === 'darwin'
  /**
   * Create a template for macOS systems
   */
  const DarwinTemplate = () => <></>
  /**
   * Create a template for windows and other systems
   */
  const DefaultTemplate = () => {
    return (
      <div className='flex h-full'>
        <MinimizeButton />
        <MaximizeButton />
        <CloseButton />
      </div>
    )
  }
  /**
   * Render the appropriate template based on the platform
   */
  return <div className='flex items-center justify-end'>{isMac ? <DarwinTemplate /> : <DefaultTemplate />}</div>
}
