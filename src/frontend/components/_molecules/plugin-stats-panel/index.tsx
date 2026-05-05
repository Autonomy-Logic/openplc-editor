import type { TimingStats } from '@root/middleware/shared/ports/types'

interface PluginStatsPanelProps {
  /** Optional opaque plugin-contributed stats from the runtime. Each entry
   *  is rendered as its own labelled card grid. Renders nothing when
   *  undefined or empty. */
  pluginStats: TimingStats['plugin_stats']
}

/**
 * Plugin-contributed statistics panel.
 *
 * The runtime's `STATS` response can carry an opaque
 * `plugin_stats: Record<pluginName, { label, fields }>` map populated by
 * any plugin that exports `get_stats`. The editor doesn't know what the
 * fields semantically represent — it just renders them grouped under
 * each plugin's label so users see the metrics the plugin author
 * intends to surface.
 *
 * Used both on the device-board screen (Electron) and the orchestrators
 * screen (web) so VPP packages contribute the same telemetry regardless
 * of how the user navigated to the device.
 */
export const PluginStatsPanel = ({ pluginStats }: PluginStatsPanelProps) => {
  if (!pluginStats || Object.keys(pluginStats).length === 0) return null

  return (
    <>
      {Object.entries(pluginStats).map(([pluginName, payload]) => (
        <div key={pluginName} id={`plugin-stats-section-${pluginName}`} className='flex w-full flex-col gap-4'>
          <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>{payload.label}</h2>
          <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'>
            {payload.fields.map((field, idx) => (
              <div
                key={`${pluginName}-${idx}`}
                className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'
              >
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>{field.label}</span>
                <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
                  {typeof field.value === 'boolean' ? (field.value ? 'Yes' : 'No') : field.value}
                  {field.unit && <span className='text-sm font-normal'> {field.unit}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
