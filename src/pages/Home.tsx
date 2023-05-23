import { CONSTANTS } from '@shared/constants';
import { ChildWindowProps } from '@shared/types/childWindow';
import React, { useEffect } from 'react';

import { Layout } from '@/components';
// import { PathsProps } from '@/contexts/Router';
import { useIpcRender } from '@/hooks';
import { BottomRow, LeftColumn, RightColumn, TopRow } from '@/templates';

const {
  channels: { set },
} = CONSTANTS;
const Home: React.FC = () => {
  const { send: createChildWindow } = useIpcRender<ChildWindowProps>({
    set: set.NEW_WINDOW,
  });
  const { data: createPOUWindow } = useIpcRender({
    get: set.CREATE_POU_WINDOW,
  });

  useEffect(() => {
    if (createPOUWindow)
      createChildWindow({
        path: 'create-pou',
      });
  }, [createPOUWindow, createChildWindow]);

  return (
    <Layout
      topRow={<TopRow />}
      rightColumn={<RightColumn />}
      bottomRow={<BottomRow />}
      leftColumn={<LeftColumn />}
      mainContent={
        <>
          <button
            className="bg-white shadow rounded p-2 m-4"
            onClick={() =>
              createChildWindow({
                path: 'create-pou',
                resizable: false,
                center: true,
                modal: true,
                minimizable: false,
                fullscreenable: false,
                fullscreen: false,
                title: 'Create new POU',
                // hideMenuBar: true,
              })
            }
          >
            Create new window
          </button>
        </>
      }
    />
  );
};

export default Home;
