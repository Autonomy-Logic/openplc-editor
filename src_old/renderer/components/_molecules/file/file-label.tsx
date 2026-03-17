import { HTMLAttributes, ReactElement } from 'react'

import type { LabelProps as PrimitiveLabelProps } from '../../_atoms'
import { Label as PrimitiveLabel } from '../../_atoms'

type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName?: string
  projectPath?: string
  lastModified?: string
}

const FileLabel = (props: PrimitiveLabelProps) => {
  return <PrimitiveLabel className='w-full overflow-hidden text-ellipsis whitespace-nowrap' {...props} />
}

export default function Label({ projectName, projectPath, lastModified, ...props }: FolderLabelProps): ReactElement {
  const truncateStart = (str: string | undefined, maxLength: number): string => {
    if (!str) return ''
    const strNoProjectJson = str.replace('/project.json', '')
    return strNoProjectJson.length > maxLength ? '...' + strNoProjectJson.slice(-maxLength) : strNoProjectJson
  }

  return (
    <p
      id={projectName}
      className='absolute bottom-4 flex w-full cursor-pointer flex-col gap-[1px] overflow-hidden px-3 text-white'
      {...props}
    >
      <FileLabel className='font-bold'>{projectName}</FileLabel>
      <FileLabel className='text-[0.6rem]'>{truncateStart(projectPath, 30)}</FileLabel>
      <FileLabel className='text-[0.625rem] opacity-40'>{lastModified}</FileLabel>
    </p>
  )
}
