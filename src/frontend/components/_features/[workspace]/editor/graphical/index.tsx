import { ComponentPropsWithoutRef } from 'react'

import { GraphicalEditorActiveProvider } from './active-context'
import FbdEditor from './FBD'
import LadderEditor from './ladder'
import SfcEditor from './SFC'

type GraphicalEditorProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  language: 'ld' | 'sfc' | 'fbd'
  readOnly?: boolean
  /**
   * Whether this editor is the active (visible) tab.  Multi-mount
   * keeps every open POU's graphical editor alive across tab
   * switches; this flag is published through a context so deeply-
   * nested ReactFlow nodes (debug badges, etc.) can short-circuit
   * their work without prop-drilling through every block type.
   * Defaults to `true` for safety with pre-refactor callers.
   */
  isActive?: boolean
}

const GraphicalEditor = ({ name, language, readOnly, isActive = true }: GraphicalEditorProps) => {
  const editorComponents = {
    sfc: SfcEditor,
    fbd: FbdEditor,
    ld: LadderEditor,
  }

  const EditorComponent = editorComponents[language]

  return (
    <GraphicalEditorActiveProvider pouName={name} isActive={isActive}>
      <div className='relative h-full w-full overflow-y-auto'>
        {readOnly && (
          <div className='absolute inset-0 z-10 cursor-not-allowed' title='Read-only: viewing historical commit' />
        )}
        <div className={`h-full w-full${readOnly ? ' pointer-events-none' : ''}`}>
          <EditorComponent />
        </div>
      </div>
    </GraphicalEditorActiveProvider>
  )
}

export { GraphicalEditor }
