import { ComponentPropsWithoutRef } from 'react'

export const DividerActivityBar = (props: ComponentPropsWithoutRef<'hr'>) => {
  return <hr className='w-1/2 stroke-neutral-850 stroke-[1.5px]' {...props} />
}
