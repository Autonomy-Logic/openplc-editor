import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { titleBarSelectors } from '@root/renderer/hooks/use-store-selectors'

const TitleBarCenterSlot = () => {
  const OS = titleBarSelectors.useOS()
  const path = titleBarSelectors.useProjectPath()

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
