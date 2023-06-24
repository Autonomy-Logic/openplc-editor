import { Transition } from '@headlessui/react'
import { FC, MouseEvent, PropsWithChildren, useCallback, useState } from 'react'
import { HiMinusSmall, HiPlusSmall } from 'react-icons/hi2'

import Tree, { RootProps } from './index'
import Item from './Item'

export type DirectoryProps = {
  item: RootProps
  onContextMenu: (
    event: MouseEvent<HTMLLIElement, globalThis.MouseEvent>,
  ) => void
  hide: () => void
}

export const Directory: FC<PropsWithChildren<DirectoryProps>> = ({
  item,
  onContextMenu,
  hide,
}) => {
  return <></>
}
