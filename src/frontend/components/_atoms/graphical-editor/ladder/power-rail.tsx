import { CustomHandle } from './handle'
import { DEFAULT_POWER_RAIL_HEIGHT, DEFAULT_POWER_RAIL_WIDTH } from './utils/constants'
import { PowerRailProps } from './utils/types'

export const PowerRail = ({ data }: PowerRailProps) => {
  return (
    <>
      <svg width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} xmlns='http://www.w3.org/2000/svg'>
        <rect width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} className='fill-neutral-500' />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}
