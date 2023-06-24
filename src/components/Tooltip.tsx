import { FC, PropsWithChildren } from 'react'

import { classNames } from '@/utils'

export type TooltipProps = {
  label?: string
  position?: 'start' | 'center' | 'end'
}

const Tooltip: FC<PropsWithChildren<TooltipProps>> = ({
  children,
  label,
  position = 'center',
}) => {
  if (!label) return <>{children}</>
  return (
    <div
      className={classNames(
        `flex items-center justify-${position}`,
        !!label && 'has-tooltip',
      )}
    >
      <span className="tooltip mt-16 inline-block whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-500 shadow transition-opacity duration-300 dark:bg-gray-900 dark:text-gray-400">
        {label}
      </span>
      {children}
    </div>
  )
}

export default Tooltip
