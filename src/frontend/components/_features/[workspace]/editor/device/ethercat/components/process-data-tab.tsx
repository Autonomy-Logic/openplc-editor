/**
 * DOPE-704 E3 UI — Process Data view.
 *
 * Shows the slave's RxPDOs and TxPDOs as the ESI declared them. A pencil icon in each
 * table header toggles expert editing: the first click confirms (warning that
 * reassignment changes the on-wire mapping and only works when the slave advertises
 * PdoAssign), then non-Fixed non-Mandatory PDOs become editable through the Assigned
 * checkbox. Clicking the icon again locks the table.
 */

import { PencilIcon } from '@root/frontend/assets/icons/interface/Pencil'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { cn } from '@root/frontend/utils/cn'
import type { ConfiguredEtherCATDevice, PersistedPdo } from '@root/middleware/shared/ports/esi-types'
import { useMemo, useState } from 'react'

type ProcessDataTabProps = {
  device: ConfiguredEtherCATDevice
  onUpdatePdoAssigned: (direction: 'rx' | 'tx', pdoIndex: string, assigned: boolean) => void
}

const Badge = ({ tone, children }: { tone: 'blue' | 'amber' | 'red'; children: React.ReactNode }) => {
  const toneClasses: Record<typeof tone, string> = {
    blue: 'bg-brand/10 text-brand dark:bg-brand/20',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  }
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', toneClasses[tone])}>{children}</span>
}

const PdoRow = ({
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
  const locked = pdo.fixed === true || pdo.mandatory === true
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
          {excludedBy !== undefined && <Badge tone='red'>Excluded by {excludedBy}</Badge>}
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

const Section = ({
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
              <PdoRow
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

export const ProcessDataTab = ({ device, onUpdatePdoAssigned }: ProcessDataTabProps) => {
  const pdoAssignAvailable = device.config.coeFlags?.pdoAssign === true
  const [editable, setEditable] = useState(false)
  const [confirmingUnlock, setConfirmingUnlock] = useState(false)

  const requestToggleEdit = () => {
    if (editable) {
      setEditable(false)
      return
    }
    setConfirmingUnlock(true)
  }

  const confirmUnlock = () => {
    setEditable(true)
    setConfirmingUnlock(false)
  }

  return (
    <div className='flex flex-col gap-4'>
      <Section
        title='RxPDOs'
        pdos={device.rxPdos ?? []}
        direction='rx'
        editable={editable}
        pdoAssignAvailable={pdoAssignAvailable}
        onToggleEdit={requestToggleEdit}
        onTogglePdo={(idx, next) => onUpdatePdoAssigned('rx', idx, next)}
      />
      <Section
        title='TxPDOs'
        pdos={device.txPdos ?? []}
        direction='tx'
        editable={editable}
        pdoAssignAvailable={pdoAssignAvailable}
        onToggleEdit={requestToggleEdit}
        onTogglePdo={(idx, next) => onUpdatePdoAssigned('tx', idx, next)}
      />

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
