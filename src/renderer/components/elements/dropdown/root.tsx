import { HTMLAttributes, forwardRef } from 'react'

type DropdownRootProps = HTMLAttributes<HTMLDivElement>

const Root = forwardRef<HTMLDivElement, DropdownRootProps>((props, ref) => (
	<div ref={ref} className='relative h-14' {...props} />
))

Root.displayName = 'DropdownRoot'

export default Root
