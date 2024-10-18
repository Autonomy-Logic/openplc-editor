import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type LabelProps = ComponentPropsWithoutRef<'label'> & {
  label?: string | undefined
}
const Label = (props: LabelProps) => {
  const { label, className, ...res } = props
  return (
    <span className={cn('text-white', className)} {...res}>
      {label}
    </span>
  )
}
export { Label }
