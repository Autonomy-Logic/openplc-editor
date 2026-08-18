import { useCallback, useEffect, useRef, useState } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { serializeGlobalVariableListToText } from '../../../../utils/PLC/global-variable-list-serializer'
import { parseGlobalVariableListFromText } from '../../../../utils/PLC/global-variable-list-text-parser'
import { VariablesCodeEditor } from '../../../_organisms/variables-code-editor'
import { toast } from '../../[app]/toast/use-toast'

type GlobalVariableListEditorProps = {
  listName: string
}

/**
 * The editor for one Global Variable List.
 *
 * A GVL is edited as its declaration — the `VAR_GLOBAL … END_VAR` block — which is how
 * CODESYS presents one, and what the user is qualifying against when they write
 * `GVL.Output1` elsewhere.
 *
 * The text is the source of truth while the user types; it is parsed and committed to the
 * project on blur. A block that does not parse is NOT committed and the user is told why:
 * committing half of it would silently drop every declaration below the mistake, and
 * reverting the buffer would throw away what they just typed.
 *
 * Every keystroke is ALSO mirrored into this list's editor model, and that is not
 * decoration. Blur is not the only way out of an editor: Ctrl+S with the caret still in
 * Monaco fires no blur at all, and closing the tab from its × unmounts without a
 * guaranteed one. The save path folds the mirrored buffer in itself
 * (`reconcileGlobalVariableListText`), so a save can no longer serialise the declarations
 * from before the user started typing. Same arrangement the data type code view uses, for
 * the same reason.
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
    projectActions: { updateGlobalVariableList, updateGlobalVariableListQualifier },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const list = globalVariableLists?.find((entry) => entry.name === listName)
  // A list still carrying unparsed text shows that text, not a re-serialisation of its
  // last good members — otherwise reopening the project would silently swap what the
  // user was fixing for something they never wrote.
  const committedText = list ? (list.text ?? serializeGlobalVariableListToText(list)) : ''

  // This list's own model, never the active `editor` — every open list is mounted.
  const model = editor.meta.name === listName ? editor : editors.find((e) => e.meta.name === listName)
  const modelCode =
    model?.type === 'plc-global-variable-list' && model.structure.display === 'code' ? model.structure.code : undefined

  const [draft, setDraft] = useState(() => (typeof modelCode === 'string' ? modelCode : committedText))
  const lastMirroredRef = useRef(draft)

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
    lastMirroredRef.current = draft
    updateModelStructureForName(listName, { display: 'code', code: draft })
  }, [draft, listName, updateModelStructureForName])

  const commit = useCallback(() => {
    if (!list || draft === committedText) return

    const parsed = parseGlobalVariableListFromText(draft, listName)
    if (!parsed.globalVariableList) {
      toast({
        title: 'The declaration could not be read',
        description: parsed.error ?? 'Check the declaration and try again.',
        variant: 'fail',
      })
      return
    }

    updateGlobalVariableList(listName, parsed.globalVariableList.variables)
    // The header qualifier rides on the list, not on its members, so it needs its own
    // commit — otherwise editing the block silently drops a CONSTANT the user wrote.
    updateGlobalVariableListQualifier(listName, parsed.globalVariableList.qualifier)
    handleFileAndWorkspaceSavedState(listName)
  }, [
    draft,
    committedText,
    list,
    listName,
    updateGlobalVariableList,
    updateGlobalVariableListQualifier,
    handleFileAndWorkspaceSavedState,
  ])

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
      onBlur={commit}
    >
      <VariablesCodeEditor
        code={draft}
        onCodeChange={setDraft}
        shouldUseDarkMode={shouldUseDarkMode}
        modelUri={`inmemory://global-variable-list/${listName}.gvl`}
      />
    </div>
  )
}

export { GlobalVariableListEditor }
