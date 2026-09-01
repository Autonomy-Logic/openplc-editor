import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import {
  DEFAULT_RETAIN_FLUSH_SECONDS,
  RETAIN_MAX_FLUSH_SECONDS,
  RETAIN_MIN_FLUSH_SECONDS,
} from '@root/middleware/shared/ports/types'

/**
 * Persistent Storage — where the device keeps this project's RETAIN variables.
 *
 * A PROJECT screen, not a device one. The settings are part of the project, are
 * editable with no device attached, and travel to the runtime as `retain.conf`
 * inside the program upload — the same route VPP plugin configuration takes.
 * Nothing here reads from or writes to a connected runtime.
 *
 * That is the whole point of the shape: a user configures retention while
 * writing the program, the same way they configure everything else about it,
 * and the setting is reviewable in the project rather than being invisible
 * state on one particular box.
 *
 * The screen appears for targets that use the runtime's built-in file store. A
 * VPP whose own driver handles retention declares
 * `hidesNativeScreens: ['persistent-storage']`, and the editor then removes
 * this screen AND emits no `retain.conf` — which is what makes the runtime
 * delete its copy and the built-in store stand down, leaving the vendor's
 * driver as the only store. So there is no state in which this screen is
 * visible but inert, and none in which two stores are live at once.
 */
const PersistentStorageEditor = () => {
  const settings = useOpenPLCStore((s) => s.deviceDefinitions.configuration.persistentStorage)
  const setPersistentStorage = useOpenPLCStore((s) => s.deviceActions.setPersistentStorage)

  // Absent means "this project does not use persistent storage", which is the
  // same thing the form shows for off — so read through defaults rather than
  // making the caller materialise a record just to render.
  const enabled = settings?.enabled ?? false
  const path = settings?.path ?? ''
  const flushSeconds = settings?.flushSeconds ?? DEFAULT_RETAIN_FLUSH_SECONDS

  const flushOutOfRange = flushSeconds < RETAIN_MIN_FLUSH_SECONDS || flushSeconds > RETAIN_MAX_FLUSH_SECONDS

  return (
    <div className='flex h-full w-full select-none flex-col overflow-auto p-8'>
      <div className='mb-6'>
        <h2 className='text-xl font-semibold text-neutral-1000 dark:text-white'>Persistent Storage</h2>
        <p className='mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400'>
          Where the device keeps the values of <span className='font-medium'>RETAIN</span> variables so they survive a
          restart. With storage off, retained variables start at their initial values every time. These settings are
          saved with the project and applied when you upload it.
        </p>
      </div>

      <div className='flex max-w-2xl flex-col gap-6'>
        <label className='flex items-start gap-3'>
          <input
            type='checkbox'
            checked={enabled}
            onChange={(e) => setPersistentStorage({ enabled: e.target.checked })}
            className='mt-1 h-4 w-4 accent-brand'
            aria-describedby='retain-enabled-help'
          />
          <span>
            <span className='text-sm font-medium text-neutral-1000 dark:text-white'>
              Keep retained variables on the device
            </span>
            <span id='retain-enabled-help' className='mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400'>
              Off by default. Turning it on makes the runtime write to the storage below at the interval you choose.
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
            placeholder='Leave empty to use the runtime default'
            onChange={(e) => setPersistentStorage({ path: e.target.value })}
            className='h-9 rounded-md border border-neutral-300 px-3 font-mono text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
          />
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>
            An absolute path on the device. Leave it empty and the runtime uses its own default location — the editor
            does not need to know the device&apos;s filesystem layout.
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
              min={RETAIN_MIN_FLUSH_SECONDS}
              max={RETAIN_MAX_FLUSH_SECONDS}
              value={flushSeconds}
              disabled={!enabled}
              onChange={(e) => setPersistentStorage({ flushSeconds: Number(e.target.value) })}
              className={cn(
                'h-9 w-28 rounded-md border px-3 text-sm disabled:opacity-50 dark:bg-neutral-900 dark:text-white',
                flushOutOfRange ? 'border-red-500 dark:border-red-500' : 'border-neutral-300 dark:border-neutral-700',
              )}
              aria-invalid={flushOutOfRange}
              aria-describedby='retain-flush-help'
            />
            <span className='text-sm text-neutral-600 dark:text-neutral-400'>seconds</span>
          </div>
          {flushOutOfRange && (
            <p className='text-xs text-red-600 dark:text-red-400' role='alert'>
              Use a whole number between {RETAIN_MIN_FLUSH_SECONDS} and {RETAIN_MAX_FLUSH_SECONDS} seconds. The runtime
              refuses anything outside that range when the project is uploaded.
            </p>
          )}
          <p id='retain-flush-help' className='text-xs text-neutral-500 dark:text-neutral-400'>
            How much recent change a power cut can cost. Saving more often keeps less at risk and works the storage
            harder — on an SD card or flash, that shortens its life.
          </p>
        </div>
      </div>
    </div>
  )
}

export { PersistentStorageEditor }
