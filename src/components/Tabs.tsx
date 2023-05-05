import React from 'react';

import { classNames } from '@/utils';

export type TabsProps = {
  tabs: {
    id: number | string;
    name: string;
    onClick: () => void;
    current: boolean;
  }[];
};

const Tabs: React.FC<TabsProps> = ({ tabs }) => {
  return (
    <div className="bg-white px-4 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        {tabs.map(({ id, name, current, onClick }) => (
          <button
            key={id}
            onClick={onClick}
            type="button"
            className={classNames(
              current
                ? 'border-open-plc-blue text-open-plc-blue'
                : 'border-transparent text-gray-500 hover:border-gray-600 hover:text-gray-600',
              'whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium',
            )}
            aria-current={current ? 'page' : undefined}
          >
            {name}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Tabs;
