import { ReactNode } from 'react'

import { LibraryFile, LibraryFolder, LibraryRoot } from '../../_molecules'

type ILibraryFileProps = {
  label: string
}

type ILibraryFolderProps = {
  label: string
  children?: ReactNode
}

type ILibraryRootProps = {
  children: ReactNode
}

const Library = () => {
  return (
    <LibraryRoot>
      <LibraryFolder label='Pasta 1'>
        <LibraryFile label='Arquivo 1' />
        <LibraryFile label='Arquivo 2' />
      </LibraryFolder>

      <LibraryFolder label='Pasta 2'>
        <LibraryFile label='Arquivo 3' />
      </LibraryFolder>
    </LibraryRoot>
  )
}
export { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps,Library }
