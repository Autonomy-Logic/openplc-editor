import { useEffect, useState } from 'react'

import { LogoIcon } from '../../../assets/icons/interface/Logo'

const ResolutionWarning = () => {
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth)

  const setScreenOrientation = () => {
    setIsPortrait(window.innerHeight > window.innerWidth)
  }

  useEffect(() => {
    window.addEventListener('resize', setScreenOrientation)
    return () => window.removeEventListener('resize', setScreenOrientation)
  }, [])

  return (
    <div className='flex h-screen w-screen flex-col items-center justify-center gap-6 bg-brand-dark dark:bg-neutral-950'>
      <div className='h-1/5 w-[40.24%] '>
        <LogoIcon size='lg' />
      </div>
      {isPortrait ? (
        <p className='left-1/5 top-2/3 h-24 w-3/5 text-center text-xl font-normal leading-[24.38px] text-white'>
          Please rotate your device.
        </p>
      ) : (
        <p className='left-1/5 top-2/3 h-24 w-3/5 text-center text-xl font-normal leading-[24.38px] text-white'>
          This application isn't supported on mobile devices. You can try the OpenPLC Web Editor on a desktop, laptop,
          or tablet.
        </p>
      )}
    </div>
  )
}

export { ResolutionWarning }
