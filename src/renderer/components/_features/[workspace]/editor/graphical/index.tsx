import { ComponentPropsWithoutRef } from 'react'

import FbdEditor from './FBD'
import LadderEditor from './ladder'
import SfcEditor from './SFC'

type GraphicalEditorProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  language: 'ld' | 'sfc' | 'fbd'
  path: string
}

const GraphicalEditor = ({ name, language, path }: GraphicalEditorProps) => {
  const editorComponents = {
    sfc: SfcEditor,
    fbd: FbdEditor,
    ld: LadderEditor,
  }

  const EditorComponent = editorComponents[language]

  return (
    <div className='h-full w-full overflow-y-auto '>
      <div className='h-[1800px]'>
        <EditorComponent name={name} path={path} />
      </div>
    </div>
  )
}

export { GraphicalEditor }
