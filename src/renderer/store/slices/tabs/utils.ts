import type { EditorState } from '../editor'
import { CreateEditorObject } from '../shared/utils'
import { TabsProps } from './types'
const CreateEditorObjectFromTab = (tab: TabsProps): EditorState['editor'] => {
  const { elementType, name } = tab
  const editorType = {
    il: 'plc-textual',
    st: 'plc-textual',
    ld: 'plc-graphical',
    sfc: 'plc-graphical',
    fbd: 'plc-graphical',
    array: 'plc-datatype',
    enumerated: 'plc-datatype',
    structure: 'plc-datatype',
  } as const
  let language
  let derivation
  switch (elementType.type) {
    case 'program':
      language = elementType.language
      derivation = null
      break
    case 'function':
      language = elementType.language
      derivation = null
      break
    case 'function-block':
      language = elementType.language
      derivation = null
      break
    case 'data-type':
      derivation = elementType.derivation
      language = null
  }

  if (language === null && derivation !== null) {
    const editor = CreateEditorObject({
      type: editorType[derivation],
      name,
      derivation: derivation,
    })
    return editor
  }
  if (language !== null && derivation === null) {
    const pouType = elementType.type as 'program' | 'function' | 'function-block'
    const editor = CreateEditorObject({
      type: editorType[language],
      name,
      language: language,
      derivation: pouType,
    })
    return editor
  }
  return {
    type: 'available',
    meta: {
      name,
    },
  }
}

export { CreateEditorObjectFromTab }
