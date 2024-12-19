import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type IFileProps = ComponentPropsWithoutRef<'div'> & {
  projectName: string
  projectPath: string
  lastModified: string
}
const File = (props: IFileProps) => {
  const { projectName, projectPath, lastModified, className, ...res } = props
  return (
    <div title='file-root' id='folder-root' className={cn('relative flex h-[160px] w-[224px]', className)} {...res}>
      <p
        id={projectName}
        className='absolute bottom-4 left-3 flex cursor-pointer flex-col gap-[1px] text-white'
      >
        <span id={projectName} className='overflow-hidden overflow-ellipsis whitespace-nowrap text-sm font-bold'>
          {projectName}
        </span>
        <span id={projectName} className='overflow-hidden overflow-ellipsis whitespace-nowrap text-cp-sm'>
          {projectPath}
        </span>
        <span id={lastModified} className='overflow-hidden overflow-ellipsis whitespace-nowrap text-[10px] opacity-40'>
          {lastModified}
        </span>
      </p>
      <svg aria-label='folder-shape' viewBox='0 0 224 160' xmlns='http://www.w3.org/2000/svg'>
        <title>folder-shape</title>
        <path
          id='folder-path'
          className='cursor-pointer fill-brand-medium hover:fill-brand-medium-dark'
          d='M224 153.143V33.5238C224 29.7367 220.991 26.6667 217.28 26.6667H136.217C135.027 26.6667 133.858 26.3443 132.831 25.7326L91.1693 0.934087C90.1415 0.322343 88.9731 0 87.7833 0H6.72C3.00865 0 0 3.07005 0 6.85715V153.143C0 156.93 3.00864 160 6.71999 160H217.28C220.991 160 224 156.93 224 153.143Z'
        />
      </svg>
    </div>
  )
}

export { File }
