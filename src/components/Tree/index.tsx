import { FC, useCallback } from 'react'
import { IconType } from 'react-icons'

import { Directory } from './Directory'
import Item from './Item'

export type RootProps = {
  title: string
  icon?: IconType
  children?: RootProps[]
}

export type TreeProps = {
  root?: RootProps
}

const Tree: FC<TreeProps> = ({ root }) => {
  return <></>
}

export default Tree
