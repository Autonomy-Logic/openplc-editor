import { Transition } from '@headlessui/react'
import { FC, MouseEvent, PropsWithChildren, useCallback, useState } from 'react'
import { HiMinusSmall, HiPlusSmall } from 'react-icons/hi2'

import { classNames } from '@/utils'

import Tree, { RootProps } from './index'
import Item from './Item'

export type DirectoryProps = {
  item: RootProps
  isChild?: boolean
}

export const Directory: FC<PropsWithChildren<DirectoryProps>> = ({
  item,
  isChild = false,
}) => {
  const { title, icon: Icon } = item
  const [toggle, setToggle] = useState<boolean>(false)

  const onCollapseClicked = useCallback(
    (event: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>) => {
      event.stopPropagation()
      setToggle(!toggle)
    },
    [toggle],
  )

  return (
    <Item className={classNames(isChild && 'ml-6')}>
      <div className="flex items-center p-1 pl-0">
        <button
          type="button"
          className="mr-3 flex w-4 items-center justify-center"
          onClick={onCollapseClicked}
        >
          {toggle ? (
            <HiMinusSmall className="w-4" />
          ) : (
            <HiPlusSmall className="w-4" />
          )}
        </button>
        {Icon && <Icon />}
        <span className="ml-1 block truncate transition">{title}</span>
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
