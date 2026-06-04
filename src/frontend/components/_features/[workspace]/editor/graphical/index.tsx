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

const GraphicalEditor = ({ name, language, isActive = true }: GraphicalEditorProps) => {
  const editorComponents = {
    sfc: SfcEditor,
    fbd: FbdEditor,
    ld: LadderEditor,
  }

  const EditorComponent = editorComponents[language]

  // Read-only projects (no edit permission) stay fully interactive: the user
  // can add/remove blocks and rewire the diagram in memory. Nothing persists
  // until an explicit Save (Ctrl+S), which routes through the fork modal. The
  // `readOnly` prop is intentionally ignored here — we no longer overlay the
  // editor to block interaction.
  return (
    <GraphicalEditorActiveProvider pouName={name} isActive={isActive}>
      <div className='relative h-full w-full overflow-y-auto'>
        <div className='h-full w-full'>
          <EditorComponent />
        </div>
      </div>
    </GraphicalEditorActiveProvider>
  )
}

export { GraphicalEditor }
