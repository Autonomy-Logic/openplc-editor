import { CONSTANTS } from '@shared/constants';
import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';

const { channels } = CONSTANTS;

type Channels = (typeof channels)[keyof typeof channels];

export type IpcRenderChannelProps = {
  get?: Channels;
  set?: Channels;
};
export type IpcRenderProps<T> = {
  send: (data: T) => void;
  data?: T;
  receivedFirstResponse: boolean;
};

const useIpcRender = <T>(
  channel: IpcRenderChannelProps,
  initialData?: T,
): IpcRenderProps<T> => {
  const [data, setData] = useState<T>();
  const [receivedFirstResponse, setReceivedFirstResponse] = useState(false);

  useEffect(() => {
    channel.get && ipcRenderer.send(channel.get, initialData);
  }, [channel.get, initialData]);

  useEffect(() => {
    channel.get &&
      ipcRenderer.on(channel.get, (_event, arg) => {
        setData(arg);
        setReceivedFirstResponse((state) => (state ? state : true));
      });
    return () => {
      channel.get && ipcRenderer.removeAllListeners(channel.get);
    };
  }, [channel.get]);

  const send = (data: T) => channel.set && ipcRenderer.send(channel.set, data);

  return {
    send,
    data,
    receivedFirstResponse,
  };
};

export default useIpcRender;
