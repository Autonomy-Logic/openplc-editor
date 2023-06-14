import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs } from '@/components';

const RightColumn: React.FC = () => {
  const { t } = useTranslation('rightColumnTabs');

  const [current, setCurrent] = useState(0);

  const rightColumnTabs = [
    {
      id: 0,
      name: t('library'),
      onClick: () => setCurrent(0),
      current: current === 0,
    },
    {
      id: 1,
      name: t('debugger'),
      onClick: () => setCurrent(1),
      current: current === 1,
    },
  ];

  return (
    <aside>
      <Tabs tabs={rightColumnTabs} />
    </aside>
  );
};

export default RightColumn;
