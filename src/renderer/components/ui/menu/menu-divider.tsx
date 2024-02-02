/* eslint-disable react/jsx-props-no-spreading */
import { HTMLAttributes } from 'react'

type MenuDividerProps = HTMLAttributes<HTMLHRElement> & Record<string, never>

export default function Divider({ ...props }: MenuDividerProps) {
	return (
		<hr className='stroke-neutral-200 stroke-[1.5px] w-48 my-4' {...props} />
	)
}
