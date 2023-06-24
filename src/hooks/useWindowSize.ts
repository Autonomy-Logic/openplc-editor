import { useEffect, useState } from 'react'

export type WindowSizeProps = {
  width: number
  height: number
}
const useWindowSize = (): WindowSizeProps => {
  const [windowSize, setWindowSize] = useState<WindowSizeProps>({
    width: 0,
    height: 0,
  })
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return windowSize
}

export default useWindowSize
