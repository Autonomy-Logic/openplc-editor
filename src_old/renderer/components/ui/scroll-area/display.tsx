import { cn } from '@utils/cn'
import { ForwardedRef, forwardRef, HTMLAttributes } from 'react'

type CustomDisplayProps = HTMLAttributes<HTMLDivElement>

const CustomDisplay = forwardRef(
  ({ className, children, ...props }: CustomDisplayProps, ref: ForwardedRef<HTMLDivElement>) => (
    <div ref={ref} className={cn('grid h-full w-full grid-cols-4 gap-6 rounded-[inherit] pr-5', className)} {...props}>
      {children}
    </div>
  ),
)

CustomDisplay.displayName = 'CustomDisplay'

export { CustomDisplay }
