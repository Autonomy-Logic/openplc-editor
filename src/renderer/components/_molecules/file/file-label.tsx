import { HTMLAttributes, ReactElement } from 'react'

import { Label as FileLabel } from '../../_atoms'
type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName?: string
  lastModified?: string 
}

export default function Label({ projectName, lastModified, ...props }: FolderLabelProps): ReactElement {
  return (
    <p
      id={projectName}
      className='absolute bottom-4  flex w-full cursor-pointer flex-col gap-[1px] overflow-hidden px-3 text-xs text-white'
      {...props}
    >
      <FileLabel
        label={projectName}
        id={projectName}
        className=' w-full text-ellipsis text-white overflow-hidden  whitespace-nowrap '
      />
      <FileLabel
        label={lastModified}
        id={lastModified}
        className='overflow-hidden w-full text-white whitespace-nowrap text-[10px] opacity-40 '
      />
    </p>
  )
}
