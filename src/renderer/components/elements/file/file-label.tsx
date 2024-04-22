 
import { HTMLAttributes, ReactElement } from 'react'

type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName: string
  lastModified: string
}

export default function Label({ projectName, lastModified, ...props }: FolderLabelProps): ReactElement {
  return (
    <p
      id={projectName}
      className='text-white text-xs absolute flex flex-col gap-[1px] bottom-4 left-3 cursor-pointer'
      {...props}
    >
      <span id={projectName} className='overflow-ellipsis overflow-hidden whitespace-nowrap'>
        {projectName}
      </span>
      <span id={lastModified} className='text-[10px] opacity-40 overflow-ellipsis overflow-hidden whitespace-nowrap'>
        {lastModified}
      </span>
    </p>
  )
}
