import { CONSTANTS } from '@shared/constants';
import { ipcRenderer } from 'electron';
import { useCallback, useEffect, useState } from 'react';

const { channels } = CONSTANTS;

type GetChannels = (typeof channels.get)[keyof typeof channels.get];
type SetChannels = (typeof channels.set)[keyof typeof channels.set];

export type IpcRenderChannelProps = {
  get?: GetChannels;
  set?: SetChannels;
};
export type IpcRenderProps<T> = {
  send: (data: T) => void;
  data?: T;
};

const useIpcRender = <T>(
  channel: IpcRenderChannelProps,
  initialData?: T,
): IpcRenderProps<T> => {
  const [data, setData] = useState<T>(initialData as T);

  useEffect(() => {
    channel.get && ipcRenderer.send(channel.get, initialData);
  }, [channel.get, initialData]);

  useEffect(() => {
    channel.get &&
      ipcRenderer.on(channel.get, (_event, arg) => {
        setData(arg);
      });
    return () => {
      channel.get && ipcRenderer.removeAllListeners(channel.get);
    };
  }, [channel.get]);

  const send = useCallback(
    (data: T) => channel.set && ipcRenderer.send(channel.set, data),
    [channel.set],
  );

  return {
    send,
    data,
  };
};

export default useIpcRender;
