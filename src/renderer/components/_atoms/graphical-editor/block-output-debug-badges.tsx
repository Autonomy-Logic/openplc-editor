import { useDebugCompositeKey } from '@root/renderer/hooks/use-debug-composite-key'
import { useOpenPLCStore } from '@root/renderer/store'

import { DebugValueBadge } from './debug-value-badge'

type BlockOutputDebugBadgesProps = {
  blockType: string
  blockName: string
  blockVariableName: string
  numericId: string
  outputVariables: Array<{ name: string; class: string; type: { definition: string; value: string } }>
  connectorStartY: number
  connectorOffsetY: number
  blockWidth: number
  /** Output names that already have a variable node connected showing its own badge. */
  connectedOutputNames?: Set<string>
}

/**
 * Renders debug value badges next to each output connector of a block node.
 * Works for both function blocks (using instance-qualified names) and
 * functions (using _TMP_ variable names). Shared between FBD and LD.
 *
 * Outputs that are connected to a variable node are skipped since the
 * variable node already displays its own badge (avoids double badges).
 */
const BlockOutputDebugBadges = ({
  blockType,
  blockName,
  blockVariableName,
  numericId,
  outputVariables,
  connectorStartY,
  connectorOffsetY,
  blockWidth,
  connectedOutputNames,
}: BlockOutputDebugBadgesProps) => {
  const {
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  const getCompositeKey = useDebugCompositeKey()

  if (!isDebuggerVisible || blockType === 'generic') {
    return null
  }

  const outputs = outputVariables.filter((v) => v.class === 'output' || v.class === 'inOut')

  return (
    <>
      {outputs.map((outputVar, index) => {
        if (connectedOutputNames?.has(outputVar.name)) {
          return null
        }

        let compositeKey: string
        if (blockType === 'function-block') {
          compositeKey = getCompositeKey(`${blockVariableName}.${outputVar.name}`)
        } else {
          compositeKey = getCompositeKey(`_TMP_${blockName.toUpperCase()}${numericId}_${outputVar.name}`)
        }

        return (
          <div
            key={outputVar.name}
            className='pointer-events-none absolute'
            style={{
              top: connectorStartY + index * connectorOffsetY - 10,
              left: blockWidth,
            }}
          >
            <DebugValueBadge compositeKey={compositeKey} variableType={outputVar.type.value} position='right' />
          </div>
        )
      })}
    </>
  )
}

export { BlockOutputDebugBadges }
