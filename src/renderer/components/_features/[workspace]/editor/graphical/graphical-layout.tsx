import { VariablesEditor } from '@root/renderer/components/_organisms/variables-editor'
import { ComponentPropsWithoutRef } from 'react'

import FbdEditor from './FBD'
import LadderEditor from './ladder'
import SfcEditor from './SFC'

type GraphicalLayoutProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  language: 'ld' | 'sfc' | 'fbd'
  path: string
}

export default function GraphicalLayout({ name, language, path }: GraphicalLayoutProps) {
  return (
    <div className='w-full h-full '>
      <VariablesEditor />
      <div className='w-full h-full bg-neutral-600'>

      {language === 'sfc' && <SfcEditor name={name} path={path} />}
      {language === 'fbd' && <FbdEditor name={name} path={path} />}
      {language === 'ld' && <LadderEditor name={name} path={path} />}
      </div>
    </div>
  )
}
