import { OpenPLCIcon } from '../../../../assets/icons/oplc'
import { MenuBar } from '../../../_molecules/menu-bar'
import { useOpenPLCStore } from '../../../../store'
import { useCapabilities } from '../../../../../middleware/shared/providers'

export const TitleBarLeftSlot = () => {
  const caps = useCapabilities()
  const path = useOpenPLCStore((state) => state.project.meta.path)

  if (caps.hasNativeMenu) {
    return <div className='flex items-center justify-start gap-1 px-4 py-0.5' />
  }

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
