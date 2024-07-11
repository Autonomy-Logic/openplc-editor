import { ComponentPropsWithoutRef } from 'react'

import GraphicalLayout from './graphical-layout'

type GraphicalEditorProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  language: 'ld' | 'sfc' | 'fbd'
  path: string
}

const GraphicalEditor = ({ name, language, path }: GraphicalEditorProps) => {
  return <GraphicalLayout name={name} language={language} path={path} />
}

export { GraphicalEditor }
