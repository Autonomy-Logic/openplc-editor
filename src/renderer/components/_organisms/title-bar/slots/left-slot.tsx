import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { MenuBar } from '@process:renderer/components/_molecules/menu-bar'
import { useOpenPLCStore } from '@process:renderer/store'

export const TitleBarLeftSlot = () => {
  // Use granular selectors to prevent re-renders from unrelated store updates (e.g., polling)
  const OS = useOpenPLCStore((state) => state.workspace.systemConfigs.OS)
  const path = useOpenPLCStore((state) => state.project.meta.path)

  const isMac = OS === 'darwin'

  // Render nothing on macOS (uses native menu bar)
  if (isMac) {
    return <div className='flex items-center justify-start gap-1 px-4 py-0.5' />
  }

  // On Windows/Linux, show the custom menu bar when a project is open
  return (
    <div className='flex items-center justify-start gap-1 px-4 py-0.5'>
      {path !== '' && (
        <>
          <OpenPLCIcon />
          <MenuBar />
        </>
      )}
    </div>
  )
}
