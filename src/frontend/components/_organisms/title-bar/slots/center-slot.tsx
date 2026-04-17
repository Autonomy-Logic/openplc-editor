import { useCapabilities } from '../../../../../middleware/shared/providers'
import { OpenPLCIcon } from '../../../../assets/icons/oplc'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'

const TitleBarCenterSlot = () => {
  const caps = useCapabilities()
  const path = useOpenPLCStore((state) => state.project.meta.path)

  return (
    <div
      className={cn('flex flex-1 items-center justify-center gap-2', {
        'oplc-titlebar-drag-region': caps.isNativeApplication,
      })}
    >
      {caps.isNativeApplication ? (
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
