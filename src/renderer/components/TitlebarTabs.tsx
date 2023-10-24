import { FC } from 'react';
import { HiXMark } from 'react-icons/hi2';
import ScrollContainer from 'react-indiana-drag-scroll';

import { classNames } from '../../utils';
/**
 * Props for the TitlebarTabs component.
 */
export type TitlebarTabsProps = {
  tabs: {
    id: number | string;
    title: string;
    onClick?: () => void;
    onClickCloseButton?: () => void;
    current?: boolean;
  }[];
};
/**
 * TitlebarTabs component to display tabs in the titlebar.
 * @returns a JSX component with the tabs in the titlebar
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const TitlebarTabs: FC<TitlebarTabsProps> = ({ tabs }) => {
  return (
    <ScrollContainer className="mx-4">
      <div className="flex items-center">
        <nav className="flex space-x-2" aria-label="Tabs">
          {tabs.map(
            ({ id, title, current = false, onClick, onClickCloseButton }) => (
              <div
                key={id}
                className={classNames(
                  current ? 'opacity-100' : 'opacity-50 hover:opacity-100',
                  'no-drag-window flex w-36 items-center justify-between overflow-hidden rounded-md border border-gray-700/30 bg-gray-800/30 px-3 py-2 text-sm font-medium text-white transition-all duration-300',
                )}
              >
                <div
                  className={classNames(
                    current ? 'bg-open-plc-blue' : 'bg-white',
                    'h-2 w-2 rounded-full transition-colors duration-300',
                  )}
                />
                <button
                  onClick={onClick}
                  type="button"
                  className="press-animated w-16 overflow-hidden truncate whitespace-nowrap"
                  aria-current={current ? 'page' : undefined}
                >
                  {title}
                </button>
                <button
                  onClick={onClickCloseButton}
                  type="button"
                  className="press-animated"
                >
                  <HiXMark className="h-4 w-4 text-gray-700 transition-colors duration-300 hover:text-white" />
                </button>
              </div>
            ),
          )}
        </nav>
      </div>
    </ScrollContainer>
  );
};

export default TitlebarTabs;
