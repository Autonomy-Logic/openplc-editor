import { CustomHandle } from './handle'
import { DEFAULT_POWER_RAIL_HEIGHT, DEFAULT_POWER_RAIL_WIDTH } from './utils/constants'
import { PowerRailProps } from './utils/types'

export const PowerRail = ({ data, width, height }: PowerRailProps) => {
  const railWidth = width ?? DEFAULT_POWER_RAIL_WIDTH
  const railHeight = height ?? DEFAULT_POWER_RAIL_HEIGHT
  return (
    <>
      <svg width={railWidth} height={railHeight} xmlns='http://www.w3.org/2000/svg'>
        <rect width={railWidth} height={railHeight} className='fill-neutral-500' />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}
