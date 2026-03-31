import { TitleBarCenterSlot, TitleBarLeftSlot, TitleBarRightSlot } from './slots'

const TitleBar = () => {
  return (
    <div id='title-bar' className='oplc-titlebar-container'>
      <div className='oplc-titlebar-content dark:bg-neutral-950'>
        <TitleBarLeftSlot />
        <TitleBarCenterSlot />
        <TitleBarRightSlot />
      </div>
    </div>
  )
}

export { TitleBar }
