import { FC } from 'react';

import { classNames } from '../../utils';
/**
 * Props for the Tabs component.
 */
export type TabsProps = {
  tabs: {
    id: number | string;
    title: string;
    onClick?: () => void;
    current: boolean;
  }[];
};
/**
 * Tabs component to display a tab navigation bar.
 * @returns a JSX component with the tab wrapper for the navigation bar.
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const Tabs: FC<TabsProps> = ({ tabs }) => {
  return (
    <div className="border-b border-gray-900/10 bg-white px-4 dark:border-white/5 dark:bg-gray-900">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        {tabs.map(({ id, title, current, onClick }) => (
          <button
            key={id}
            onClick={onClick}
            type="button"
            className={classNames(
              current
                ? 'border-open-plc-blue text-open-plc-blue'
                : 'border-transparent text-gray-500 hover:border-gray-600 hover:text-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-500',
              'whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium',
            )}
            aria-current={current ? 'page' : undefined}
          >
            {title}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Tabs;
