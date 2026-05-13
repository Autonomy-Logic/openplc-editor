import { formatNumber, formatRange } from './format-helpers'

interface RangeCellProps {
  avg: number | null | undefined
  min: number | null | undefined
  max: number | null | undefined
}

/**
 * Avg-with-min/max-below cell. Used in every stats table that shows a
 * moving average alongside the observed extremes (scan-cycle, EtherCAT,
 * any future timing plugin). The two-line layout keeps the average
 * scannable while the min/max range stays a glance away.
 */
export const RangeCell = ({ avg, min, max }: RangeCellProps) => (
  <div className='flex flex-col items-center justify-center leading-tight'>
    <span className='text-neutral-900 dark:text-white'>{formatNumber(avg)}</span>
    <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>{formatRange(min, max)}</span>
  </div>
)
