import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { useOpenPLCStore } from '@process:renderer/store'

const TitleBarCenterSlot = () => {
  // Use granular selectors to prevent re-renders from unrelated store updates (e.g., polling)
  const OS = useOpenPLCStore((state) => state.workspace.systemConfigs.OS)
  const path = useOpenPLCStore((state) => state.project.meta.path)

  const isMac = OS === 'darwin'

  return (
    <div className='oplc-titlebar-drag-region flex flex-1 items-center justify-center gap-2'>
      {isMac ? (
        <>
          <OpenPLCIcon />
          <span className='font-caption text-xs font-normal'>OpenPLC Editor</span>
        </>
      ) : (
        path === '' && <span className='font-caption text-xs font-normal'>OpenPLC Editor</span>
      )}
    </div>
  )
}

export { TitleBarCenterSlot }
