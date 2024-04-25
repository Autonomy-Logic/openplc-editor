import { HTMLAttributes } from 'react'

type MenuDividerProps = HTMLAttributes<HTMLHRElement> & Record<string, never>

export default function Divider({ ...props }: MenuDividerProps) {
  return <hr className='my-4 w-48 stroke-neutral-200 stroke-[1.5px]' {...props} />
}
