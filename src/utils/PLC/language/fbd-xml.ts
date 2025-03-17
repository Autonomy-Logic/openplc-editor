import { CustomFbdNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { FBDRungState } from '@root/renderer/store/slices'
import { FbdXML } from '@root/types/PLC/xml-data/pous/languages/fbd-diagram'

/**
 * Entry point to parse nodes to XML
 */
const ladderToXml = (rungs: FBDRungState[]) => {
  const ladderXML: {
    body: {
      FBD: FbdXML
    }
  } = {
    body: {
      FBD: {
        block: [],
        inVariable: [],
        inOutVariable: [],
        outVariable: [],
      },
    },
  }

  rungs.forEach((rung, _index) => {
    const { nodes, edges: _edges } = rung
    nodes.forEach((node) => {
      switch (node.type as CustomFbdNodeTypes) {
        case 'block':
          break
        case 'input-variable':
          break
        case 'output-variable':
          break
        case 'inout-variable':
          break
        case 'connector':
          break
        case 'continuation':
          break
        default:
          break
      }
    })
  })

  return ladderXML
}

export { ladderToXml }
