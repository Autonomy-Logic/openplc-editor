import { Transition } from '@headlessui/react'
import { FC, MouseEvent, PropsWithChildren, useCallback, useState } from 'react'
import { IoMdArrowDropdown, IoMdArrowDropup } from 'react-icons/io'

import { classNames } from '@/utils'

import Tree, { RootProps } from './index'
import Item from './Item'

export type DirectoryProps = {
  item: RootProps
  isChild?: boolean
  isMainDirectory?: boolean
}

export const Directory: FC<PropsWithChildren<DirectoryProps>> = ({
  item,
  isChild = false,
  isMainDirectory = false,
}) => {
  const { title, icon: Icon, onClick } = item
  const [toggle, setToggle] = useState<boolean>(false)

  const onCollapseClicked = useCallback(
    (event: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>) => {
      event.stopPropagation()
      setToggle(!toggle)
    },
    [toggle],
  )

  return (
    <Item className={classNames(isChild && 'ml-6 max-w-fit cursor-pointer')}>
      <div className="flex items-center p-1 pl-0">
        <button
          type="button"
          className="mr-3 flex w-4 items-center justify-center"
          onClick={onCollapseClicked}
        >
          {toggle ? (
            <IoMdArrowDropup className="w-4 text-gray-400 dark:text-gray-600" />
          ) : (
            <IoMdArrowDropdown className="w-4 text-gray-400 dark:text-gray-600" />
          )}
        </button>
        {Icon && <Icon />}
        <button onClick={onClick}>
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
        show={toggle}
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
  )
}
