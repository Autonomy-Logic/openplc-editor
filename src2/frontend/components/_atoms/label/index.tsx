import { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../../utils/cn'

type LabelProps = ComponentPropsWithoutRef<'label'>

const Label = (props: LabelProps) => {
  const { className, children, ...res } = props
  return (
    <label className={cn('text-sm text-white', className)} {...res}>
      {children}
    </label>
  )
}
export { Label }

export type { LabelProps }
