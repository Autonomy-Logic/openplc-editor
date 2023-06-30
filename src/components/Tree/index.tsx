import { FC, useCallback } from 'react'
import { IconType } from 'react-icons'

import { classNames } from '@/utils'

import { Directory } from './Directory'
import Item from './Item'

export type RootProps = {
  id: string | number
  title: string
  icon?: IconType
  children?: RootProps[]
}

export type TreeProps = {
  root?: RootProps
  isChild?: boolean
}

const Tree: FC<TreeProps> = ({ root, isChild = false }) => {
  const onItemClicked = useCallback(
    (event: React.MouseEvent<HTMLLIElement, MouseEvent>) => {
      event.stopPropagation()
      console.log('clicked')
    },
    [],
  )

  if (!root) return <></>

  return (
    <ul
      className={classNames(
        'menu bg-default text-content-700',
        isChild &&
          'ml-[0.375rem] border-l-2 border-gray-900/10 pl-2 dark:border-white/5',
      )}
    >
      {root.children &&
        root.children.map((item) => {
          const { id, title, children, icon: Icon } = item
          if (children && children.length > 0)
            return <Directory key={id} item={item} isChild={isChild} />
          return (
            <Item key={id} onClick={onItemClicked} className="ml-6">
              <div className="flex items-center p-1 pl-0">
                {Icon && <Icon />}
                <span className="ml-1 block truncate transition">{title}</span>
              </div>
            </Item>
          )
        })}
    </ul>
  )
}

export default Tree
