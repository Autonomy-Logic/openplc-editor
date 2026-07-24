import { memo } from 'react'

import { PlaceholderNodeFilled } from '../../../../assets/icons/flow/Placeholder'
import { cn } from '../../../../utils/cn'
import { CustomHandle } from './handle'
import { DEFAULT_PLACEHOLDER_HEIGHT, DEFAULT_PLACEHOLDER_WIDTH } from './utils/constants'
import { PlaceholderProps } from './utils/types'

const Placeholder = ({ selected, data }: PlaceholderProps) => {
  return (
    <>
      <PlaceholderNodeFilled
        className={cn({ 'fill-brand': selected })}
        width={DEFAULT_PLACEHOLDER_WIDTH}
        height={DEFAULT_PLACEHOLDER_HEIGHT}
      />
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const exportPlaceholder = memo(Placeholder)

export { exportPlaceholder as Placeholder }
