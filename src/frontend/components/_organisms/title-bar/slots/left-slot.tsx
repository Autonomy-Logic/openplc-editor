import { useCapabilities } from '../../../../../middleware/shared/providers'
import { OpenPLCIcon } from '../../../../assets/icons/oplc'
import { useOpenPLCStore } from '../../../../store'
import { MenuBar } from '../../../_molecules/menu-bar'

export const TitleBarLeftSlot = () => {
  const caps = useCapabilities()
  const path = useOpenPLCStore((state) => state.project.meta.path)
  const OS = useOpenPLCStore((state) => state.workspace.systemConfigs.OS)

  if (caps.isNativeApplication && OS !== 'win32') {
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
