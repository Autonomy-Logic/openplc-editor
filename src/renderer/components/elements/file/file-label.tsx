import { HTMLAttributes, ReactElement } from 'react'

type FolderLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName: string
  lastModified: string
}

export default function Label({ projectName, lastModified, ...props }: FolderLabelProps): ReactElement {
  return (
    <p
      id={projectName}
      className='absolute bottom-4  flex cursor-pointer flex-col gap-[1px] text-xs text-white overflow-hidden w-full px-3'
      {...props}
    >
      <span id={projectName} className='overflow-hidden overflow-ellipsis whitespace-nowrap '>
        {projectName}
      </span>
      <span id={lastModified} className='overflow-hidden overflow-ellipsis whitespace-nowrap text-[10px] opacity-40 '>
        {lastModified}
      </span>
    </p>
  )
}
