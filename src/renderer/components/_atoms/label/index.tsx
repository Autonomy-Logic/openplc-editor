import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type LabelProps = ComponentPropsWithoutRef<'label'> & {
  label: string
}
const Label = (props: LabelProps) => {
  const { label, className, ...res } = props
  return (
    <span className={cn('text-neutral-1000', className)} {...res}>
      {label}
    </span>
  )
}
export { Label }
