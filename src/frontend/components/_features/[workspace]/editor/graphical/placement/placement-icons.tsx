import type { ReactNode } from 'react'

import FbdBlockIcon from '../../../../../../assets/icons/project/fbd/Block'
import CommentIcon from '../../../../../../assets/icons/project/fbd/Comment'
import ConnectorIcon from '../../../../../../assets/icons/project/fbd/Connector'
import ContinuationIcon from '../../../../../../assets/icons/project/fbd/Continuation'
import VariableInIcon from '../../../../../../assets/icons/project/fbd/VariableIn'
import VariableOutIcon from '../../../../../../assets/icons/project/fbd/VariableOut'
import LadderBlockIcon from '../../../../../../assets/icons/project/ladder/Block'
import CoilIcon from '../../../../../../assets/icons/project/ladder/Coil'
import ContactIcon from '../../../../../../assets/icons/project/ladder/Contact'
import type { PlacementElementId, PlacementLanguage } from '../../../../../../utils/graphical/placement-elements'

/** Toolbox icon of a placeable element. */
export function renderPlacementIcon(language: PlacementLanguage, id: PlacementElementId): ReactNode {
  if (language === 'ld') {
    switch (id) {
      case 'contact':
        return <ContactIcon size='md' />
      case 'coil':
        return <CoilIcon size='md' />
      case 'block':
        return <LadderBlockIcon size='md' />
      default:
        return null
    }
  }

  switch (id) {
    case 'block':
      return <FbdBlockIcon size='md' />
    case 'input-variable':
      return <VariableInIcon size='md' />
    case 'output-variable':
      return <VariableOutIcon size='md' />
    case 'connector':
      return <ConnectorIcon size='md' />
    case 'continuation':
      return <ContinuationIcon size='md' />
    case 'comment':
      return <CommentIcon size='md' />
    default:
      return null
  }
}
