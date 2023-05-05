import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs } from '@/components';

const BottomRow: React.FC = () => {
  const { t } = useTranslation();

  const [current, setCurrent] = useState(0);

  const bottomRowTabs = [
    {
      id: 0,
      name: t('bottomRowTabs.search'),
      onClick: () => setCurrent(0),
      current: current === 0,
    },
    {
      id: 1,
      name: t('bottomRowTabs.console'),
      onClick: () => setCurrent(1),
      current: current === 1,
    },
    {
      id: 2,
      name: t('bottomRowTabs.plcLog'),
      onClick: () => setCurrent(2),
      current: current === 2,
    },
  ];

  return <Tabs tabs={bottomRowTabs} />;
};

export default BottomRow;
