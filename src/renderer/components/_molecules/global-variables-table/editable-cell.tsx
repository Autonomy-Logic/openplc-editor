import * as PrimitivePopover from '@radix-ui/react-popover'
import { useOpenPLCStore } from '@root/renderer/store'
import { ProjectResponse } from '@root/renderer/store/slices/project'
import {
  findAllReferencesToVariable,
  propagateVariableRename,
  type ReferenceImpactAnalysis,
} from '@root/renderer/utils/variable-references'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { isLegalIdentifier, sanitizeVariableInput } from '@root/utils/keywords'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'

import { HighlightedText, InputWithRef } from '../../_atoms'
import { useToast } from '../../_features/[app]/toast/use-toast'
import { RenameImpactModal } from '../rename-impact-modal'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => ProjectResponse
  }
}

type IEditableCellProps = CellContext<PLCVariable, unknown> & { editable?: boolean }
const EditableNameCell = ({ getValue, row: { index }, column: { id }, table, editable = true }: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    searchQuery,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    projectActions: { updatePou, updateVariable },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [impactAnalysis, setImpactAnalysis] = useState<ReferenceImpactAnalysis | null>(null)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const currentVariable = table.options.data[index]

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

  const onBlur = async () => {
    if (cellValue === initialValue) return setIsEditing(false)

    const oldName = initialValue
    const newName = cellValue

    const [isNameLegal, reason] = isLegalIdentifier(newName)
    if (isNameLegal === false) {
      toast({ title: 'Error', description: `'${newName}' ${reason}`, variant: 'fail' })
      setCellValue(oldName)
      setIsEditing(false)
      return
    }

    const impact = findAllReferencesToVariable(
      oldName,
      currentVariable.type,
      'Resource',
      pous,
      ladderFlows,
      fbdFlows,
      'global',
    )

    let shouldPropagate = true
    if (impact.totalReferences > 0) {
      setImpactAnalysis(impact)
      shouldPropagate = await askRenameBlocks()
      setImpactAnalysis(null)
    }

    const res = table.options.meta?.updateData(index, id, cellValue)
    if (!res?.ok) {
      setCellValue(initialValue)
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      return
    }

    if (shouldPropagate && impact.totalReferences > 0) {
      propagateVariableRename(
        oldName,
        newName,
        impact.references,
        ladderFlows,
        fbdFlows,
        pous,
        { updateNode },
        { updateNode: updateFBDNode },
        { updatePou, updateVariable },
        'global',
      )
    }

    setIsEditing(false)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  const handleStartEditing = () => {
    if (!editable) return
    setIsEditing(true)
  }

  return (
    <>
      {confirmOpen && impactAnalysis && (
        <RenameImpactModal
          open={confirmOpen}
          oldName={initialValue}
          newName={cellValue}
          impact={impactAnalysis}
          onConfirm={() => {
            confirmResolveRef.current?.(true)
            setConfirmOpen(false)
          }}
          onCancel={() => {
            confirmResolveRef.current?.(false)
            setConfirmOpen(false)
          }}
        />
      )}

      {isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={() => void onBlur()}
          onInput={(e) => sanitizeVariableInput(e.currentTarget)}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
            'pointer-events-none': !editable,
          })}
        />
      ) : (
        <div
          onClick={handleStartEditing}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center', { 'pointer-events-none': !editable })}
        >
          <HighlightedText
            text={cellValue}
            searchQuery={searchQuery}
            className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'
          />
        </div>
      )}
    </>
  )
}

const EditableDocumentationCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<string | undefined>()

  const [cellValue, setCellValue] = useState(initialValue ?? '')

  const onBlur = () => {
    table.options.meta?.updateData(index, id, cellValue)
  }

  useEffect(() => {
    setCellValue(initialValue ?? '')
  }, [initialValue])

  return (
    <PrimitivePopover.Root>
      <PrimitivePopover.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-text items-center justify-center p-2', {
            'pointer-events-none': !editable,
          })}
        >
          <p className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'>{cellValue}</p>
        </div>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Portal>
        <PrimitivePopover.Content
          align='center'
          side='bottom'
          sideOffset={-32}
          className='box h-fit w-[175px] rounded-lg bg-white p-2 lg:w-[275px] 2xl:w-[375px] dark:bg-neutral-950'
          onInteractOutside={onBlur}
        >
          <textarea
            value={cellValue}
            onChange={(e) => setCellValue(e.target.value)}
            rows={5}
            autoComplete='off'
            className='w-full max-w-[375px] flex-1 resize-none  bg-transparent text-start text-neutral-900 outline-none  dark:text-neutral-100'
          />
        </PrimitivePopover.Content>
      </PrimitivePopover.Portal>
    </PrimitivePopover.Root>
  )
}

export { EditableDocumentationCell, EditableNameCell }
