import { StatsTable, type StatsTableColumn } from '@root/frontend/components/_molecules/stats-table'
import type { PluginStatsField, PluginStatsPayload, TimingStats } from '@root/middleware/shared/ports/types'

interface PluginStatsPanelProps {
  /** Optional opaque plugin-contributed stats from the runtime. Each
   *  entry is rendered as its own labelled stats table. Renders nothing
   *  when undefined or empty. */
  pluginStats: TimingStats['plugin_stats']
}

const renderField = (field: PluginStatsField) => {
  const display = typeof field.value === 'boolean' ? (field.value ? 'Yes' : 'No') : field.value
  return (
    <span className='inline-flex items-baseline justify-center gap-1'>
      <span className='font-semibold text-neutral-900 dark:text-white'>{display}</span>
      {field.unit && <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>{field.unit}</span>}
    </span>
  )
}

/**
 * Plugin-contributed statistics panel.
 *
 * The runtime's `STATS` response can carry an opaque
 * `plugin_stats: Record<pluginName, { label, fields }>` map populated by
 * any plugin that exports `get_stats`. The editor doesn't know what the
 * fields semantically represent — it just renders them under each
 * plugin's label so users see the metrics the plugin author intends to
 * surface.
 *
 * Each plugin renders as a single-row StatsTable: one column per declared
 * field, the row carries the values. This keeps every stats section on
 * the device-config screen visually uniform with scan-cycle / EtherCAT
 * (same table chrome, same monospaced metric font, same `min/max` layout
 * when a plugin opts into RangeCell). Used both on the device-board
 * screen (Electron) and the orchestrators screen (web) so VPP packages
 * contribute identical telemetry regardless of how the user navigated to
 * the device.
 */
export const PluginStatsPanel = ({ pluginStats }: PluginStatsPanelProps) => {
  if (!pluginStats || Object.keys(pluginStats).length === 0) return null

  return (
    <>
      {Object.entries(pluginStats).map(([pluginName, payload]) => {
        // Build one column per field. The row IS the payload itself —
        // each column's render() pulls the i-th field from it. We close
        // over the index so adding/removing fields between polls
        // re-derives the columns array correctly.
        const columns: StatsTableColumn<PluginStatsPayload>[] = payload.fields.map((field, idx) => ({
          key: `${pluginName}-${idx}`,
          header: field.label,
          render: (p) => renderField(p.fields[idx]),
        }))

        return (
          <StatsTable
            key={pluginName}
            context={`plugin-stats-${pluginName}`}
            title={payload.label}
            columns={columns}
            rows={[payload]}
            rowKey={() => pluginName}
          />
        )
      })}
    </>
  )
}
