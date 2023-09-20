import { CONSTANTS } from '@shared/constants'
import { useStore } from 'zustand'

import { TextEditor, WhiteBoard } from '@/components'
import projectStore from '@/stores/Project'
/**
 * Functional component representing a POU (Program Organization Unit)
 * @component
 */
const Pou = () => {
  const { projectXmlAsObj } = useStore(projectStore)
  const pouType = projectXmlAsObj?.types.pous.pou['@pouType'] as string
  const pouName = projectXmlAsObj?.types.pous.pou['@name'] as string
  const { languages } = CONSTANTS
  /**
   * Render the WhiteBoard component
   * @returns JSX Element
   */
  return pouType?.includes(languages.IL) ? (
    <TextEditor path={pouName} />
  ) : (
    <WhiteBoard />
  )
}

export default Pou
