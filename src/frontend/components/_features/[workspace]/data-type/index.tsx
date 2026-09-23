import { ComponentPropsWithoutRef, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCDataType } from '../../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { dtViewUri } from '../../../../services/st-lsp/types'
import { useOpenPLCStore } from '../../../../store'
import { extractSearchQuery } from '../../../../store/slices/search/utils'
import { getErrorMessage } from '../../../../utils/get-error-message'
import { parseDataTypeFromText } from '../../../../utils/PLC/data-type-declarations'
import { serializeDataTypeToText } from '../../../../utils/PLC/data-type-serializer'
import { InputWithRef } from '../../../_atoms/input'
import { ViewModeToggle } from '../../../_atoms/view-mode-toggle'
import { ArrayDataType } from '../../../_molecules/data-types/array'
import { EnumeratorDataType } from '../../../_molecules/data-types/enumerated'
import { StructureDataType } from '../../../_molecules/data-types/structure'
import { VariablesCodeEditor } from '../../../_organisms/variables-code-editor'
import { toast } from '../../[app]/toast/use-toast'

type DatatypeEditorProps = ComponentPropsWithoutRef<'div'> & {
  dataTypeName: string
}

// `name` is the type the commit left behind — the new one when the buffer
// renamed it, so the caller can address the model it now lives under.
type CommitOutcome = { committed: boolean; name: string }

const DataTypeEditor = ({ dataTypeName, ...rest }: DatatypeEditorProps) => {
  const {
    editor,
    editors,
    project: {
      data: { dataTypes },
    },
    unparsedDataTypeFiles,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    datatypeActions: { rename },
    editorActions: { updateModelStructureForName },
    projectActions: { createDatatype, removeUnparsedDataTypeFile, updateDatatype },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    searchQuery,
  } = useOpenPLCStore()
  const { captureAndPush } = usePouSnapshot()

  // Every open data type is mounted at once, so the view state comes from
  // this type's own model — never from the active `editor`.
  const model = editor.meta.name === dataTypeName ? editor : editors.find((e) => e.meta.name === dataTypeName)
  const modelStructure = model?.type === 'plc-datatype' ? model.structure : undefined
  const display = modelStructure?.display === 'code' ? 'code' : 'table'
  const modelCode = modelStructure?.display === 'code' ? modelStructure.code : undefined

  // An unparseable file has no entry in `dataTypes` — raw text is all there is.
  const rawFile = unparsedDataTypeFiles.find(
    (file) => file.relativePath.split('/').pop()?.replace(/\.dt$/i, '') === dataTypeName,
  )

  const [editorContent, setEditorContent] = useState<PLCDataType>()
  const [isEditing, setIsEditing] = useState(false)
  const [editorCode, setEditorCode] = useState(() => {
    if (typeof modelCode === 'string') return modelCode
    const dataType = dataTypes.find((candidate) => candidate.name === dataTypeName)
    return dataType ? serializeDataTypeToText(dataType) : (rawFile?.content ?? '')
  })
  const [parseError, setParseError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const latestCodeRef = useRef(editorCode)
  const latestDisplayRef = useRef(display)
  const lastParsedCodeRef = useRef(editorCode)
  const lastRejectedCodeRef = useRef<string | null>(null)
  const lastMirroredCodeRef = useRef(editorCode)
  const isParsingRef = useRef(false)
  const commitCodeRef = useRef<() => Promise<CommitOutcome>>(() => Promise.resolve({ committed: false, name: '' }))

  useEffect(() => {
    const dataType = dataTypes.find((candidate) => candidate.name === dataTypeName)
    if (dataType) setEditorContent(dataType)
  }, [dataTypes, dataTypeName])

  // In table mode the form is the committed state: it seeds both the buffer
  // and the watermark, so the toggle is instant and can't commit a no-op.
  useEffect(() => {
    if (display === 'code') return
    const text = editorContent ? serializeDataTypeToText(editorContent) : (rawFile?.content ?? '')
    setEditorCode(text)
    lastParsedCodeRef.current = text
  }, [editorContent, display, rawFile?.content])

  // Adopt store-written buffers (rename, undo), never the echo of our own
  // mirror below — that would race the keystroke that produced it.
  useEffect(() => {
    if (display !== 'code' || typeof modelCode !== 'string') return
    if (modelCode === lastMirroredCodeRef.current) return
    setEditorCode(modelCode)
  }, [display, modelCode])

  useEffect(() => {
    if (display !== 'code') return
    lastMirroredCodeRef.current = editorCode
    updateModelStructureForName(dataTypeName, { display: 'code', code: editorCode })
  }, [editorCode, display, dataTypeName, updateModelStructureForName])

  useEffect(() => {
    latestCodeRef.current = editorCode
    latestDisplayRef.current = display
  }, [editorCode, display])

  useEffect(() => {
    return () => {
      if (latestDisplayRef.current === 'code') {
        updateModelStructureForName(dataTypeName, { display: 'code', code: latestCodeRef.current })
      }
    }
  }, [dataTypeName, updateModelStructureForName])

  // No type yet means a broken file — surface why while editing, not on commit.
  useEffect(() => {
    if (display !== 'code' || editorContent) return
    setParseError(parseDataTypeFromText(editorCode, dataTypeName).error ?? null)
  }, [display, editorContent, editorCode, dataTypeName])

  const rejectBuffer = (message: string): boolean => {
    setParseError(message)
    lastRejectedCodeRef.current = editorCode
    toast({ title: 'Syntax error', description: message, variant: 'fail' })
    return false
  }

  // Everything a commit does once the text has parsed.
  const commitParsedDataType = (dataType: PLCDataType): boolean => {
    captureAndPush(dataTypeName)

    if (editorContent) {
      updateDatatype(dataTypeName, dataType)
    } else {
      const result = createDatatype({ data: dataType })
      if (!result.ok) return rejectBuffer(result.message ?? 'Could not create the data type.')
      if (rawFile) removeUnparsedDataTypeFile(rawFile.relativePath)
    }

    handleFileAndWorkspaceSavedState(dataTypeName)
    // A buffer keeping the typed form drifts from the canonical LSP document and loses its colours.
    const canonical = serializeDataTypeToText(dataType)
    setEditorCode(canonical)
    lastParsedCodeRef.current = canonical
    lastMirroredCodeRef.current = canonical
    lastRejectedCodeRef.current = null
    setParseError(null)
    return true
  }

  const commitCode = (): boolean => {
    const { dataType, error } = parseDataTypeFromText(editorCode, dataTypeName)
    if (!dataType) return rejectBuffer(error ?? 'Unexpected syntax error.')
    return commitParsedDataType(dataType)
  }

  // Write to the model directly: `rename` reconciles the stored buffer a render before React state lands.
  const restoreBufferName = (parsed: PLCDataType) => {
    const restored = serializeDataTypeToText({ ...parsed, name: dataTypeName })
    lastMirroredCodeRef.current = restored
    lastParsedCodeRef.current = restored
    lastRejectedCodeRef.current = null
    updateModelStructureForName(dataTypeName, { display: 'code', code: restored })
    setEditorCode(restored)
  }

  // A name edited in the buffer is a rename intent, not a parse error — but an
  // unparsed file has no type to rename, and a case-only difference is
  // normalized rather than renamed, because the name gates refuse a case-only
  // self-rename and routing one through the rename could only ever fail.
  const isRenameIntent = (parsed: PLCDataType): boolean =>
    editorContent !== undefined && parsed.name.toLowerCase() !== dataTypeName.toLowerCase()

  const commitCodeWithRename = async (): Promise<CommitOutcome> => {
    const { dataType, error } = parseDataTypeFromText(editorCode)
    if (!dataType) return { committed: rejectBuffer(error ?? 'Unexpected syntax error.'), name: dataTypeName }
    if (!isRenameIntent(dataType)) return { committed: commitCode(), name: dataTypeName }

    // The body lands under the old name first, so a refused rename still keeps
    // the edit and leaves the buffer committable.
    if (!commitParsedDataType({ ...dataType, name: dataTypeName })) return { committed: false, name: dataTypeName }
    restoreBufferName(dataType)

    try {
      const result = await rename(dataTypeName, dataType.name)
      if (result.ok) return { committed: true, name: dataType.name }
      // A declined impact modal is a user choice, not a failure.
      if (!result.cancelled) toast({ title: 'Rename failed', description: result.message, variant: 'fail' })
    } catch (error) {
      toast({ title: 'Rename failed', description: getErrorMessage(error), variant: 'fail' })
    }
    return { committed: true, name: dataTypeName }
  }

  useEffect(() => {
    commitCodeRef.current = commitCodeWithRename
  })

  // Stable reference, or the child's cursor-jump effect re-fires every
  // keystroke and re-selects the navigated line.
  const codeCursorPosition = useMemo(
    () =>
      model?.cursorPosition?.target === 'data-type'
        ? {
            lineNumber: model.cursorPosition.lineNumber,
            column: model.cursorPosition.column,
            target: 'data-type' as const,
          }
        : undefined,
    [model?.cursorPosition?.target, model?.cursorPosition?.lineNumber, model?.cursorPosition?.column],
  )

  // Goto-definition can land here while the tab is still in table mode.
  // Keyed on the cursor alone: including `display` would re-fire on the
  // user's own switch back to table and pin the tab in code mode.
  useEffect(() => {
    if (!codeCursorPosition || display === 'code') return
    updateModelStructureForName(dataTypeName, { display: 'code', code: editorCode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeCursorPosition])

  useEffect(() => {
    if (display !== 'code') return

    // Clicking away raises mousedown then focusout, and the watermarks the
    // commit itself sets make the pair one attempt whatever its outcome. The
    // flag outlives the await: an impact modal sits outside the container, so
    // its own buttons would otherwise re-enter through mousedown.
    const tryCommit = () => {
      if (isParsingRef.current) return
      if (editorCode === lastParsedCodeRef.current) return
      if (editorCode === lastRejectedCodeRef.current) return
      isParsingRef.current = true
      const release = () => {
        isParsingRef.current = false
      }
      void commitCodeRef.current().then(release, release)
    }

    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      tryCommit()
    }

    // Covers focus moves with no mousedown: Tab, shortcuts.
    const onFocusOut = (e: FocusEvent) => {
      if (!containerRef.current) return
      const newTarget = e.relatedTarget as Node | null
      if (newTarget && containerRef.current.contains(newTarget)) return
      tryCommit()
    }

    const container = containerRef.current
    document.addEventListener('mousedown', onDocMouseDown, true)
    container?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      container?.removeEventListener('focusout', onFocusOut)
    }
  }, [display, editorCode])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    if (display === value) return
    if (display !== 'code') {
      updateModelStructureForName(dataTypeName, { display: value, code: editorCode })
      return
    }
    if (isParsingRef.current) return

    // Only a rename has to wait for the store; keep the plain switch instant.
    const parsed = parseDataTypeFromText(editorCode).dataType
    if (!parsed || !isRenameIntent(parsed)) {
      if (commitCode()) updateModelStructureForName(dataTypeName, { display: value, code: undefined })
      return
    }

    isParsingRef.current = true
    void commitCodeWithRename().then(
      ({ committed, name }) => {
        isParsingRef.current = false
        // A rename rekeyed the model, so the switch belongs to the new name.
        if (committed) updateModelStructureForName(name, { display: value, code: undefined })
      },
      () => {
        isParsingRef.current = false
      },
    )
  }

  const handleStartEditing = () => {
    setIsEditing(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setEditorContent((prevContent) =>
      prevContent
        ? {
            ...prevContent,
            name: value,
          }
        : prevContent,
    )
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { value } = e.target
    if (dataTypeName !== value) {
      // `datatypeActions.rename` validates the new name and rekeys the
      // editor model, tab, and file entry, then flags the file dirty.
      // Async: a referenced type awaits the impact modal first.
      void rename(dataTypeName, value)
        .then((result) => {
          if (!result.ok) {
            setEditorContent((prevContent) => (prevContent ? { ...prevContent, name: dataTypeName } : prevContent))
            // A declined impact modal is a user choice, not a failure.
            if (!result.cancelled) {
              toast({ title: 'Rename failed', description: result.message, variant: 'fail' })
            }
          }
          setIsEditing(false)
        })
        .catch((error: unknown) => {
          setEditorContent((prevContent) => (prevContent ? { ...prevContent, name: dataTypeName } : prevContent))
          toast({ title: 'Rename failed', description: getErrorMessage(error), variant: 'fail' })
          setIsEditing(false)
        })
    }
  }

  return (
    <div
      ref={containerRef}
      aria-label='Data type editor container'
      className=' flex h-full w-full flex-col gap-4  overflow-hidden'
      {...rest}
    >
      <div
        aria-label='Data type metadata container'
        className='h-46 flex w-full items-center gap-4 rounded-md bg-neutral-50 p-2 shadow-md dark:border dark:border-neutral-800 dark:bg-neutral-1000'
      >
        <div aria-label='Data type name container' className='flex h-full w-1/2 items-center gap-2'>
          <label
            htmlFor='data-type-name'
            className='text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Name:
          </label>
          <div
            aria-label='Data type name input container'
            className='flex h-full w-full max-w-[385px] items-center rounded-lg border border-neutral-400 bg-white focus-within:border-brand dark:border-neutral-800 dark:bg-neutral-950'
          >
            {isEditing ? (
              <InputWithRef
                value={editorContent?.name ?? dataTypeName}
                onChange={handleChange}
                onBlur={handleBlur}
                id='data-type-name'
                aria-label='data-type-name'
                className='h-full w-full bg-transparent p-2 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
              />
            ) : (
              <p
                aria-label='Data type name'
                className='h-full w-full bg-transparent p-2 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
                onClick={handleStartEditing}
                dangerouslySetInnerHTML={{
                  __html: extractSearchQuery(editorContent?.name ?? dataTypeName, searchQuery),
                }}
              />
            )}
          </div>
        </div>
        <ViewModeToggle
          display={display}
          onDisplayChange={handleVisualizationTypeChange}
          containerLabel='Data type visualization switch container'
          tableLabel='Data type table visualization'
          codeLabel='Data type code visualization'
          className='ml-auto'
        />
      </div>
      <div aria-label='Data type content container' className='flex h-full w-full flex-col overflow-hidden'>
        {display === 'table' ? (
          <>
            {editorContent?.derivation === 'array' && <ArrayDataType data={editorContent} />}
            {editorContent?.derivation === 'enumerated' && <EnumeratorDataType data={editorContent} />}
            {editorContent?.derivation === 'structure' && <StructureDataType dataTypeName={dataTypeName} />}
          </>
        ) : (
          <>
            <div aria-label='Data type code container' className='h-full w-full overflow-hidden'>
              <VariablesCodeEditor
                code={editorCode}
                onCodeChange={setEditorCode}
                shouldUseDarkMode={shouldUseDarkMode}
                modelUri={dtViewUri(dataTypeName)}
                cursorPosition={codeCursorPosition}
              />
            </div>
            {parseError && <p className='mt-2 shrink-0 text-xs text-red-500'>Error: {parseError}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export { DataTypeEditor }
