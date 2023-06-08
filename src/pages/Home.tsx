import { CONSTANTS } from '@shared/constants';
import { ChildWindowProps } from '@shared/types/childWindow';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Layout } from '@/components';
import { useIpcRender } from '@/hooks';
import { BottomRow, LeftColumn, RightColumn, TopRow } from '@/templates';

const {
  channels: { get, set },
  paths,
} = CONSTANTS;
const Home: React.FC = () => {
  const { t } = useTranslation('createPOU');
  const { invoke: createChildWindow } = useIpcRender<ChildWindowProps>();

  useIpcRender<undefined, boolean>({
    channel: get.CREATE_POU_WINDOW,
    callback: (createPOUWindow) => {
      if (createPOUWindow)
        createChildWindow(set.CREATE_CHILD_WINDOW, {
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
    },
  });

  return (
    <Layout
      topRow={<TopRow />}
      rightColumn={<RightColumn />}
      bottomRow={<BottomRow />}
      leftColumn={<LeftColumn />}
      mainContent={<div />}
    />
  );
};

export default Home;
