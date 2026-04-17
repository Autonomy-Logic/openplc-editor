import { HTMLAttributes } from 'react'

import { cn } from '../../../utils/cn'

type FolderRootProps = HTMLAttributes<HTMLDivElement>

export default function Root({ ...props }: FolderRootProps) {
  const defaultStyle = 'flex relative w-[224px] h-[160px]'
  const { className } = props
  return <div aria-label='file-root' id='folder-root' {...props} className={cn(defaultStyle, className)} />
}
