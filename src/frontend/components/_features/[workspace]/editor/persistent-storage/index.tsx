import { RefreshIcon } from '@root/frontend/assets/icons/interface/Refresh'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/frontend/store'
import type { RetainConfig } from '@root/middleware/shared/ports/runtime-port'
import { useRuntime } from '@root/middleware/shared/providers'
import { useCallback, useEffect, useState } from 'react'

/**
 * Persistent Storage — where this device keeps its RETAIN variables.
 *
 * A device-scoped screen, like User Management: it reads and writes settings
 * that live on the runtime, not in the project. Two people opening the same
 * project against different devices are configuring different things.
 *
 * The screen configures the runtime's BUILT-IN file store. A VPP driver can
 * provide its own retain backend — FRAM, battery-backed SRAM — and when one
 * does it overrides the file store entirely. That is why the runtime reports
 * the live backend separately from the settings, and why this screen says so
 * rather than showing "enabled" over a file that will never be written.
 */
const PersistentStorageEditor = () => {
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus)

  const [config, setConfig] = useState<RetainConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Draft state, so a half-typed path is never sent and Cancel is meaningful.
  const [enabled, setEnabled] = useState(false)
  const [path, setPath] = useState('')
  const [flushSeconds, setFlushSeconds] = useState('5')

  const applyConfig = useCallback((next: RetainConfig) => {
    setConfig(next)
    setEnabled(next.enabled)
    setPath(next.path)
    setFlushSeconds(String(next.flushSeconds))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await runtime.getRetainConfig()
    if (!result.success || !result.config) {
      setLoadError(result.error || 'Could not read the persistent storage settings.')
      setConfig(null)
    } else {
      applyConfig(result.config)
    }
    setLoading(false)
  }, [runtime, applyConfig])

  useEffect(() => {
    if (connectionStatus === 'connected') void refresh()
  }, [connectionStatus, refresh])

  const dirty =
    config !== null &&
    (enabled !== config.enabled || path !== config.path || flushSeconds !== String(config.flushSeconds))

  const handleSave = async () => {
    if (!config) return
    const seconds = Number(flushSeconds)
    if (!Number.isInteger(seconds) || seconds < config.minFlushSeconds || seconds > config.maxFlushSeconds) {
      toast({
        title: 'Check the save interval',
        description: `It must be a whole number between ${config.minFlushSeconds} and ${config.maxFlushSeconds} seconds.`,
        variant: 'fail',
      })
      return
    }

    setSaving(true)
    const result = await runtime.updateRetainConfig({ enabled, path: path.trim(), flushSeconds: seconds })
    setSaving(false)

    if (!result.success || !result.config) {
      // The runtime is the authority on what it can honour — a path whose
      // directory does not exist, for instance — so its message is shown as
      // written rather than replaced with something vaguer.
      toast({
        title: 'Could not save',
        description: result.error || 'The runtime refused the settings.',
        variant: 'fail',
      })
      return
    }

    applyConfig(result.config)
    toast({
      title: 'Settings saved',
      description: 'They take effect the next time the PLC starts.',
      variant: 'default',
    })
  }

  if (connectionStatus !== 'connected') {
    return (
      <div className='flex h-full w-full select-none flex-col items-center justify-center gap-2 p-8 text-center'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-white'>Persistent Storage</h2>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          You are not connected to a runtime. Connect to the device to configure where it keeps retained
          variables.
        </p>
      </div>
    )
  }

  const vppProvidesStorage = config?.backend === 'plugin'

  return (
    <div className='flex h-full w-full select-none flex-col overflow-auto p-8'>
      <div className='mb-6 flex items-start justify-between'>
        <div>
          <h2 className='text-xl font-semibold text-neutral-1000 dark:text-white'>Persistent Storage</h2>
          <p className='mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400'>
            Where this device keeps the values of <span className='font-medium'>RETAIN</span> variables so they
            survive a restart. With storage off, retained variables start at their initial values every time.
          </p>
        </div>
        <button
          type='button'
          onClick={() => void refresh()}
          title='Refresh'
          className='flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-850'
        >
          <RefreshIcon className='h-4 w-4' />
        </button>
      </div>

      {loading && <p className='text-sm text-neutral-500 dark:text-neutral-400'>Loading…</p>}

      {!loading && loadError && (
        <p className='text-sm text-red-600 dark:text-red-400' role='alert'>
          {loadError}
        </p>
      )}

      {!loading && config && (
        <div className='flex max-w-2xl flex-col gap-6'>
          {/* A VPP driver overriding the built-in store is the one thing that
              makes every setting below inert, so it is said first and plainly
              rather than left for the operator to deduce from an unchanging
              file. */}
          {vppProvidesStorage && (
            <div
              className='rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200'
              role='status'
            >
              This device stores retained variables through its hardware driver
              {config.backendDetail ? ` (${config.backendDetail})` : ''}, which takes precedence over the
              settings below. They are saved, but not in use.
            </div>
          )}

          <label className='flex items-start gap-3'>
            <input
              type='checkbox'
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className='mt-1 h-4 w-4 accent-brand'
              aria-describedby='retain-enabled-help'
            />
            <span>
              <span className='text-sm font-medium text-neutral-1000 dark:text-white'>
                Keep retained variables on this device
              </span>
              <span
                id='retain-enabled-help'
                className='mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400'
              >
                Off by default. Turning it on makes the runtime write to the storage below at the interval you
                choose.
              </span>
            </span>
          </label>

          <div className='flex flex-col gap-1.5'>
            <label htmlFor='retain-path' className='text-sm font-medium text-neutral-1000 dark:text-white'>
              File location
            </label>
            <input
              id='retain-path'
              type='text'
              value={path}
              disabled={!enabled}
              spellCheck={false}
              onChange={(e) => setPath(e.target.value)}
              className='h-9 rounded-md border border-neutral-300 px-3 font-mono text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
            />
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              An absolute path on the device. Default: <span className='font-mono'>{config.defaultPath}</span>
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <label htmlFor='retain-flush' className='text-sm font-medium text-neutral-1000 dark:text-white'>
              Save every
            </label>
            <div className='flex items-center gap-2'>
              <input
                id='retain-flush'
                type='number'
                min={config.minFlushSeconds}
                max={config.maxFlushSeconds}
                value={flushSeconds}
                disabled={!enabled}
                onChange={(e) => setFlushSeconds(e.target.value)}
                className='h-9 w-28 rounded-md border border-neutral-300 px-3 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
              />
              <span className='text-sm text-neutral-600 dark:text-neutral-400'>seconds</span>
            </div>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              How much recent change a power cut can cost. Saving more often keeps less at risk and works the
              storage harder — on an SD card or flash, that shortens its life.
            </p>
          </div>

          <div className='flex items-center gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800'>
            <button
              type='button'
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
              className='h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type='button'
              disabled={!dirty || saving}
              onClick={() => applyConfig(config)}
              className='h-9 rounded-md border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-850'
            >
              Cancel
            </button>
            {dirty && (
              <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                Changes take effect the next time the PLC starts.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export { PersistentStorageEditor }
export default PersistentStorageEditor
