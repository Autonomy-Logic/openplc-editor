import { useCallback, useEffect, useState } from 'react'
export type FullScreenProps = {
  isFullScreen: boolean
  requestFullscreen: () => void
  exitFullScreen: () => void
}
const useFullScreen = (): FullScreenProps => {
  const [isFullScreen, setIsFullScreen] = useState(
    window.innerHeight == screen.height,
  )

  const { documentElement } = document

  const requestFullscreen = useCallback(() => {
    if (documentElement && documentElement.requestFullscreen)
      documentElement.requestFullscreen()
  }, [documentElement])

  const exitFullScreen = useCallback(() => {
    if (document && document.exitFullscreen) document.exitFullscreen()
  }, [])

  useEffect(() => {
    const resize = () => {
      if (window.innerHeight == screen.height) {
        setIsFullScreen(true)
      } else {
        setIsFullScreen(false)
      }
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const fullscreenchange = () => {
      if (document.fullscreenElement) {
        setIsFullScreen(true)
      } else {
        setIsFullScreen(false)
      }
    }
    document.addEventListener('fullscreenchange', fullscreenchange)
    return () => window.removeEventListener('resize', fullscreenchange)
  }, [])

  useEffect(() => {
    const [titlebar] = document.getElementsByClassName('cet-titlebar')
    const [container] = document.getElementsByClassName('cet-container')

    if (titlebar && container) {
      if (isFullScreen) {
        container.classList.replace('top-16', 'top-0')
      } else {
        container.classList.add('top-16')
        container.classList.replace('top-0', 'top-16')
      }
    }
  }, [isFullScreen])

  return {
    requestFullscreen,
    exitFullScreen,
    isFullScreen,
  }
}

export default useFullScreen
