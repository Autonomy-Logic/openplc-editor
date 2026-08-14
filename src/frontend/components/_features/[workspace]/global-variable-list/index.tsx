import { useCallback, useEffect, useState } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { serializeGlobalVariableListToText } from '../../../../utils/PLC/global-variable-list-serializer'
import { parseGlobalVariableListFromText } from '../../../../utils/PLC/global-variable-list-text-parser'
import { toast } from '../../[app]/toast/use-toast'
import { VariablesCodeEditor } from '../../../_organisms/variables-code-editor'

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
 * Reads its list by name rather than from the active editor, so every open list can stay
 * mounted at once without a background one writing over the foreground's model.
 */
const GlobalVariableListEditor = ({ listName }: GlobalVariableListEditorProps) => {
  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: { globalVariableLists },
    },
    projectActions: { updateGlobalVariableList },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const list = globalVariableLists?.find((entry) => entry.name === listName)
  const committedText = list ? serializeGlobalVariableListToText(list) : ''

  const [draft, setDraft] = useState(committedText)

  // Follow the model when it changes underneath us — an import, an undo, a rename — but
  // never while the user has unsaved edits in the buffer, which would delete their typing.
  useEffect(() => {
    setDraft((current) => (current === '' || current === committedText ? committedText : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedText])

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
    handleFileAndWorkspaceSavedState(listName)
  }, [
    draft,
    committedText,
    list,
    listName,
    updateGlobalVariableList,
    handleFileAndWorkspaceSavedState,
  ])

  if (!list) return null

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
