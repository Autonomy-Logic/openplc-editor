import { CONSTANTS } from '@shared/constants';
import { ChildWindowProps } from '@shared/types/childWindow';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Layout } from '@/components';
import { useIpcRender } from '@/hooks';
import { BottomRow, LeftColumn, RightColumn, TopRow } from '@/templates';

const {
  channels: { set },
  paths,
} = CONSTANTS;
const Home: React.FC = () => {
  const { t } = useTranslation('createPOU');
  const { send: createChildWindow } = useIpcRender<ChildWindowProps>({
    set: set.CREATE_CHILD_WINDOW,
  });
  const { data: createPOUWindow } = useIpcRender({
    get: set.CREATE_POU_WINDOW,
  });

  useEffect(() => {
    if (createPOUWindow)
      createChildWindow({
        path: paths.CREATE_POU,
        resizable: false,
        center: true,
        modal: true,
        minimizable: false,
        fullscreenable: false,
        fullscreen: false,
        width: 576,
        height: 360,
        hideMenuBar: true,
        title: t('title'),
      });
  }, [createPOUWindow, createChildWindow, t]);

  return (
    <Layout
      topRow={<TopRow />}
      rightColumn={<RightColumn />}
      bottomRow={<BottomRow />}
      leftColumn={<LeftColumn />}
      mainContent={<></>}
    />
  );
};

export default Home;
