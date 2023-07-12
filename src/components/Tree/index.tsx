import { FC, useCallback } from 'react'
import { IconType } from 'react-icons'

import { classNames } from '@/utils'

import { Directory } from './Directory'
import Item from './Item'

export type RootProps = {
  id: string | number
  title: string
  icon?: IconType
  onClick?: () => void
  isOpen?: boolean
  children?: RootProps[]
}

export type TreeProps = {
  root?: RootProps
  isChild?: boolean
}

const Tree: FC<TreeProps> = ({ root, isChild = false }) => {
  const onItemClicked = useCallback(
    (
      event: React.MouseEvent<HTMLLIElement, MouseEvent>,
      callback?: () => void,
    ) => {
      event.stopPropagation()
      callback && callback()
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
        root.children.map((item, index) => {
          const { id, title, children, icon: Icon, onClick } = item
          if (children && children.length > 0)
            return (
              <Directory
                key={id}
                item={item}
                isMainDirectory={index === 0 && !isChild}
                isChild={isChild}
              />
            )
          return (
            <Item
              key={id}
              onClick={(event) => onItemClicked(event, onClick)}
              className={classNames(
                'ml-14 max-w-fit',
                onClick ? 'cursor-pointer' : 'cursor-text',
              )}
            >
              <div className="flex items-center p-1 pl-0">
                {Icon && <Icon />}
                <span
                  className={classNames(
                    !!Icon && 'ml-1',
                    'block truncate text-sm font-semibold text-gray-600 transition dark:text-gray-400',
                  )}
                >
                  {title}
                </span>
              </div>
            </Item>
          )
        })}
    </ul>
  )
}

export default Tree
