import { HTMLAttributes, ReactElement } from 'react'

import { Label as FileLabel } from '../../_atoms'
type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName?: string
  projectPath?: string
  lastModified?: string
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
      <FileLabel
        label={projectName}
        id={projectName}
        className='w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-white'
      />
      <FileLabel
        label={truncateStart(projectPath, 30)}
        id={projectPath}
        title={projectPath}
        className='w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.6rem] text-white'
      />
      <FileLabel
        label={lastModified}
        id={lastModified}
        className='w-full overflow-hidden whitespace-nowrap text-[0.625rem] text-white opacity-40'
      />
    </p>
  )
}
