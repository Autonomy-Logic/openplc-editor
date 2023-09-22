import { CONSTANTS } from '@shared/constants'
import { useStore } from 'zustand'

import { TextEditor, WhiteBoard } from '@/components'
import pouStore from '@/stores/Pou'
// import projectStore from '@/stores/Project'
/**
 * Functional component representing a POU (Program Organization Unit)
 * @component
 */
const Pou = () => {
  // const { pous } = useStore(pouStore)
  // const pouType = projectXmlAsObj?.types.pous.pou['@pouType'] as string
  // const [] = pous.pou['']
  // const { languages } = CONSTANTS
  /**
   * Render the editor component to edit the selected POU
   * @returns JSX Element
   */
  return <TextEditor />
  // return pouType?.includes(languages.IL) ? (
  //   <TextEditor path={pouName} />
  // ) : (
  //   <WhiteBoard />
  // )
}

export default Pou
