import { TitlebarCenterContent } from '@process:renderer/components/_atoms/titlebar/center-content'
import { TitlebarRightContent } from '@process:renderer/components/_molecules/titlebar/right-content'

import { TitlebarLeftContent } from './left-content'

export const TitleBar = () => {
  return (
    <div className='oplc-titlebar-container'>
      <div className='oplc-titlebar-content dark:bg-neutral-950'>
        <TitlebarLeftContent />
        <TitlebarCenterContent />
        <TitlebarRightContent />
      </div>
    </div>
  )
}
