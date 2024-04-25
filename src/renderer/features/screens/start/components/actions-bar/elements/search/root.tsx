import { cn } from '@utils/cn'
import { HTMLAttributes, ReactNode } from 'react'

type SearchRootProps = HTMLAttributes<HTMLDivElement>

export default function Root({ className, ...props }: SearchRootProps): ReactNode {
  return <div className={cn(className)} {...props} />
}
