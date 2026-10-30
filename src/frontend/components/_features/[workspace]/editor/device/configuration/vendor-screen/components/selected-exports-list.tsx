import { Cross2Icon } from '@radix-ui/react-icons'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'

type ExportEntry = { qualifier: string; direction: 'RO' | 'RW' }

type SelectedExportsListProps = {
  exports: ReadonlyArray<ExportEntry>
  disabled: boolean
  readonly: boolean
  onSetDirection: (qualifier: string, direction: 'RO' | 'RW') => void
  onRemove: (qualifier: string) => void
}

/**
 * Right pane of the variable-tree-picker layout. Mirrors `storage.exports[]`
 * one-to-one: each row renders the qualifier verbatim, an inline Access
 * dropdown that flips `direction`, and a remove button that drops the entry.
 * The emitter contract never sees this view: the parent writes the mutations
 * back as the same flat `{ qualifier, direction }[]` the layout received.
 */
export function SelectedExportsList({
  exports,
  disabled,
  readonly,
  onSetDirection,
  onRemove,
}: SelectedExportsListProps) {
  if (exports.length === 0) {
    return (
      <p className='p-3 font-caption text-cp-base text-neutral-500 dark:text-neutral-400'>
        Select variables from the tree to expose them via Data Hub.
      </p>
    )
  }

  return (
    <ul className='flex flex-col gap-1 p-2'>
      {exports.map((entry) => (
        <li
          key={entry.qualifier}
          className='flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800'
        >
          <span className='flex-1 truncate font-caption text-cp-base text-neutral-850 dark:text-neutral-300'>
            {entry.qualifier}
          </span>
          <Select
            value={entry.direction}
            onValueChange={(v) => onSetDirection(entry.qualifier, v === 'RW' ? 'RW' : 'RO')}
            disabled={disabled || readonly}
          >
            <SelectTrigger
              aria-label={`Access for ${entry.qualifier}`}
              placeholder='RO'
              withIndicator
              className='flex h-[26px] w-20 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-0.5 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark data-[disabled]:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
            <SelectContent
              className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
              sideOffset={4}
              position='popper'
              align='center'
              side='bottom'
            >
              {(['RO', 'RW'] as const).map((opt) => (
                <SelectItem
                  key={opt}
                  value={opt}
                  className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                >
                  <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                    {opt}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type='button'
            aria-label={`Remove ${entry.qualifier}`}
            disabled={disabled || readonly}
            onClick={() => onRemove(entry.qualifier)}
            className='flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
          >
            <Cross2Icon className='h-4 w-4' />
          </button>
        </li>
      ))}
    </ul>
  )
}
