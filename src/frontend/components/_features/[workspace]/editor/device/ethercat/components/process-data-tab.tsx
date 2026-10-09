/**
 * DOPE-704 E3 UI — Process Data view with Simple / Expert modes.
 *
 * Simple mode shows the slave's RxPDOs and TxPDOs as the ESI declares them: each row
 * is the PDO's index, name, direction, SM, and badges for Fixed / Mandatory. The
 * "Assigned" column renders the current assignment state and is read-only (the user
 * cannot change what the ESI fixes). This is the view the operator sees on a slave
 * whose ESI does not advertise `PdoAssign` — the generator refuses to emit
 * 0x1C12 / 0x1C13 against it anyway (E3 gate in buildPdoAssignmentSdos).
 *
 * Expert mode, available only when the slave's `coeFlags.pdoAssign` is true, lets the
 * operator mark non-Fixed PDOs as assigned or unassigned. A PDO marked `fixed` or
 * `mandatory` stays locked. When a PDO is assigned and its `exclude` list names another
 * assigned PDO, that other PDO is tagged with an "excluded" badge so the user sees the
 * conflict (the generator sorts PDO indices to the on-wire list; a mutually-exclusive
 * pair is a soft error the operator decides).
 *
 * The expert toggle is co-located with the mode selector so the surface stays discoverable:
 * when `coeFlags.pdoAssign` is false the Expert chip renders disabled with a tooltip
 * explaining why.
 */

import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { cn } from '@root/frontend/utils/cn'
import type { ConfiguredEtherCATDevice, PersistedPdo } from '@root/middleware/shared/ports/esi-types'
import { useMemo, useState } from 'react'

type ProcessDataTabProps = {
  device: ConfiguredEtherCATDevice
  onUpdatePdoAssigned: (direction: 'rx' | 'tx', pdoIndex: string, assigned: boolean) => void
}

type ViewMode = 'simple' | 'expert'

const Badge = ({ tone, children }: { tone: 'blue' | 'amber' | 'red' | 'neutral'; children: React.ReactNode }) => {
  const toneClasses: Record<typeof tone, string> = {
    blue: 'bg-brand/10 text-brand dark:bg-brand/20',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    neutral: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300',
  }
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', toneClasses[tone])}>{children}</span>
}

const PdoRow = ({
  pdo,
  direction,
  mode,
  pdoAssignAvailable,
  excludedBy,
  onToggle,
}: {
  pdo: PersistedPdo
  direction: 'rx' | 'tx'
  mode: ViewMode
  pdoAssignAvailable: boolean
  excludedBy?: string
  onToggle: (next: boolean) => void
}) => {
  const assigned = pdo.assigned !== false
  const locked = pdo.fixed === true || pdo.mandatory === true
  const canEdit = mode === 'expert' && pdoAssignAvailable && !locked
  const sm = pdo.sm !== undefined ? `SM${pdo.sm}` : '—'
  return (
    <tr className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'>
      <td className='px-2 py-1.5 font-mono text-xs text-neutral-700 dark:text-neutral-300'>{pdo.index}</td>
      <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{pdo.name}</td>
      <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>{direction.toUpperCase()}</td>
      <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>{sm}</td>
      <td className='px-2 py-1.5'>
        <div className='flex flex-wrap items-center gap-1'>
          {pdo.fixed === true && <Badge tone='blue'>Fixed</Badge>}
          {pdo.mandatory === true && <Badge tone='amber'>Mandatory</Badge>}
          {excludedBy !== undefined && <Badge tone='red'>Excluded by {excludedBy}</Badge>}
        </div>
      </td>
      <td className='px-2 py-1.5 text-center'>
        <Checkbox
          checked={assigned}
          disabled={!canEdit}
          onCheckedChange={(checked) => onToggle(checked === true)}
          aria-label={`${pdo.name} assigned`}
        />
      </td>
    </tr>
  )
}

const Section = ({
  title,
  pdos,
  direction,
  mode,
  pdoAssignAvailable,
  onToggle,
}: {
  title: string
  pdos: PersistedPdo[]
  direction: 'rx' | 'tx'
  mode: ViewMode
  pdoAssignAvailable: boolean
  onToggle: (pdoIndex: string, next: boolean) => void
}) => {
  // Build the exclude map: for each assigned PDO, project its exclude list onto the
  // other PDOs so each row knows if an assigned PDO excludes it.
  const excludeMap = useMemo(() => {
    const m = new Map<string, string>()
    const assignedList = pdos.filter((p) => p.assigned !== false)
    for (const a of assignedList) {
      for (const otherIdx of a.exclude ?? []) {
        const target = pdos.find((p) => p.index.toLowerCase() === otherIdx.toLowerCase())
        if (target !== undefined && target.assigned !== false && target.index !== a.index) {
          m.set(target.index.toLowerCase(), a.index)
        }
      }
    }
    return m
  }, [pdos])

  if (pdos.length === 0) {
    return (
      <div>
        <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>{title}</h6>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          No {direction.toUpperCase()}PDOs on this slave.
        </p>
      </div>
    )
  }

  const sorted = [...pdos].sort((a, b) => a.index.localeCompare(b.index))
  return (
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>{title}</h6>
      <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full'>
          <thead className='bg-neutral-50 text-left dark:bg-neutral-900'>
            <tr>
              <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Index</th>
              <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Name</th>
              <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Dir</th>
              <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>SM</th>
              <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Flags</th>
              <th className='px-2 py-1.5 text-center text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                Assigned
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pdo) => (
              <PdoRow
                key={pdo.index}
                pdo={pdo}
                direction={direction}
                mode={mode}
                pdoAssignAvailable={pdoAssignAvailable}
                excludedBy={excludeMap.get(pdo.index.toLowerCase())}
                onToggle={(next) => onToggle(pdo.index, next)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const ProcessDataTab = ({ device, onUpdatePdoAssigned }: ProcessDataTabProps) => {
  const pdoAssignAvailable = device.config.coeFlags?.pdoAssign === true
  const [mode, setMode] = useState<ViewMode>('simple')

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h5 className='text-sm font-semibold text-neutral-800 dark:text-neutral-200'>Process Data</h5>
          <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
            The PDOs this slave exchanges on the bus, grouped by direction. Simple view shows the ESI defaults. Expert
            view lets you reassign PDOs when the slave advertises <code className='font-mono'>PdoAssign</code> in its
            CoE flags.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => setMode('simple')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              mode === 'simple'
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
            )}
          >
            Simple
          </button>
          <button
            type='button'
            onClick={() => setMode('expert')}
            disabled={!pdoAssignAvailable}
            title={
              pdoAssignAvailable
                ? 'Expert view — reassign PDOs when the slave supports it.'
                : 'Expert view requires PdoAssign in the slave’s CoE flags (Configuration tab).'
            }
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              mode === 'expert'
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
              !pdoAssignAvailable && 'cursor-not-allowed opacity-50',
            )}
          >
            Expert
          </button>
        </div>
      </div>

      <Section
        title='RxPDOs — outputs to the slave'
        pdos={device.rxPdos ?? []}
        direction='rx'
        mode={mode}
        pdoAssignAvailable={pdoAssignAvailable}
        onToggle={(idx, next) => onUpdatePdoAssigned('rx', idx, next)}
      />
      <Section
        title='TxPDOs — inputs from the slave'
        pdos={device.txPdos ?? []}
        direction='tx'
        mode={mode}
        pdoAssignAvailable={pdoAssignAvailable}
        onToggle={(idx, next) => onUpdatePdoAssigned('tx', idx, next)}
      />
    </div>
  )
}
