import { cn } from '../../../../utils/cn'
import { CustomHandle } from './handle'
import { DEFAULT_PARALLEL_HEIGHT, DEFAULT_PARALLEL_WIDTH } from './utils/constants'
import type { ParallelProps } from './utils/types'

export const Parallel = ({ selected, data }: ParallelProps) => {
  return (
    <>
      <div
        className={cn('hover:ring-2 hover:ring-brand', {
          'ring-2 ring-brand': selected,
        })}
        style={{
          width: DEFAULT_PARALLEL_WIDTH,
          height: DEFAULT_PARALLEL_HEIGHT,
        }}
      >
        <svg
          style={{
            width: DEFAULT_PARALLEL_WIDTH,
            height: DEFAULT_PARALLEL_HEIGHT,
          }}
        >
          <rect
            width={DEFAULT_PARALLEL_WIDTH}
            height={DEFAULT_PARALLEL_HEIGHT}
            className='stroke-[--xy-edge-stroke-default]'
            fill='none'
          />
        </svg>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}
