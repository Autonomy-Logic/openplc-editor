import { cn } from '@utils/cn'
import { HTMLAttributes } from 'react'

type FolderRootProps = HTMLAttributes<HTMLDivElement>
// {
//   size?: 'sm' | 'md' | 'lg';
// };

export default function Root({ ...props }: FolderRootProps) {
  const defaultStyle = 'flex relative w-[224px] h-[160px]'
  const { className } = props
  return <div title='file-root' id='folder-root' {...props} className={cn(defaultStyle, className)} />
}
