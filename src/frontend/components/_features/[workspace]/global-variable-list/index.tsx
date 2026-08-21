import { useCallback, useEffect, useRef, useState } from 'react'

import type { PLCGlobalVariable } from '../../../../../middleware/shared/ports/types'
import { CodeIcon } from '../../../../assets/icons/interface/CodeIcon'
import { MinusIcon } from '../../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { StickArrowIcon } from '../../../../assets/icons/interface/StickArrow'
import { TableIcon } from '../../../../assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { serializeGlobalVariableListToText } from '../../../../utils/PLC/global-variable-list-serializer'
import { parseGlobalVariableListFromText } from '../../../../utils/PLC/global-variable-list-text-parser'
import { InputWithRef } from '../../../_atoms/input'
import TableActions from '../../../_atoms/table-actions'
import { GlobalVariableListTable } from '../../../_molecules/global-variables-table'
import { VariablesCodeEditor } from '../../../_organisms/variables-code-editor'
import { toast } from '../../[app]/toast/use-toast'

type GlobalVariableListEditorProps = {
  listName: string
}

const ROWS_NOT_SELECTED = -1

/**
 * The editor for one Global Variable List.
 *
 * Two views of the same members, switched by the icons in the header, the way a POU's
 * variables and the Resource globals are:
 *
 *   - the TABLE, which is the default and where each member is a row edited cell by cell.
 *     It is the same table and the same cells the Resource globals use — a list member is a
 *     variable in the same sense a resource global is — writing through the
 *     `global-variable-list` scope on the shared variable actions.
 *   - the DECLARATION, the `VAR_GLOBAL … END_VAR` block CODESYS shows and the on-disk
 *     format, for editing many members at once or pasting one in.
 *
 * Leaving the declaration requires it to parse. The text is the source of truth while the
 * user types there; it is committed on blur, and a block that does not parse is NOT
 * committed and the user is told why — committing half of it would silently drop every
 * declaration below the mistake, and reverting the buffer would throw away what they just
 * typed. A list whose declaration could not be read at all (`text` is set) opens in the
 * declaration view, because that text is what has to be fixed and the table would show the
 * last good parse instead of what the file says.
 *
 * Every keystroke in the declaration is ALSO mirrored into this list's editor model, and
 * that is not decoration. Blur is not the only way out of an editor: Ctrl+S with the caret
 * still in Monaco fires no blur at all, and closing the tab from its × unmounts without a
 * guaranteed one. The save path folds the mirrored buffer in itself
 * (`reconcileGlobalVariableListText`), so a save can no longer serialise the declarations
 * from before the user started typing. Table edits need none of that: each one commits to
 * the project as it happens.
 *
 * The name is shown, not edited. Renaming a list has to rewrite every `<list>.<member>`
 * reference in the project, which the project tree's rename already does through
 * `propagateGlobalVariableListRename`; a second entry point here would be a second chance
 * to skip it.
 *
 * Reads its list by name rather than from the active editor, so every open list can stay
 * mounted at once without a background one writing over the foreground's model.
 */
const GlobalVariableListEditor = ({ listName }: GlobalVariableListEditorProps) => {
  const {
    editor,
    editors,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: { globalVariableLists },
    },
    editorActions: { updateModelStructureForName },
    projectActions: {
      createVariable,
      deleteVariable,
      rearrangeVariables,
      updateGlobalVariableList,
      updateGlobalVariableListQualifier,
    },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const list = globalVariableLists?.find((entry) => entry.name === listName)
  // A list still carrying unparsed text shows that text, not a re-serialisation of its
  // last good members — otherwise reopening the project would silently swap what the
  // user was fixing for something they never wrote.
  const committedText = list ? (list.text ?? serializeGlobalVariableListToText(list)) : ''

  // This list's own model, never the active `editor` — every open list is mounted.
  const model = editor.meta.name === listName ? editor : editors.find((e) => e.meta.name === listName)
  const structure = model?.type === 'plc-global-variable-list' ? model.structure : undefined
  const modelCode = structure?.display === 'code' ? structure.code : undefined
  const display = structure?.display === 'code' ? 'code' : 'table'
  const selectedRow = structure?.display === 'table' ? parseInt(structure.selectedRow) : ROWS_NOT_SELECTED

  const [draft, setDraft] = useState(() => (typeof modelCode === 'string' ? modelCode : committedText))
  const lastMirroredRef = useRef(draft)

  const members: PLCGlobalVariable[] = (list?.variables ?? []).map((variable) => ({ ...variable, class: 'global' }))

  const setSelectedRow = useCallback(
    (row: number) => {
      // The action takes the row as a number and stores it as a string — see `applyStructureView`.
      updateModelStructureForName(listName, { display: 'table', selectedRow: row })
    },
    [listName, updateModelStructureForName],
  )

  // A declaration that could not be read has to be shown as text, and the model is what
  // says so — not a local override. `display === 'code'` is also the contract that makes
  // `structure.code` the draft buffer a mid-edit save folds in, so forcing the view here
  // without moving the model would leave that save serialising stale members.
  useEffect(() => {
    if (list?.text === undefined) return
    if (structure?.display === 'code') return
    updateModelStructureForName(listName, { display: 'code', code: list.text })
  }, [list?.text, structure?.display, listName, updateModelStructureForName])

  // Follow the model when it changes underneath us — an import, an undo, a rename — but
  // never while the user has unsaved edits in the buffer, which would delete their typing.
  useEffect(() => {
    setDraft((current) => (current === '' || current === committedText ? committedText : current))
  }, [committedText])

  // Adopt buffers the store wrote (the rename regenerate, undo), never the echo of our
  // own mirror below — that would race the keystroke that produced it.
  useEffect(() => {
    if (typeof modelCode !== 'string') return
    if (modelCode === lastMirroredRef.current) return
    setDraft(modelCode)
  }, [modelCode])

  useEffect(() => {
    if (display !== 'code') return
    lastMirroredRef.current = draft
    updateModelStructureForName(listName, { display: 'code', code: draft })
  }, [draft, display, listName, updateModelStructureForName])

  const commit = useCallback((): boolean => {
    if (!list || draft === committedText) return true

    const parsed = parseGlobalVariableListFromText(draft, listName)
    if (!parsed.globalVariableList) {
      toast({
        title: 'The declaration could not be read',
        description: parsed.error ?? 'Check the declaration and try again.',
        variant: 'fail',
      })
      return false
    }

    updateGlobalVariableList(listName, parsed.globalVariableList.variables)
    // The header qualifier rides on the list, not on its members, so it needs its own
    // commit — otherwise editing the block silently drops a CONSTANT the user wrote.
    updateGlobalVariableListQualifier(listName, parsed.globalVariableList.qualifier)
    handleFileAndWorkspaceSavedState(listName)
    return true
  }, [
    draft,
    committedText,
    list,
    listName,
    updateGlobalVariableList,
    updateGlobalVariableListQualifier,
    handleFileAndWorkspaceSavedState,
  ])

  /**
   * Whether the declaration can be left for the table.
   *
   * Typed text has to commit. Text that was never typed still has to PARSE: a list saved
   * with a broken declaration comes back with that text on record, and `commit` treats an
   * untouched buffer as nothing to do — which would wave the user through to a table built
   * from the last good members, not from what the file says. Blur keeps using `commit`, so
   * an untouched broken declaration does not toast on every focus change.
   */
  const canLeaveDeclaration = (): boolean => {
    if (draft !== committedText) return commit()
    if (list?.text === undefined) return true
    toast({
      title: 'The declaration could not be read',
      description:
        parseGlobalVariableListFromText(draft, listName).error ??
        'Fix the declaration to edit these members as a table.',
      variant: 'fail',
    })
    return false
  }

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    if (display === value) return
    // A declaration that does not parse has no table to show — see above.
    if (display === 'code' && !canLeaveDeclaration()) return
    if (value === 'code') {
      updateModelStructureForName(listName, { display: 'code', code: committedText })
      setDraft(committedText)
      return
    }
    setSelectedRow(ROWS_NOT_SELECTED)
  }

  const handleCreateVariable = () => {
    if (display === 'code') return

    // The first member has nothing to be modelled on; every later one is the selected row
    // carried forward, which is what makes adding a run of similar members quick.
    // `createVariableValidation` walks the name and any literal address to the next free
    // one, so the copy cannot collide with its source.
    if (members.length === 0) {
      createVariable({
        scope: 'global-variable-list',
        associatedList: listName,
        data: {
          name: 'GlobalVar',
          type: { definition: 'base-type', value: 'DINT' },
          class: 'global',
          location: '',
          documentation: '',
        },
      })
      setSelectedRow(0)
      handleFileAndWorkspaceSavedState(listName)
      return
    }

    const template = selectedRow === ROWS_NOT_SELECTED ? members[members.length - 1] : members[selectedRow]
    const data = {
      ...template,
      // A manual literal address is carried forward and auto-incremented; an alias
      // binding starts empty so two members never point at the same address.
      location: template.location.startsWith('%') ? template.location : '',
      documentation: '',
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'global-variable-list', associatedList: listName, data })
      setSelectedRow(members.length)
      handleFileAndWorkspaceSavedState(listName)
      return
    }

    createVariable({
      scope: 'global-variable-list',
      associatedList: listName,
      data,
      rowToInsert: selectedRow + 1,
    })
    setSelectedRow(selectedRow + 1)
    handleFileAndWorkspaceSavedState(listName)
  }

  const handleRemoveVariable = () => {
    if (display === 'code' || selectedRow === ROWS_NOT_SELECTED) return
    if (!members[selectedRow]) return

    // No cascade to confirm, unlike a resource global: a POU reaches a member through the
    // LIST (`<list>.<member>`), never through a `VAR_EXTERNAL` of the member itself.
    const result = deleteVariable({
      scope: 'global-variable-list',
      associatedList: listName,
      rowId: selectedRow,
    })
    if (!result.ok) {
      toast({ title: result.title ?? 'Error', description: result.message, variant: 'fail' })
      return
    }

    if (selectedRow === members.length - 1) setSelectedRow(selectedRow - 1)
    handleFileAndWorkspaceSavedState(listName)
  }

  const handleRearrangeVariables = (offset: number) => {
    if (display === 'code' || selectedRow === ROWS_NOT_SELECTED) return
    const newIndex = selectedRow + offset
    if (newIndex < 0 || newIndex > members.length - 1) return

    rearrangeVariables({
      scope: 'global-variable-list',
      associatedList: listName,
      rowId: selectedRow,
      newIndex,
    })
    setSelectedRow(newIndex)
    handleFileAndWorkspaceSavedState(listName)
  }

  const handleQualifierBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const value = event.target.value.trim()
    if (value === (list?.qualifier ?? '')) return
    updateGlobalVariableListQualifier(listName, value === '' ? undefined : value)
    handleFileAndWorkspaceSavedState(listName)
  }

  // Deleting a list with its tab still open leaves this mounted for a frame. Say so,
  // rather than rendering a blank panel that reads as a broken editor.
  if (!list) {
    return (
      <div
        aria-label={`Global variable list ${listName}`}
        className='flex h-full w-full flex-1 items-center justify-center'
      >
        <p className='font-caption text-xs text-neutral-500 dark:text-neutral-400'>
          This global variable list no longer exists.
        </p>
      </div>
    )
  }

  return (
    <div
      aria-label={`Global variable list ${listName}`}
      className='flex h-full w-full flex-1 flex-col gap-2 overflow-hidden'
      onBlur={() => {
        if (display === 'code') commit()
      }}
    >
      <div
        aria-label='Global variable list metadata container'
        className='flex w-full shrink-0 items-center gap-4 rounded-md bg-neutral-50 p-2 shadow-md dark:border dark:border-neutral-800 dark:bg-neutral-1000'
      >
        <div className='flex items-center gap-2'>
          <span className='font-caption text-xs font-medium text-neutral-950 dark:text-white'>Name:</span>
          <span
            aria-label='Global variable list name'
            className='font-caption text-xs text-neutral-850 dark:text-neutral-100'
          >
            {listName}
          </span>
        </div>
        <div className='flex items-center gap-2'>
          <label
            htmlFor={`gvl-qualifier-${listName}`}
            className='font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Qualifier:
          </label>
          {/* The header qualifier (`VAR_GLOBAL CONSTANT`) appears nowhere in the table, and
              it round-trips to CODESYS, so the table view has to be able to show and set it. */}
          <InputWithRef
            id={`gvl-qualifier-${listName}`}
            aria-label='Global variable list qualifier'
            key={list.qualifier ?? ''}
            defaultValue={list.qualifier ?? ''}
            onBlur={handleQualifierBlur}
            placeholder='None'
            className='h-6 w-40 rounded-md border border-neutral-400 bg-white p-1 font-caption text-xs text-neutral-850 outline-none focus:border-brand dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
          />
        </div>

        {display === 'table' && (
          <div
            aria-label='Global variable list table actions container'
            className='ml-auto flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            <TableActions
              actions={[
                {
                  ariaLabel: 'Add table row button',
                  onClick: handleCreateVariable,
                  icon: <PlusIcon className='!stroke-brand' />,
                  id: 'add-variable-button',
                },
                {
                  ariaLabel: 'Remove table row button',
                  onClick: handleRemoveVariable,
                  disabled: selectedRow === ROWS_NOT_SELECTED,
                  icon: <MinusIcon />,
                  id: 'remove-variable-button',
                },
                {
                  ariaLabel: 'Move table row up button',
                  onClick: () => handleRearrangeVariables(-1),
                  disabled: selectedRow === ROWS_NOT_SELECTED || selectedRow === 0,
                  icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                  id: 'move-variable-up-button',
                },
                {
                  ariaLabel: 'Move table row down button',
                  onClick: () => handleRearrangeVariables(1),
                  disabled: selectedRow === ROWS_NOT_SELECTED || selectedRow === members.length - 1,
                  icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                  id: 'move-variable-down-button',
                },
              ]}
            />
          </div>
        )}

        <div
          aria-label='Global variable list visualization switch container'
          className={cn('flex h-fit w-fit items-center justify-center rounded-md', {
            'ml-auto': display === 'code',
          })}
        >
          <TableIcon
            aria-label='Global variable list table visualization'
            onClick={() => handleVisualizationTypeChange('table')}
            size='md'
            currentVisible={display === 'table'}
            className={cn(
              display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
          <CodeIcon
            aria-label='Global variable list code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={display === 'code'}
            className={cn(
              display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>

      <div aria-label='Global variable list content container' className='flex h-full w-full flex-col overflow-hidden'>
        {display === 'table' ? (
          <GlobalVariableListTable
            listName={listName}
            tableData={members}
            selectedRow={selectedRow}
            handleRowClick={(row) => setSelectedRow(parseInt(row.id))}
          />
        ) : (
          <VariablesCodeEditor
            code={draft}
            onCodeChange={setDraft}
            shouldUseDarkMode={shouldUseDarkMode}
            modelUri={`inmemory://global-variable-list/${listName}.gvl`}
          />
        )}
      </div>
    </div>
  )
}

export { GlobalVariableListEditor }
