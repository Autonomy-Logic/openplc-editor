import {
  DebuggerIcon,
  DownloadIcon,
  ExitIcon,
  PlayIcon,
  SearchIcon,
  TransferIcon,
  ZoomInOut,
} from '@process:renderer/assets/icons'
import { useOpenPLCStore } from '@root/renderer/store'
import { useNavigate } from 'react-router-dom'

import { ActivitybarButton } from './components'

export default function Activitybar() {
  const {
    workspaceActions: { setEditingState },
    tabsActions: { clearTabs },
  } = useOpenPLCStore()
  const navigate = useNavigate()
  const returnStartScreen = () => {
    setEditingState('unsaved')
    clearTabs()
    navigate('/')
  }

  return (
    /* Refactor: This outside div will be replaced by the new <WorkspaceSideContent /> */
    <div className='flex h-full w-14 flex-col justify-between border-t-inherit bg-brand-dark pb-10 dark:bg-neutral-950'>
      <div className='my-5 flex h-fit w-full flex-col gap-10'>
        <ActivitybarButton label='Search' Icon={SearchIcon} onClick={() => console.log('search')} />
        <ActivitybarButton label='Zoom' Icon={ZoomInOut} onClick={() => console.log('zoom')} />
        <ActivitybarButton label='Download' Icon={DownloadIcon} onClick={() => console.log('download')} />
        <ActivitybarButton label='Transfer' Icon={TransferIcon} onClick={() => console.log('transfer')} />
        <ActivitybarButton label='Debugger' Icon={DebuggerIcon} onClick={() => console.log('debugger')} />
        <ActivitybarButton label='Play' Icon={PlayIcon} onClick={() => console.log('play')} />
      </div>
      <div className='flex h-20 w-full flex-col gap-6'>
        <ActivitybarButton label='Exit' Icon={ExitIcon} onClick={returnStartScreen} />
      </div>
    </div>
  )
}
