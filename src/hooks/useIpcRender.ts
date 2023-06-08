import { CONSTANTS } from '@shared/constants';
import { ipcRenderer } from 'electron';
import { useCallback, useEffect } from 'react';

const { channels } = CONSTANTS;

type GetChannels = (typeof channels.get)[keyof typeof channels.get];
type SetChannels = (typeof channels.set)[keyof typeof channels.set];

type Channels = GetChannels | SetChannels;

export type IpcRenderProps<T = void, S = void> = {
  invoke: (channel: Channels, data?: T) => Promise<S>;
};

const useIpcRender = <T = void, S = void>(listener?: {
  channel: Channels;
  callback: (data: S) => void;
}): IpcRenderProps<T, S> => {
  useEffect(() => {
    if (listener) {
      ipcRenderer.on(listener.channel, (_event, arg) => {
        listener.callback(arg);
      });
      return () => {
        ipcRenderer.removeAllListeners(listener.channel);
      };
    }
  }, [listener]);

  const invoke = useCallback(async (channel: Channels, data?: T) => {
    const response = await ipcRenderer.invoke(channel, data);
    return response as S;
  }, []);

  return {
    invoke,
  };
};

export default useIpcRender;
