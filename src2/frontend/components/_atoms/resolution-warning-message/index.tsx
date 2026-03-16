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
    <div className='flex flex-col h-screen w-screen items-center justify-center bg-brand-dark dark:bg-neutral-950 gap-6'>
      <div className='w-[40.24%] h-1/5 '>
        <LogoIcon size='lg' />
      </div>
      {isPortrait ? (
        <p className='w-3/5 h-24 top-2/3 left-1/5 font-normal text-xl leading-[24.38px] text-center text-white'>
          Please rotate your device.
        </p>
      ) : (
        <p className='w-3/5 h-24 top-2/3 left-1/5 font-normal text-xl leading-[24.38px] text-center text-white'>
          This application isn't supported on mobile devices. You can try the OpenPLC Web Editor on a desktop, laptop,
          or tablet.
        </p>
      )}
    </div>
  )
}

export { ResolutionWarning }
