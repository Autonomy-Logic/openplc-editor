import { cn } from '@root/frontend/utils/cn'
import type { EtherCATMasterStatus } from '@root/types/ethercat'

type EthercatStatsSectionProps = {
  masters: EtherCATMasterStatus[]
  /**
   * Outer wrapper className. Defaults to 'flex flex-col gap-4'. Pass a full
   * replacement when call sites need a different layout (e.g. board.tsx adds
   * w-full).
   */
  className?: string
  /**
   * Replacement className for the cards grid. Defaults to a 2/3/4-column
   * responsive grid that matches the board.tsx layout.
   */
  cardsClassName?: string
  /**
   * When true, sets each per-master wrapper's id to the computed sectionId so
   * Table-of-Contents anchors / scroll-to-id work. Used by board.tsx; the
   * orchestrators list does not need it.
   */
  withSectionId?: boolean
}

const DEFAULT_SECTION_CLASSNAME = 'flex flex-col gap-4'
const DEFAULT_CARDS_CLASSNAME = 'grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'

// Bus names are runtime-supplied and may carry spaces / special chars.
const slugifyBusName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const cardClassName =
  'flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'
const cardLabelClassName = 'text-xs text-neutral-500 dark:text-neutral-400'
const cardValueClassName = 'text-lg font-semibold text-neutral-900 dark:text-white'

const EthercatStatsSection = ({
  masters,
  className,
  cardsClassName,
  withSectionId = false,
}: EthercatStatsSectionProps) => {
  return (
    <>
      {masters.map((master, idx) => {
        // Project supports more than one EtherCAT bus per device; surface
        // the bus name in the section header so users can tell which set
        // of stats they're looking at. Fall back to a positional label
        // for the single-master legacy response shape (no `name`).
        const busLabel = master.name || `Bus ${idx + 1}`
        // idx in the id keeps it unique when two buses share a name.
        const slug = master.name ? slugifyBusName(master.name) : ''
        const sectionId = slug ? `ethercat-stats-${slug}-${idx}` : `ethercat-stats-${idx}`
        return (
          <div
            key={sectionId}
            id={withSectionId ? sectionId : undefined}
            className={cn(className ?? DEFAULT_SECTION_CLASSNAME)}
          >
            <h2 id={`${sectionId}-title`} className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
              EtherCAT Statistics{' '}
              <span className='font-normal text-neutral-500 dark:text-neutral-400'>— {busLabel}</span>
            </h2>
            <div id={`${sectionId}-cards`} className={cn(cardsClassName ?? DEFAULT_CARDS_CLASSNAME)}>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>Master State</span>
                <span className={cardValueClassName}>{master.plugin_state}</span>
              </div>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>Slave Count</span>
                <span className={cardValueClassName}>{master.slave_count}</span>
              </div>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>Cycle Count</span>
                <span className={cardValueClassName}>{master.metrics.cycle_count.toLocaleString()}</span>
              </div>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>WKC Errors</span>
                <span className={cardValueClassName}>{master.metrics.wkc_error_count.toLocaleString()}</span>
                {master.metrics.consecutive_wkc_errors > 0 && (
                  <span className={cardLabelClassName}>consecutive: {master.metrics.consecutive_wkc_errors}</span>
                )}
              </div>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>Cycle Time (avg)</span>
                <span className={cardValueClassName}>
                  {master.metrics.avg_cycle_us} <span className='text-sm font-normal'>us</span>
                </span>
                <span className={cardLabelClassName}>max: {master.metrics.max_cycle_us} us</span>
              </div>
              <div className={cardClassName}>
                <span className={cardLabelClassName}>Max Exchange Time</span>
                <span className={cardValueClassName}>
                  {master.metrics.max_exchange_us} <span className='text-sm font-normal'>us</span>
                </span>
              </div>
              {master.metrics.recovery_attempts > 0 && (
                <div className={cardClassName}>
                  <span className={cardLabelClassName}>Recovery Attempts</span>
                  <span className={cardValueClassName}>{master.metrics.recovery_attempts}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

export { EthercatStatsSection }
