/**
 * Verify Target tab — which toolchain the library is checked with.
 *
 * Dual-card transfer shape, matching the Library Manager's Project Libraries
 * tab: the toolchain on the left, the core it compiles for on the right. A
 * summary above both states the setting in a sentence, because the whole
 * point of the screen is to show what `library.json` currently says.
 */

import { openPackageManagerTab } from '@root/frontend/services/open-package-manager-tab'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type { LibraryVerifyTarget } from '@root/middleware/shared/ports/library-build-port'
import { useCapabilities } from '@root/middleware/shared/providers'
import { pickVerifyBoard } from '@root/middleware/shared/utils/library/pick-verify-board'
import { useMemo, useState } from 'react'

import { MagnifierIcon } from '../../../../../assets/icons/interface/Magnifier'

/** Board the build falls back on when an Arduino target names no core, or
 *  names one with no board installed. Bundled, so it is always there. */
const SIMULATOR_BOARD = 'OpenPLC Simulator'
const SIMULATOR_CORE = 'arduino:avr'

type VerifyTargetTabProps = {
  target: LibraryVerifyTarget
  onChange: (target: LibraryVerifyTarget) => void
  /** Set when `library.json` cannot be read; every control is disabled and
   *  the message replaces the summary. */
  manifestError: string | null
}

type ModeOption = {
  mode: LibraryVerifyTarget['mode']
  label: string
  description: string
}

/**
 * Arduino is first and is the default. A library's blocks reach the Arduino
 * core through `Arduino.h`, `Serial`, `WiFi` and the rest, and only this mode
 * compiles them — the runtime builds its own upload, so nothing in the editor
 * would compile the C++ for it.
 */
const MODE_OPTIONS: ModeOption[] = [
  {
    mode: 'arduino',
    label: 'Arduino core',
    description: 'Compiles the blocks and the resources with the Arduino toolchain.',
  },
  {
    mode: 'runtime',
    label: 'OpenPLC Runtime',
    description: 'Checks the Structured Text and the runtime bundle. The runtime compiles the C++ itself.',
  },
  {
    mode: 'off',
    label: 'Do not verify',
    description: 'Build the .stlib without checking it.',
  },
]

const VerifyTargetTab = ({ target, onChange, manifestError }: VerifyTargetTabProps) => {
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const hasPackageManager = useCapabilities().hasPackageManager
  const [coreFilter, setCoreFilter] = useState('')

  /**
   * Installed cores, grouped by the vendor whose package supplies them, with
   * the boards carrying each. Runtime targets declare no core and are covered
   * by the OpenPLC Runtime mode instead.
   */
  const groupedCores = useMemo(() => {
    const BUILT_IN_VENDOR = 'OpenPLC'
    const byVendor = new Map<string, Map<string, number>>()
    for (const [, data] of availableBoards.entries()) {
      if (!data.core || data.compiler === 'openplc-compiler') continue
      const vendor = data.vpp?.vendor ?? BUILT_IN_VENDOR
      const cores = byVendor.get(vendor) ?? new Map<string, number>()
      cores.set(data.core, (cores.get(data.core) ?? 0) + 1)
      byVendor.set(vendor, cores)
    }

    const builtIn = byVendor.get(BUILT_IN_VENDOR)
    byVendor.delete(BUILT_IN_VENDOR)
    const toList = (cores: Map<string, number>) =>
      [...cores.entries()].map(([core, boards]) => ({ core, boards })).sort((a, b) => a.core.localeCompare(b.core))
    const ordered: Array<{ vendor: string; cores: Array<{ core: string; boards: number }> }> = []
    if (builtIn) ordered.push({ vendor: BUILT_IN_VENDOR, cores: toList(builtIn) })
    for (const vendor of [...byVendor.keys()].sort((a, b) => a.localeCompare(b))) {
      ordered.push({ vendor, cores: toList(byVendor.get(vendor) as Map<string, number>) })
    }
    return ordered
  }, [availableBoards])

  const filteredCores = useMemo(() => {
    const needle = coreFilter.trim().toLowerCase()
    if (!needle) return groupedCores
    return groupedCores
      .map(({ vendor, cores }) => ({
        vendor,
        cores: vendor.toLowerCase().includes(needle)
          ? cores
          : cores.filter(({ core }) => core.toLowerCase().includes(needle)),
      }))
      .filter(({ cores }) => cores.length > 0)
  }, [groupedCores, coreFilter])

  /** The core recorded in the manifest is not necessarily installed. Say so
   *  rather than dropping it — the build warns and falls back, it does not
   *  rewrite the manifest. */
  const coreIsInstalled = useMemo(
    () => (target.core ? groupedCores.some(({ cores }) => cores.some(({ core }) => core === target.core)) : true),
    [groupedCores, target.core],
  )

  /** The board that will stand in for the chosen core, by the same rule the
   *  build uses. Named here so the choice is not first seen in a build log. */
  const standInBoard = useMemo(() => {
    if (target.mode !== 'arduino') return null
    if (!target.core) return SIMULATOR_BOARD
    return (
      pickVerifyBoard(
        [...availableBoards.entries()].map(([name, info]) => ({ name, core: info.core, compiler: info.compiler })),
        target.core,
      ) ?? SIMULATOR_BOARD
    )
  }, [availableBoards, target.core, target.mode])

  const isArduino = target.mode === 'arduino'
  /** The core only matters to the Arduino toolchain, so the whole card is off
   *  under the other two modes — and under a manifest we could not read. */
  const coreCardDisabled = Boolean(manifestError) || !isArduino

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-hidden'>
      <Summary manifestError={manifestError} target={target} standInBoard={standInBoard} />

      <div className='flex min-h-0 flex-1 gap-4 overflow-hidden'>
        <Card
          title='Toolchain'
          subtitle='How the library is checked when you build it.'
          disabled={Boolean(manifestError)}
        >
          <ListBody>
            {MODE_OPTIONS.map((option) => (
              <OptionRow
                key={option.mode}
                label={option.label}
                description={option.description}
                selected={target.mode === option.mode}
                disabled={Boolean(manifestError)}
                onSelect={() => onChange({ ...target, mode: option.mode })}
              />
            ))}
          </ListBody>
        </Card>

        <Card
          title='Arduino core'
          subtitle={
            isArduino
              ? 'The core the library is compiled for.'
              : 'Only used by the Arduino core toolchain. Kept for when you switch back.'
          }
          disabled={coreCardDisabled}
        >
          <div className='flex shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900'>
            <MagnifierIcon className='h-4 w-4 shrink-0' />
            <input
              type='text'
              value={coreFilter}
              onChange={(e) => setCoreFilter(e.target.value)}
              disabled={coreCardDisabled}
              placeholder='Search cores…'
              aria-label='Search cores'
              className='w-full bg-transparent font-caption text-xs text-neutral-950 placeholder:text-neutral-400 focus:outline-none disabled:cursor-not-allowed dark:text-white dark:placeholder:text-neutral-500'
            />
          </div>

          <ListBody>
            {/* The simulator is what an Arduino target with no core resolves
                to, so it is offered as a row rather than left implicit. */}
            <OptionRow
              label='Built-in simulator'
              description={`${SIMULATOR_CORE} — the bundled 8-bit target.`}
              selected={isArduino && !target.core}
              disabled={coreCardDisabled}
              onSelect={() => onChange({ mode: target.mode })}
            />

            {!coreIsInstalled && target.core && (
              <OptionRow
                label={target.core}
                description='Named in library.json, but no package supplies it. The build falls back to the simulator.'
                selected
                disabled={coreCardDisabled}
                onSelect={() => undefined}
              />
            )}

            {filteredCores.length === 0 ? (
              <EmptyState>{coreFilter ? `No cores match “${coreFilter}”.` : 'No cores installed.'}</EmptyState>
            ) : (
              filteredCores.map(({ vendor, cores }) => (
                <div key={vendor} className='shrink-0'>
                  <div className='select-none px-2 pb-1 pt-2 font-caption text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                    {vendor}
                  </div>
                  {cores.map(({ core, boards }) => (
                    <OptionRow
                      key={core}
                      label={core}
                      description={`${boards} ${boards === 1 ? 'board' : 'boards'} installed`}
                      selected={isArduino && target.core === core}
                      disabled={coreCardDisabled}
                      onSelect={() => onChange({ ...target, core })}
                    />
                  ))}
                </div>
              ))
            )}
          </ListBody>

          {hasPackageManager && (
            <button
              type='button'
              onClick={openPackageManagerTab}
              disabled={coreCardDisabled}
              className='shrink-0 self-start font-caption text-cp-xs font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:no-underline'
            >
              + Install additional cores…
            </button>
          )}
        </Card>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

/** What `library.json` currently says, in a sentence. */
function Summary({
  manifestError,
  target,
  standInBoard,
}: {
  manifestError: string | null
  target: LibraryVerifyTarget
  standInBoard: string | null
}) {
  if (manifestError) {
    return (
      <div className='shrink-0 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs dark:border-yellow-700 dark:bg-yellow-950/40'>
        <span className='font-medium text-yellow-800 dark:text-yellow-200'>{manifestError}</span>
      </div>
    )
  }

  const sentence =
    target.mode === 'off'
      ? 'This library is not verified. The .stlib is built without checking it.'
      : target.mode === 'runtime'
        ? 'Verified as an OpenPLC Runtime bundle. The Structured Text and the bundle are checked; the runtime compiles the C++ itself.'
        : `Verified with the Arduino toolchain for ${target.core ?? SIMULATOR_CORE}, compiling on ${standInBoard ?? SIMULATOR_BOARD}.`

  return (
    <div className='shrink-0 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'>
      <p className='font-caption text-xs text-neutral-950 dark:text-white'>{sentence}</p>
      <p className='mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400'>
        Stored in library.json. Save the project to keep it.
      </p>
    </div>
  )
}

/** A card whose whole surface dims when the setting it holds does not apply —
 *  heading and search included, so a live-looking control never sits inside a
 *  section that is off. */
function Card({
  title,
  subtitle,
  disabled,
  children,
}: {
  title: string
  subtitle?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      aria-disabled={disabled}
      className={cn(
        'flex min-h-0 w-1/2 min-w-[280px] flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950',
        disabled && 'opacity-50',
      )}
    >
      <div className='shrink-0 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700'>
        <h3 className='select-none font-caption text-sm font-semibold text-neutral-950 dark:text-white'>{title}</h3>
        {subtitle && <p className='mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400'>{subtitle}</p>}
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3'>{children}</div>
    </div>
  )
}

/** Scrolling list body. Rows carry `shrink-0`: a flex column shrinks its
 *  children by default, so a long list collapses each row below its own
 *  height instead of scrolling. */
function ListBody({ children }: { children: React.ReactNode }) {
  return <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>{children}</div>
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-1 items-center justify-center px-3 py-6 text-center text-[11px] italic text-neutral-500 dark:text-neutral-400'>
      {children}
    </div>
  )
}

/**
 * One selectable row. The radio mark carries the selection rather than a
 * background tint alone — a tint at the contrast the rest of the editor uses
 * is not readable enough to answer "which one is set?" at a glance.
 *
 * A disabled row does not dim itself: its card is already dimmed whenever its
 * rows are disabled, and nested opacity multiplies, which would leave the row
 * at a fifth of full contrast rather than half.
 */
function OptionRow({
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  description: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full shrink-0 items-start gap-2 border-b border-neutral-100 px-2 py-2 text-left last:border-b-0 dark:border-neutral-800',
        disabled ? 'cursor-not-allowed' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-brand' : 'border-neutral-300 dark:border-neutral-600',
        )}
      >
        {selected && <span className='h-1.5 w-1.5 rounded-full bg-brand' />}
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span
          className={cn(
            'truncate font-caption text-cp-sm',
            selected
              ? 'font-medium text-brand-medium dark:text-brand-light'
              : 'font-medium text-neutral-950 dark:text-white',
          )}
        >
          {label}
        </span>
        <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>{description}</span>
      </span>
    </button>
  )
}

export { VerifyTargetTab }
