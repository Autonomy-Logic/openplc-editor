import { useEffect, useMemo, useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import {
  IO_GROUP_ERROR_HANDLING_OPTIONS,
  IO_GROUP_FUNCTION_CODE_OPTIONS,
  isReadFunctionCode,
} from '../../../../../../utils/modbus/io-group'
import {
  findIOGroupNameConflicts,
  IO_GROUP_TRANSFER_FIELDS,
  type IOGroupDraft,
  type IOGroupImportIssue,
  type IOGroupImportResult,
} from '../../../../../../utils/modbus/io-group-transfer'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../_molecules/modal'

/** Long error lists stay readable; the count says how many were left out. */
const MAX_LISTED_ISSUES = 200

export type IOGroupImportMode = 'append' | 'replace'

export type IOGroupImportPreview = {
  fileName: string
  result: IOGroupImportResult
  /** Set when the file was not UTF-8 and was read as Windows-1252. */
  encodingNote?: string
}

type ImportIOGroupsModalProps = {
  preview: IOGroupImportPreview | null
  existingGroupNames: string[]
  onClose: () => void
  onConfirm: (groups: IOGroupDraft[], mode: IOGroupImportMode) => void
}

const functionCodeLabel = (fc: string) =>
  IO_GROUP_FUNCTION_CODE_OPTIONS.find((o) => o.value === fc)?.label ?? `FC ${fc}`
const errorHandlingLabel = (value: string) =>
  IO_GROUP_ERROR_HANDLING_OPTIONS.find((o) => o.value === value)?.label ?? value

const formatIssue = (issue: IOGroupImportIssue) =>
  [issue.row !== null ? `Row ${issue.row}` : null, issue.field ?? null].filter(Boolean).join(' · ')

const IssueList = ({ issues, tone }: { issues: IOGroupImportIssue[]; tone: 'error' | 'warning' }) => {
  if (issues.length === 0) return null
  const listed = issues.slice(0, MAX_LISTED_ISSUES)
  const hidden = issues.length - listed.length
  const isError = tone === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex max-h-[140px] shrink-0 flex-col gap-1 overflow-y-auto rounded-md border px-3 py-2',
        isError
          ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
          : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
      )}
    >
      <p
        className={cn(
          'text-xs font-semibold',
          isError ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
        )}
      >
        {isError
          ? `${issues.length} error${issues.length > 1 ? 's' : ''} — fix the file and import again. Nothing will be imported.`
          : `${issues.length} warning${issues.length > 1 ? 's' : ''}`}
      </p>
      <ul className='flex flex-col gap-0.5'>
        {listed.map((issue, index) => {
          const location = formatIssue(issue)
          return (
            <li key={index} className='font-caption text-xs text-neutral-700 dark:text-neutral-300'>
              {location && <span className='font-medium'>{location}: </span>}
              {issue.message}
            </li>
          )
        })}
        {hidden > 0 && (
          <li className='font-caption text-xs italic text-neutral-500 dark:text-neutral-400'>…and {hidden} more.</li>
        )}
      </ul>
    </div>
  )
}

/**
 * Review step of the bulk import: shows what the file will create, every
 * validation problem with its row, and lets the user append to or replace the
 * device's current groups. Import stays disabled while any error remains —
 * the import is all-or-nothing.
 */
const ImportIOGroupsModal = ({ preview, existingGroupNames, onClose, onConfirm }: ImportIOGroupsModalProps) => {
  const hasExistingGroups = existingGroupNames.length > 0
  const [mode, setMode] = useState<IOGroupImportMode>('append')

  // Every new file starts from the non-destructive choice.
  useEffect(() => {
    setMode('append')
  }, [preview])

  const groups = useMemo(() => preview?.result.groups ?? [], [preview])

  const errors = useMemo<IOGroupImportIssue[]>(() => {
    if (!preview) return []
    if (mode === 'replace' || preview.result.errors.length > 0) return preview.result.errors
    return findIOGroupNameConflicts(groups, existingGroupNames).map((name) => ({
      row: null,
      field: 'name',
      message: `"${name}" already exists on this device. Rename it in the file or choose "Replace existing groups".`,
    }))
  }, [preview, mode, groups, existingGroupNames])

  const warnings = useMemo<IOGroupImportIssue[]>(
    () => [
      ...(preview?.encodingNote ? [{ row: null, message: preview.encodingNote }] : []),
      ...(preview?.result.warnings ?? []),
    ],
    [preview],
  )

  const canImport = groups.length > 0 && errors.length === 0

  return (
    <Modal open={preview !== null} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='h-fit max-h-[85vh] w-[720px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>Import IO Groups</ModalTitle>
          <p className='truncate font-caption text-xs text-neutral-600 dark:text-neutral-400' title={preview?.fileName}>
            {preview?.fileName}
            {groups.length > 0 && ` · ${groups.length} IO group${groups.length > 1 ? 's' : ''} found`}
          </p>
        </ModalHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-3'>
          {hasExistingGroups && preview && preview.result.errors.length === 0 && (
            <fieldset className='flex flex-col gap-1'>
              <legend className='mb-1 text-xs font-medium text-neutral-950 dark:text-white'>
                This device already has {existingGroupNames.length} IO group{existingGroupNames.length > 1 ? 's' : ''}
              </legend>
              {(
                [
                  { value: 'append', label: 'Append to existing groups' },
                  { value: 'replace', label: 'Replace existing groups' },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className='flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'
                >
                  <input
                    type='radio'
                    name='io-group-import-mode'
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className='accent-brand'
                  />
                  {option.label}
                </label>
              ))}
              {mode === 'replace' && (
                <p className='pl-5 font-caption text-xs text-red-600 dark:text-red-400'>
                  The {existingGroupNames.length} existing IO group{existingGroupNames.length > 1 ? 's' : ''} and their
                  aliases will be removed. Variables mapped to their addresses may need to be re-mapped.
                </p>
              )}
            </fieldset>
          )}

          <IssueList issues={errors} tone='error' />
          <IssueList issues={warnings} tone='warning' />

          {preview && preview.result.errors.length === 0 && groups.length > 0 && (
            <div className='min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              <table className='w-full'>
                <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
                  <tr>
                    {['Name', 'Function Code', 'Cycle (ms)', 'Offset', 'Length', 'Error Handling'].map((title) => (
                      <th
                        key={title}
                        className='px-2 py-1.5 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'
                      >
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, index) => (
                    <tr key={index} className='border-t border-neutral-200 dark:border-neutral-800'>
                      <td className='px-2 py-1 text-xs font-medium text-neutral-950 dark:text-neutral-100'>
                        {group.name}
                      </td>
                      <td className='px-2 py-1 text-xs text-neutral-700 dark:text-neutral-300'>
                        {functionCodeLabel(group.functionCode)}
                      </td>
                      <td className='px-2 py-1 text-xs text-neutral-700 dark:text-neutral-300'>{group.cycleTime}</td>
                      <td className='px-2 py-1 text-xs text-neutral-700 dark:text-neutral-300'>{group.offset}</td>
                      <td className='px-2 py-1 text-xs text-neutral-700 dark:text-neutral-300'>{group.length}</td>
                      <td className='px-2 py-1 text-xs text-neutral-700 dark:text-neutral-300'>
                        {isReadFunctionCode(group.functionCode) ? errorHandlingLabel(group.errorHandling) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className='font-caption text-xs text-neutral-500 dark:text-neutral-400'>
            Accepted: .csv (comma, semicolon or tab separated, with a header row) or .json. Columns:{' '}
            <span className='font-mono'>{IO_GROUP_TRANSFER_FIELDS.join(', ')}</span> — only{' '}
            <span className='font-mono'>name</span> and <span className='font-mono'>functionCode</span> are required;
            the others default to the New IO Group form values.
          </p>
        </div>

        <ModalFooter className='flex justify-end gap-2 pt-2'>
          <button
            type='button'
            onClick={onClose}
            className='rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={() => canImport && onConfirm(groups, hasExistingGroups ? mode : 'append')}
            disabled={!canImport}
            className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            {groups.length > 0 ? `Import ${groups.length} group${groups.length > 1 ? 's' : ''}` : 'Import'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export { ImportIOGroupsModal }
