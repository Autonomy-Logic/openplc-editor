import { Transition } from '@headlessui/react';
import { MouseEvent, ReactNode, useCallback } from 'react';
import { IoMdArrowDropdown, IoMdArrowDropup } from 'react-icons/io';

import { classNames } from '../../../utils';
// REFACTOR: Find the module that is causing this error
// eslint-disable-next-line import/no-cycle
import { useToggle } from '../../hooks';
import Tree, { RootProps } from './index';
import Item from './Item';
/**
 * Props for the Directory component.
 */
export type DirectoryProps = {
  item: RootProps;
  isChild?: boolean;
  isMainDirectory?: boolean;
};
/**
 * Directory component used to render a directory item with collapsible behavior.
 * @param item - The root item of the directory.
 * @param isChild - Whether the directory is a child directory.
 * @param isMainDirectory - Whether the directory is the main directory.
 */
export function Directory({
  item,
  isChild = false,
  isMainDirectory = false,
}: DirectoryProps): ReactNode {
  const { title, icon: Icon, onClick } = item;
  /**
   *  Toggle state for controlling the open/collapsed state of the directory
   */
  const [open, toggleOpen] = useToggle(false);
  /**
   * Handler for the collapse button click
   */
  const onCollapseClicked = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      toggleOpen();
    },
    [toggleOpen],
  );

  return (
    <Item className={classNames(isChild && 'ml-6 max-w-fit cursor-pointer')}>
      <div className="flex items-center p-1 pl-0">
        <button
          type="button"
          className="mr-3 flex w-4 items-center justify-center"
          onClick={onCollapseClicked}
        >
          {open ? (
            <IoMdArrowDropup className="w-4 text-gray-400 dark:text-gray-600" />
          ) : (
            <IoMdArrowDropdown className="w-4 text-gray-400 dark:text-gray-600" />
          )}
        </button>
        {Icon && <Icon />}
        <button
          type="button"
          onClick={onClick}
          className={classNames(onClick ? 'cursor-pointer' : 'cursor-text')}
        >
          <span
            className={classNames(
              !!Icon && 'ml-1',
              isMainDirectory ? 'text-lg' : 'text-sm',
              'block truncate font-semibold uppercase text-gray-400 transition dark:text-gray-600',
            )}
          >
            {title}
          </span>
        </button>
      </div>
      <Transition
        show={open}
        enter="transition-opacity duration-75"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-150"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Tree root={item} isChild />
      </Transition>
    </Item>
  );
}
