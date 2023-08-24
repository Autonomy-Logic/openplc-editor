import { useEffect, useState } from 'react'
/**
 * Type representing the width and height of the window
 * @typedef {object} WindowSizeProps
 * @property {number} width - The width of the window
 * @property {number} height - The height of the window
 */
export type WindowSizeProps = {
  width: number
  height: number
}
/**
 * Custom hook to track the size of the window
 * @function
 * @returns {WindowSizeProps} - An object containing the width and height of the window
 */
const useWindowSize = (): WindowSizeProps => {
  /**
   * Initialize the state with the current window dimensions
   */
  const [windowSize, setWindowSize] = useState<WindowSizeProps>({
    width: 0,
    height: 0,
  })
  /**
   * Handle window resize events and update the state accordingly
   */
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }
    /**
     * Add a resize event listener and call the resize handler immediately
     */
    window.addEventListener('resize', handleResize)
    handleResize()
    /**
     * Clean up by removing the resize event listener
     */
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  /**
   * Return an object containing the current width and height of the window
   */
  return windowSize
}

export default useWindowSize
