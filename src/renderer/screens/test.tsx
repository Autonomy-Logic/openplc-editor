import { LibraryFile, LibraryFolder, LibraryRoot } from '@components/_molecules/library'
import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '@components/_molecules/project-tree'

import { ProjectExplorer } from '../components/_organisms/explorer/project'
const Test = () => {
  return (
    <div className='flex h-full w-full flex-row items-center justify-center gap-7'>
      <ProjectExplorer />
      <ProjectTreeRoot label='OPENPLC-EDITOR'>
        <ProjectTreeBranch branchTarget='dataType'>
          <ProjectTreeLeaf leafLang='DT' />
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='function'>
          <ProjectTreeLeaf leafLang='FBD' label='Function 001' />
          <ProjectTreeLeaf leafLang='LD' label='Function 002' />
          <ProjectTreeLeaf leafLang='SFC' label='Function 003' />
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='functionBlock'>
          <ProjectTreeLeaf leafLang='IL' label='Function Block 001' />
          <ProjectTreeLeaf leafLang='ST' label='Function Block 002' />
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='program'>
          <ProjectTreeLeaf leafLang='FBD' label='Program 001' />
        </ProjectTreeBranch>
      </ProjectTreeRoot>
      <LibraryRoot>
        <LibraryFolder label='P1AM Modules'>
          <LibraryFile label='P1AM 001' />
          <LibraryFile label='P1AM 002' />
          <LibraryFile label='P1AM 003' />
          <LibraryFile label='P1AM 004' />
          <LibraryFile label='P1AM 005' />
          <LibraryFile label='P1AM 006' />
          <LibraryFile label='P1AM 007' />
          <LibraryFile label='P1AM 008' />
          <LibraryFile label='P1AM 009' />
          <LibraryFile label='P1AM 010' />
        </LibraryFolder>
        <LibraryFolder label='Jaguar' />
        <LibraryFolder label='Arduino' />
        <LibraryFolder label='Communication' />
        <LibraryFolder label='Sequent Microsystems' />
      </LibraryRoot>
    </div>
  )
}
export { Test }
