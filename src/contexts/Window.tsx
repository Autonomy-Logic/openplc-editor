import { CONSTANTS } from '@shared/constants';
import React, {
  createContext,
  Fragment,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { Window } from '@/components';
import { WindowProps } from '@/components/Window';
import { useIpcRender } from '@/hooks';

const { channels } = CONSTANTS;

type CreateWindowProps = {
  id: string | number;
  content: React.ReactElement;
};

export type WindowContextData = {
  createWindow: (window: CreateWindowProps & WindowProps) => void;
  closeWindow: (id: string | number) => void;
  closeAllWindows: () => void;
};

export const WindowContext = createContext<WindowContextData>({} as WindowContextData);

const WindowProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [windows, setWindows] = useState<CreateWindowProps[]>([]);
  const { data: createNewPouWindow } = useIpcRender<boolean>({
    get: channels.SET_CREATE_NEW_POU_WINDOW,
  });

  const closeAllWindows = useCallback(() => setWindows([]), []);

  const closeWindow = useCallback((id: string | number) => {
    setWindows((state) => state.filter((item) => item.id !== id));
  }, []);

  const createWindow = useCallback(
    (window: CreateWindowProps & Omit<WindowProps, 'closeWindow'>) => {
      setWindows((state) => [
        ...state,
        {
          ...window,
          content: (
            <Window {...window} closeWindow={() => closeWindow(window.id)}>
              {window.content}
            </Window>
          ),
        },
      ]);
    },
    [closeWindow],
  );

  useEffect(() => {
    if (createNewPouWindow) {
      createWindow({
        id: 'create-pou-window',
        title: 'Create a New POU',
        content: <>Create new Pou</>,
      });
    }
  }, [createNewPouWindow, createWindow]);

  return (
    <WindowContext.Provider value={{ createWindow, closeWindow, closeAllWindows }}>
      <div className="h-0 w-0 z-50">
        {windows.map(({ id, content }, index) => (
          <Fragment key={`${index}_${id}`}>{content}</Fragment>
        ))}
      </div>
      {children}
    </WindowContext.Provider>
  );
};

export default WindowProvider;
