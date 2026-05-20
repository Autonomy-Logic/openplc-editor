import { ComponentPropsWithoutRef } from 'react'

import FbdEditor from './FBD'
import LadderEditor from './ladder'
import SfcEditor from './SFC'

type GraphicalEditorProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  language: 'ld' | 'sfc' | 'fbd'
  path: string
  readOnly?: boolean
  /**
   * Whether this editor is the active (visible) tab.  Defaults to
   * `true` for safety with pre-refactor callers.  Currently unused
   * here — the language-specific subeditors (FBD/LD/SFC) read it
   * once they're individually wired in Phase 3, since they own the
   * polling and decoration that should pause while hidden.
   */
  isActive?: boolean
}

const GraphicalEditor = ({ language, readOnly }: GraphicalEditorProps) => {
  const editorComponents = {
    sfc: SfcEditor,
    fbd: FbdEditor,
    ld: LadderEditor,
  }

  const EditorComponent = editorComponents[language]

  return (
    <div className='relative h-full w-full overflow-y-auto'>
      {readOnly && (
        <div className='absolute inset-0 z-10 cursor-not-allowed' title='Read-only: viewing historical commit' />
      )}
      <div className={`h-full w-full${readOnly ? ' pointer-events-none' : ''}`}>
        <EditorComponent />
      </div>
    </div>
  )
}

export { GraphicalEditor }
