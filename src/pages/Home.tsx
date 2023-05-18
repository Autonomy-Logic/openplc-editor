import React from 'react';

import { Layout } from '@/components';
import { BottomRow, LeftColumn, RightColumn, TopRow } from '@/templates';

const Home: React.FC = () => {
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
