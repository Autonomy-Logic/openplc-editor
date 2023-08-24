import { CONSTANTS } from '@shared/constants'
import { ipcRenderer } from 'electron'
import { useCallback, useEffect } from 'react'
// Extract necessary property (in this case the 'channels') from the imported CONSTANTS object.
const { channels } = CONSTANTS
/**
 * Define types for IPC channel names
 * @type {GetChannels} - Names of "get" channels
 * @type {SetChannels} - Names of "set" channels
 * @type {Channels} - Union type of "get" and "set" channel names
 */
type GetChannels = (typeof channels.get)[keyof typeof channels.get]
type SetChannels = (typeof channels.set)[keyof typeof channels.set]
type Channels = GetChannels | SetChannels
/**
 * Define the shape of IpcRenderProps
 * @interface IpcRenderProps
 */
export type IpcRenderProps<T = void, S = void> = {
  invoke: (channel: Channels, data?: T) => Promise<S>
}
/**
 * Custom hook for using ipcRenderer to communicate between processes
 * @function
 * @param {Object} listener - An object containing channel and callback
 * @returns {IpcRenderProps<T, S>} - Object with an invoke function to send and receive IPC messages
 */
const useIpcRender = <T = void, S = void>(listener?: {
  channel: Channels
  callback: (data: S) => void
}): IpcRenderProps<T, S> => {
  /**
   * Set up IPC event listener when a listener object is provided
   */
  useEffect(() => {
    if (listener) {
      ipcRenderer.on(listener.channel, (_event, arg) => {
        listener.callback(arg)
      })
      // Clean up event listener when the component unmounts
      return () => {
        ipcRenderer.removeAllListeners(listener.channel)
      }
    }
  }, [listener])
  /**
   * Define an invoke function to send and receive IPC messages
   * @function
   * @param {Channels} channel - The IPC channel to use
   */
  const invoke = useCallback(async (channel: Channels, data?: T) => {
    const response = await ipcRenderer.invoke(channel, data)
    return response as S
  }, [])

  return {
    invoke,
  }
}

export default useIpcRender
