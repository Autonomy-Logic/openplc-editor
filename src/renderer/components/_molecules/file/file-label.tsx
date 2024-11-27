import { HTMLAttributes, ReactElement } from 'react'

import { Label as FileLabel } from '../../_atoms'
type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName?: string
  projectPath?: string
  lastModified?: string
}

export default function Label({ projectPath, projectName, lastModified, ...props }: FolderLabelProps): ReactElement {
  return (
    <p
      id={projectName}
      className='absolute bottom-4  flex w-full cursor-pointer flex-col gap-[1px] overflow-hidden px-3 text-xs text-white'
      {...props}
    >
      <FileLabel
        label={projectName}
        id={projectName}
        className=' w-full overflow-hidden text-ellipsis whitespace-nowrap font-bold text-white '
      />
      <FileLabel
        label={projectPath}
        id={projectPath}
        className=' w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.6rem] text-white '
      />
      <FileLabel
        label={lastModified}
        id={lastModified}
        className='w-full overflow-hidden whitespace-nowrap text-[10px] text-white opacity-40 '
      />
    </p>
  )
}
