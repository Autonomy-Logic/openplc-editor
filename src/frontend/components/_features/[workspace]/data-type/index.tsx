import { ComponentPropsWithoutRef, useEffect, useRef, useState } from 'react'

import type { PLCDataType } from '../../../../../middleware/shared/ports/types'
import { CodeIcon } from '../../../../assets/icons/interface/CodeIcon'
import { TableIcon } from '../../../../assets/icons/interface/TableIcon'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../store'
import { extractSearchQuery } from '../../../../store/slices/search/utils'
import { cn } from '../../../../utils/cn'
import { isDataTypeFilesEnabled } from '../../../../utils/feature-flags'
import { serializeDataTypeToText } from '../../../../utils/PLC/data-type-serializer'
import { parseDataTypeFromText } from '../../../../utils/PLC/data-type-text-parser'
import { InputWithRef } from '../../../_atoms/input'
import { ArrayDataType } from '../../../_molecules/data-types/array'
import { EnumeratorDataType } from '../../../_molecules/data-types/enumerated'
import { StructureDataType } from '../../../_molecules/data-types/structure'
import { VariablesCodeEditor } from '../../../_organisms/variables-code-editor'
import { toast } from '../../[app]/toast/use-toast'

type DatatypeEditorProps = ComponentPropsWithoutRef<'div'> & {
  dataTypeName: string
}

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
  const codeViewEnabled = isDataTypeFilesEnabled()
  const display = codeViewEnabled && modelStructure?.display === 'code' ? 'code' : 'table'
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
  const commitCodeRef = useRef<() => boolean>(() => false)

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

  const commitCode = (): boolean => {
    const { dataType, error } = parseDataTypeFromText(editorCode, dataTypeName)
    if (!dataType) {
      const message = error ?? 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }

    captureAndPush(dataTypeName)

    if (editorContent) {
      updateDatatype(dataTypeName, dataType)
    } else {
      const result = createDatatype({ data: dataType })
      if (!result.ok) {
        const message = result.message ?? 'Could not create the data type.'
        setParseError(message)
        toast({ title: 'Syntax error', description: message, variant: 'fail' })
        return false
      }
      if (rawFile) removeUnparsedDataTypeFile(rawFile.relativePath)
    }

    handleFileAndWorkspaceSavedState(dataTypeName)
    setParseError(null)
    return true
  }

  useEffect(() => {
    commitCodeRef.current = commitCode
  })

  useEffect(() => {
    if (display !== 'code') return

    // Clicking away raises mousedown then focusout, and the commit is
    // synchronous, so `isParsingRef` is clear by the second one. Both
    // watermarks make the pair one attempt whatever its outcome.
    const tryCommit = () => {
      if (isParsingRef.current) return
      if (editorCode === lastParsedCodeRef.current) return
      if (editorCode === lastRejectedCodeRef.current) return
      isParsingRef.current = true
      if (commitCodeRef.current()) {
        lastParsedCodeRef.current = editorCode
        lastRejectedCodeRef.current = null
      } else {
        lastRejectedCodeRef.current = editorCode
      }
      isParsingRef.current = false
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
    if (display === 'code' && !commitCode()) return
    updateModelStructureForName(dataTypeName, { display: value, code: value === 'code' ? editorCode : undefined })
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
      const result = rename(dataTypeName, value)
      if (!result.ok) {
        setEditorContent((prevContent) => (prevContent ? { ...prevContent, name: dataTypeName } : prevContent))
        toast({ title: 'Rename failed', description: result.message, variant: 'fail' })
      }
      setIsEditing(false)
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
        {codeViewEnabled && (
          <div
            aria-label='Data type visualization switch container'
            className='ml-auto flex h-fit w-fit items-center justify-center rounded-md'
          >
            <TableIcon
              aria-label='Data type table visualization'
              onClick={() => handleVisualizationTypeChange('table')}
              size='md'
              currentVisible={display === 'table'}
              className={cn(
                display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
              )}
            />
            <CodeIcon
              aria-label='Data type code visualization'
              onClick={() => handleVisualizationTypeChange('code')}
              size='md'
              currentVisible={display === 'code'}
              className={cn(
                display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
              )}
            />
          </div>
        )}
      </div>
      <div aria-label='Data type content container' className='flex h-full w-full flex-col overflow-hidden'>
        {display === 'table' ? (
          <>
            {editorContent?.derivation === 'array' && <ArrayDataType data={editorContent} />}
            {editorContent?.derivation === 'enumerated' && <EnumeratorDataType data={editorContent} />}
            {editorContent?.derivation === 'structure' && <StructureDataType />}
          </>
        ) : (
          <>
            <div aria-label='Data type code container' className='h-full w-full overflow-hidden'>
              <VariablesCodeEditor
                code={editorCode}
                onCodeChange={setEditorCode}
                shouldUseDarkMode={shouldUseDarkMode}
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
