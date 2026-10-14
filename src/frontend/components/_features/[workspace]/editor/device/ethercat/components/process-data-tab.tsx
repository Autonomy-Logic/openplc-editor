/**
 * Process Data view with Simple and Expert modes.
 *
 * Simple:
 *   - Checkbox list of assignable PDOs, locked for Fixed and Mandatory.
 *   - Preset selector driven by the ESI's AlternativeSmMapping entries.
 *   - Excluded PDOs are greyed and un-toggleable with a tooltip naming the excluder.
 *
 * Expert:
 *   - Three CoE-flag toggles (PdoAssign, PdoConfig, CompleteAccess) govern what the
 *     generator emits.
 *   - Per-PDO expansion with an inline entry editor on non-Fixed PDOs: operators can
 *     add, remove, and edit entry index / sub-index / bit length / name.
 */

import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { PencilIcon } from '@root/frontend/assets/icons/interface/Pencil'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { cn } from '@root/frontend/utils/cn'
import type {
  ESIAlternativeSmMapping,
  EtherCATSlaveConfig,
  PersistedPdo,
  PersistedPdoEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useCallback, useMemo, useState } from 'react'

type CoeFlags = NonNullable<EtherCATSlaveConfig['coeFlags']>

type ProcessDataTabProps = {
  rxPdos: PersistedPdo[]
  txPdos: PersistedPdo[]
  pdoAssignAvailable: boolean
  coeFlags?: CoeFlags
  alternativeSmMappings?: ESIAlternativeSmMapping[]
  onUpdatePdoAssigned: (direction: 'rx' | 'tx', pdoIndex: string, assigned: boolean) => void
  onUpdatePdoEntries?: (direction: 'rx' | 'tx', pdoIndex: string, entries: PersistedPdoEntry[]) => void
  onUpdateCoeFlags?: (next: CoeFlags) => void
}

const Badge = ({ tone, children }: { tone: 'blue' | 'amber' | 'red' | 'neutral'; children: React.ReactNode }) => {
  const toneClasses: Record<typeof tone, string> = {
    blue: 'bg-brand/10 text-brand dark:bg-brand/20',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    neutral: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', toneClasses[tone])}>{children}</span>
}

const SimpleRow = ({
  pdo,
  direction,
  editable,
  excludedBy,
  onToggle,
}: {
  pdo: PersistedPdo
  direction: 'rx' | 'tx'
  editable: boolean
  excludedBy?: string
  onToggle: (next: boolean) => void
}) => {
  const assigned = pdo.assigned !== false
  const locked = pdo.fixed === true || pdo.mandatory === true || excludedBy !== undefined
  const canEdit = editable && !locked
  const sm = pdo.sm !== undefined ? `SM${pdo.sm}` : '—'
  return (
    <tr className='border-b border-neutral-200 last:border-b-0 dark:border-neutral-800'>
      <td className='px-2 py-2 font-mono text-xs text-neutral-700 dark:text-neutral-300'>{pdo.index}</td>
      <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{pdo.name}</td>
      <td className='px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400'>{direction.toUpperCase()}</td>
      <td className='px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400'>{sm}</td>
      <td className='px-2 py-2'>
        <div className='flex flex-wrap items-center gap-1'>
          {pdo.fixed === true && <Badge tone='blue'>Fixed</Badge>}
          {pdo.mandatory === true && <Badge tone='amber'>Mandatory</Badge>}
          {excludedBy !== undefined && (
            <span title={`Excluded by ${excludedBy}`}>
              <Badge tone='red'>Excluded by {excludedBy}</Badge>
            </span>
          )}
        </div>
      </td>
      <td className='px-2 py-2'>
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

const SimpleSection = ({
  title,
  pdos,
  direction,
  editable,
  pdoAssignAvailable,
  onToggleEdit,
  onTogglePdo,
}: {
  title: string
  pdos: PersistedPdo[]
  direction: 'rx' | 'tx'
  editable: boolean
  pdoAssignAvailable: boolean
  onToggleEdit: () => void
  onTogglePdo: (pdoIndex: string, next: boolean) => void
}) => {
  // A PDO is locked by exclusion only while unassigned and excluded by an assigned PDO, so of
  // two assigned PDOs excluding each other either can still be unticked.
  const excludeMap = useMemo(() => {
    const m = new Map<string, string>()
    const assignedList = pdos.filter((p) => p.assigned !== false)
    for (const pdo of pdos) {
      if (pdo.assigned !== false) continue
      for (const a of assignedList) {
        if (a.index === pdo.index) continue
        const excluded = a.exclude ?? []
        if (excluded.some((idx) => idx.toLowerCase() === pdo.index.toLowerCase())) {
          m.set(pdo.index.toLowerCase(), a.index)
          break
        }
      }
    }
    return m
  }, [pdos])

  const sorted = [...pdos].sort((a, b) => a.index.localeCompare(b.index))

  return (
    <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800'>
      <div className='flex items-center justify-between bg-neutral-100 px-2 py-1.5 dark:bg-neutral-900'>
        <h6 className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>{title}</h6>
        <button
          type='button'
          onClick={onToggleEdit}
          disabled={!pdoAssignAvailable}
          title={
            pdoAssignAvailable
              ? editable
                ? 'Lock editing'
                : 'Edit PDO assignment'
              : 'This slave does not advertise PdoAssign.'
          }
          aria-label={editable ? 'Lock PDO assignment' : 'Edit PDO assignment'}
          className={cn(
            'rounded p-1 transition-colors',
            pdoAssignAvailable ? 'hover:bg-neutral-200 dark:hover:bg-neutral-800' : 'cursor-not-allowed opacity-40',
          )}
        >
          <PencilIcon size='sm' className={editable ? 'stroke-brand' : 'stroke-neutral-500'} />
        </button>
      </div>
      <table className='w-full'>
        <thead className='bg-neutral-50 dark:bg-neutral-900/50'>
          <tr>
            <th className='w-[90px] px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              Index
            </th>
            <th className='px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              Name
            </th>
            <th className='w-[50px] px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              Dir
            </th>
            <th className='w-[60px] px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              SM
            </th>
            <th className='w-[180px] px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              Flags
            </th>
            <th className='w-[80px] px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
              Assigned
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={6} className='px-2 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400'>
                No {direction.toUpperCase()}PDOs on this slave.
              </td>
            </tr>
          ) : (
            sorted.map((pdo) => (
              <SimpleRow
                key={pdo.index}
                pdo={pdo}
                direction={direction}
                editable={editable}
                excludedBy={excludeMap.get(pdo.index.toLowerCase())}
                onToggle={(next) => onTogglePdo(pdo.index, next)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const EntryEditor = ({
  entries,
  readOnly,
  onChange,
}: {
  entries: PersistedPdoEntry[]
  readOnly: boolean
  onChange: (next: PersistedPdoEntry[]) => void
}) => {
  const updateEntry = (i: number, patch: Partial<PersistedPdoEntry>) => {
    const next = entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    onChange(next)
  }
  const removeEntry = (i: number) => onChange(entries.filter((_, idx) => idx !== i))
  const addEntry = () =>
    onChange([...entries, { index: '0x0000', subIndex: '0x00', bitLen: 8, name: '', dataType: 'USINT' }])

  return (
    <div className='overflow-hidden rounded border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50'>
      <table className='w-full text-xs'>
        <thead>
          <tr className='text-left text-[10px] font-medium text-neutral-500 dark:text-neutral-400'>
            <th className='w-[90px] px-2 py-1.5'>Index</th>
            <th className='w-[70px] px-2 py-1.5'>Sub</th>
            <th className='w-[60px] px-2 py-1.5'>Bits</th>
            <th className='px-2 py-1.5'>Name</th>
            <th className='w-[90px] px-2 py-1.5'>Type</th>
            <th className='w-[40px] px-2 py-1.5' aria-label='remove'></th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} className='px-2 py-3 text-center text-neutral-500 dark:text-neutral-400'>
                No entries on this PDO.
              </td>
            </tr>
          ) : (
            entries.map((entry, i) => (
              <tr
                key={`${entry.index}-${entry.subIndex}-${i}`}
                className='border-t border-neutral-200 dark:border-neutral-800'
              >
                <td className='px-2 py-1'>
                  <input
                    type='text'
                    value={entry.index}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(i, { index: e.target.value })}
                    className='w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono dark:border-neutral-700 dark:bg-neutral-900'
                  />
                </td>
                <td className='px-2 py-1'>
                  <input
                    type='text'
                    value={entry.subIndex}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(i, { subIndex: e.target.value })}
                    className='w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono dark:border-neutral-700 dark:bg-neutral-900'
                  />
                </td>
                <td className='px-2 py-1'>
                  <input
                    type='number'
                    value={entry.bitLen}
                    readOnly={readOnly}
                    min={1}
                    max={64}
                    onChange={(e) => updateEntry(i, { bitLen: Number.parseInt(e.target.value, 10) || 1 })}
                    className='w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
                  />
                </td>
                <td className='px-2 py-1'>
                  <input
                    type='text'
                    value={entry.name}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(i, { name: e.target.value })}
                    className='w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
                  />
                </td>
                <td className='px-2 py-1'>
                  <input
                    type='text'
                    value={entry.dataType}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(i, { dataType: e.target.value })}
                    className='w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
                  />
                </td>
                <td className='px-2 py-1 text-right'>
                  {!readOnly && (
                    <button
                      type='button'
                      onClick={() => removeEntry(i)}
                      aria-label='Remove entry'
                      className='rounded border border-transparent px-1.5 py-0.5 text-red-600 hover:border-red-200 hover:bg-red-50 dark:text-red-400 dark:hover:border-red-900 dark:hover:bg-red-900/20'
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {!readOnly && (
        <div className='border-t border-neutral-200 bg-neutral-100 px-2 py-1 text-right dark:border-neutral-800 dark:bg-neutral-900'>
          <button
            type='button'
            onClick={addEntry}
            className='inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800'
          >
            <PlusIcon /> Add entry
          </button>
        </div>
      )}
    </div>
  )
}

const ExpertSection = ({
  title,
  pdos,
  direction,
  pdoConfigAvailable,
  completeAccess,
  onUpdatePdoEntries,
}: {
  title: string
  pdos: PersistedPdo[]
  direction: 'rx' | 'tx'
  pdoConfigAvailable: boolean
  completeAccess: boolean
  onUpdatePdoEntries?: (direction: 'rx' | 'tx', pdoIndex: string, entries: PersistedPdoEntry[]) => void
}) => {
  const sorted = [...pdos].sort((a, b) => a.index.localeCompare(b.index))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800'>
      <div className='flex items-center justify-between bg-neutral-100 px-2 py-1.5 dark:bg-neutral-900'>
        <h6 className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>{title}</h6>
        <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>
          {sorted.length} PDO{sorted.length === 1 ? '' : 's'}
          {completeAccess ? ' · CA writes' : ''}
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className='px-2 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400'>
          No {direction.toUpperCase()}PDOs on this slave.
        </div>
      ) : (
        sorted.map((pdo) => {
          const key = `${direction}:${pdo.index}`
          const isOpen = expanded.has(key)
          const canEditEntries =
            pdoConfigAvailable && pdo.fixed !== true && pdo.assigned !== false && onUpdatePdoEntries !== undefined
          return (
            <div key={key} className='border-t border-neutral-200 dark:border-neutral-800'>
              <button
                type='button'
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className='flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900'
              >
                <div className='h-4 w-4'>
                  <ArrowIcon
                    direction='right'
                    className={cn('h-4 w-4 stroke-brand-light transition-all', isOpen && 'rotate-270 stroke-brand')}
                  />
                </div>
                <span className='flex flex-1 items-center gap-2'>
                  <span className='font-mono text-xs text-neutral-700 dark:text-neutral-300'>{pdo.index}</span>
                  <span className='text-sm text-neutral-700 dark:text-neutral-300'>{pdo.name}</span>
                  {pdo.fixed === true && <Badge tone='blue'>Fixed</Badge>}
                  {pdo.mandatory === true && <Badge tone='amber'>Mandatory</Badge>}
                  {pdo.assigned === false && <Badge tone='neutral'>Unassigned</Badge>}
                </span>
              </button>
              {isOpen && (
                <div className='border-t border-neutral-200 bg-white px-2 py-2 dark:border-neutral-800 dark:bg-neutral-950'>
                  <EntryEditor
                    entries={pdo.entries}
                    readOnly={!canEditEntries}
                    onChange={(entries) => onUpdatePdoEntries?.(direction, pdo.index, entries)}
                  />
                  {pdo.fixed === true && (
                    <p className='mt-1 text-[10px] text-neutral-500 dark:text-neutral-400'>
                      Fixed mapping — the slave does not accept entry changes to this PDO.
                    </p>
                  )}
                  {pdo.fixed !== true && !pdoConfigAvailable && (
                    <p className='mt-1 text-[10px] text-neutral-500 dark:text-neutral-400'>
                      Enable the PdoConfig CoE flag to edit this PDO&apos;s entries.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

const CoeFlagsPanel = ({ flags, onChange }: { flags: CoeFlags; onChange: (next: CoeFlags) => void }) => {
  const Row = ({
    label,
    value,
    help,
    on,
  }: {
    label: string
    value: boolean
    help: string
    on: (next: boolean) => void
  }) => (
    <label className='flex items-center justify-between gap-3 border-b border-neutral-200 py-1.5 last:border-b-0 dark:border-neutral-800'>
      <span className='flex flex-col'>
        <span className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>{label}</span>
        <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>{help}</span>
      </span>
      <Checkbox checked={value} onCheckedChange={(checked) => on(checked === true)} aria-label={label} />
    </label>
  )

  return (
    <div className='rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-800 dark:bg-neutral-900/50'>
      <Row
        label='PdoAssign'
        value={flags.pdoAssign}
        help='Emit 0x1C12 / 0x1C13 assignment writes.'
        on={(next) => onChange({ ...flags, pdoAssign: next })}
      />
      <Row
        label='PdoConfig'
        value={flags.pdoConfig}
        help="Rewrite each PDO's own mapping (0x1600 / 0x1A00 clear → entries → count)."
        on={(next) => onChange({ ...flags, pdoConfig: next })}
      />
      <Row
        label='CompleteAccess'
        value={flags.completeAccess}
        help='Collapse the mapping rewrites into one Complete Access write per PDO.'
        on={(next) => onChange({ ...flags, completeAccess: next })}
      />
    </div>
  )
}

const PresetSelector = ({
  presets,
  onApplyPreset,
}: {
  presets: ESIAlternativeSmMapping[]
  onApplyPreset: (preset: ESIAlternativeSmMapping) => void
}) => {
  if (presets.length === 0) return null
  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-neutral-600 dark:text-neutral-400'>Preset:</span>
      <select
        onChange={(e) => {
          const i = Number.parseInt(e.target.value, 10)
          if (Number.isNaN(i) || i < 0 || i >= presets.length) return
          const preset = presets[i]
          if (preset !== undefined) onApplyPreset(preset)
          e.target.value = '-1'
        }}
        defaultValue='-1'
        className='rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900'
      >
        <option value='-1'>Choose preset…</option>
        {presets.map((p, i) => (
          <option key={`${p.syncManager}-${p.name}-${i}`} value={i}>
            {p.name} (SM{p.syncManager})
          </option>
        ))}
      </select>
    </div>
  )
}

export const ProcessDataTab = ({
  rxPdos,
  txPdos,
  pdoAssignAvailable,
  coeFlags,
  alternativeSmMappings,
  onUpdatePdoAssigned,
  onUpdatePdoEntries,
  onUpdateCoeFlags,
}: ProcessDataTabProps) => {
  const [view, setView] = useState<'simple' | 'expert'>('simple')
  const [editable, setEditable] = useState(false)
  const [confirmingUnlock, setConfirmingUnlock] = useState(false)

  const requestToggleEdit = useCallback(() => {
    if (editable) {
      setEditable(false)
      return
    }
    setConfirmingUnlock(true)
  }, [editable])

  const confirmUnlock = useCallback(() => {
    setEditable(true)
    setConfirmingUnlock(false)
  }, [])

  const applyPreset = useCallback(
    (preset: ESIAlternativeSmMapping) => {
      const wanted = new Set(preset.pdoIndices.map((idx) => idx.toLowerCase()))
      const direction = preset.syncManager === 2 ? 'rx' : 'tx'
      const list = direction === 'rx' ? rxPdos : txPdos
      for (const pdo of list) {
        if (pdo.sm !== undefined && pdo.sm !== preset.syncManager) continue
        if (pdo.fixed === true || pdo.mandatory === true) continue
        const nextAssigned = wanted.has(pdo.index.toLowerCase())
        if ((pdo.assigned !== false) !== nextAssigned) {
          onUpdatePdoAssigned(direction, pdo.index, nextAssigned)
        }
      }
    },
    [onUpdatePdoAssigned, rxPdos, txPdos],
  )

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div className='flex gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900'>
          {(['simple', 'expert'] as const).map((v) => (
            <button
              key={v}
              type='button'
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                view === v
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
              )}
            >
              {v === 'simple' ? 'Simple' : 'Expert'}
            </button>
          ))}
        </div>
        {view === 'simple' && alternativeSmMappings !== undefined && alternativeSmMappings.length > 0 && (
          <PresetSelector presets={alternativeSmMappings} onApplyPreset={applyPreset} />
        )}
      </div>

      {view === 'simple' ? (
        <>
          <SimpleSection
            title='RxPDOs'
            pdos={rxPdos}
            direction='rx'
            editable={editable}
            pdoAssignAvailable={pdoAssignAvailable}
            onToggleEdit={requestToggleEdit}
            onTogglePdo={(idx, next) => onUpdatePdoAssigned('rx', idx, next)}
          />
          <SimpleSection
            title='TxPDOs'
            pdos={txPdos}
            direction='tx'
            editable={editable}
            pdoAssignAvailable={pdoAssignAvailable}
            onToggleEdit={requestToggleEdit}
            onTogglePdo={(idx, next) => onUpdatePdoAssigned('tx', idx, next)}
          />
        </>
      ) : (
        <>
          {coeFlags !== undefined && onUpdateCoeFlags !== undefined && (
            <CoeFlagsPanel flags={coeFlags} onChange={onUpdateCoeFlags} />
          )}
          <ExpertSection
            title='RxPDOs'
            pdos={rxPdos}
            direction='rx'
            pdoConfigAvailable={coeFlags?.pdoConfig === true}
            completeAccess={coeFlags?.completeAccess === true}
            onUpdatePdoEntries={onUpdatePdoEntries}
          />
          <ExpertSection
            title='TxPDOs'
            pdos={txPdos}
            direction='tx'
            pdoConfigAvailable={coeFlags?.pdoConfig === true}
            completeAccess={coeFlags?.completeAccess === true}
            onUpdatePdoEntries={onUpdatePdoEntries}
          />
        </>
      )}

      <Modal open={confirmingUnlock} onOpenChange={(open) => !open && setConfirmingUnlock(false)}>
        <ModalContent
          onClose={() => setConfirmingUnlock(false)}
          className='!inset-x-0 !bottom-auto !top-1/2 !h-auto max-h-[80vh] w-[460px] !-translate-y-1/2 p-6'
        >
          <ModalHeader>
            <ModalTitle>Edit PDO assignment</ModalTitle>
          </ModalHeader>
          <p className='text-sm text-neutral-700 dark:text-neutral-300'>
            Reassigning PDOs changes the on-wire mapping for this slave. Only use this if you know the slave supports a
            different mapping. Fixed and Mandatory PDOs stay locked.
          </p>
          <ModalFooter className='flex justify-end gap-2 pt-3'>
            <button
              onClick={() => setConfirmingUnlock(false)}
              className='rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
            <button
              onClick={confirmUnlock}
              className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Enable editing
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
