import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type LabelProps = ComponentPropsWithoutRef<'label'> & {
  label?: string | undefined
}
const Label = (props: LabelProps) => {
  const { label, className, ...res } = props
  return (
    <label className={cn('text-white', className)} {...res}>
      {label}
    </label>
  )
}
export { Label }
