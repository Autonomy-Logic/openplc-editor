import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type {
  BlockNode,
  BlockVariant,
  ParallelNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/frontend/store/slices'
import { createTestStore } from '@root/frontend/store/testing'
import type { Node } from '@xyflow/react'

import { createBlockSignatureResolver } from '../../block-signatures'
import { parseXmlDocument } from '../../parse-xml-document'
import { parsePouHeadersXml } from '../../pou-xml'
import { asRecord } from '../../xml-node'
import { parseLadderXml } from '../ladder-xml'

// The LD body of a program exported by the editor (OPCSERVETEST.xml): a seal-in rung with a parallel branch,
// a CTU and a TP with literals and variables on their secondary pins, and a user FB forced onto EN/ENO.
const EXPORTED_LD = `
  <leftPowerRail localId="2078927" width="3" height="40"><position x="0" y="30"/>
    <connectionPointOut formalParameter=""><relPosition x="3" y="20"/></connectionPointOut></leftPowerRail>
  <leftPowerRail localId="3978207" width="3" height="40"><position x="0" y="204"/>
    <connectionPointOut formalParameter=""><relPosition x="3" y="20"/></connectionPointOut></leftPowerRail>
  <leftPowerRail localId="4378669" width="3" height="40"><position x="0" y="378"/>
    <connectionPointOut formalParameter=""><relPosition x="3" y="20"/></connectionPointOut></leftPowerRail>
  <leftPowerRail localId="1835337" width="3" height="40"><position x="0" y="512"/>
    <connectionPointOut formalParameter=""><relPosition x="3" y="20"/></connectionPointOut></leftPowerRail>
  <rightPowerRail localId="1108476" width="3" height="40"><position x="442" y="30"/>
    <connectionPointIn><relPosition x="3" y="20"/><connection refLocalId="7122804" formalParameter="output"/></connectionPointIn></rightPowerRail>
  <rightPowerRail localId="10700105" width="3" height="40"><position x="583" y="204"/>
    <connectionPointIn><relPosition x="3" y="20"/><connection refLocalId="2038184" formalParameter="Q"/></connectionPointIn></rightPowerRail>
  <rightPowerRail localId="8907752" width="3" height="40"><position x="583" y="378"/>
    <connectionPointIn><relPosition x="3" y="20"/><connection refLocalId="8015863" formalParameter="Q"/></connectionPointIn></rightPowerRail>
  <rightPowerRail localId="5368148" width="3" height="40"><position x="523" y="512"/>
    <connectionPointIn><relPosition x="3" y="20"/><connection refLocalId="5512108" formalParameter="ENO"/></connectionPointIn></rightPowerRail>
  <block localId="2038184" typeName="CTU" instanceName="CTU0" width="66" height="140" executionOrderId="0">
    <position x="257" y="188"/>
    <inputVariables>
      <variable formalParameter="CU"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="8475642" formalParameter="output"/></connectionPointIn></variable>
      <variable formalParameter="R"><connectionPointIn><relPosition x="0" y="76"/><connection refLocalId="1041858"/></connectionPointIn></variable>
      <variable formalParameter="PV"><connectionPointIn><relPosition x="0" y="116"/><connection refLocalId="10668998"/></connectionPointIn></variable>
    </inputVariables>
    <inOutVariables/>
    <outputVariables>
      <variable formalParameter="Q"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable>
      <variable formalParameter="CV"><connectionPointOut><relPosition x="66" y="76"/></connectionPointOut></variable>
    </outputVariables>
  </block>
  <block localId="8015863" typeName="TP" instanceName="TON0" width="66" height="100" executionOrderId="0">
    <position x="257" y="362"/>
    <inputVariables>
      <variable formalParameter="IN"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="6913796" formalParameter="output"/></connectionPointIn></variable>
      <variable formalParameter="PT"><connectionPointIn><relPosition x="0" y="76"/><connection refLocalId="10812298"/></connectionPointIn></variable>
    </inputVariables>
    <inOutVariables/>
    <outputVariables>
      <variable formalParameter="Q"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable>
      <variable formalParameter="ET"><connectionPointOut><relPosition x="66" y="76"/></connectionPointOut></variable>
    </outputVariables>
  </block>
  <block localId="5512108" typeName="FUNC_BLOCK" instanceName="FUNC_BLOCK0" width="120" height="60" executionOrderId="0">
    <position x="143" y="496"/>
    <inputVariables>
      <variable formalParameter="EN"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="1835337" formalParameter="left-rail"/></connectionPointIn></variable>
    </inputVariables>
    <inOutVariables/>
    <outputVariables>
      <variable formalParameter="ENO"><connectionPointOut><relPosition x="120" y="36"/></connectionPointOut></variable>
    </outputVariables>
  </block>
  <contact localId="1980603" negated="true" width="24" height="24"><position x="68" y="38"/>
    <connectionPointIn><relPosition x="0" y="12"/><connection refLocalId="2078927" formalParameter="left-rail"/></connectionPointIn>
    <connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>DESLIGA</variable></contact>
  <contact localId="10480457" negated="false" width="24" height="24"><position x="186" y="38"/>
    <connectionPointIn><relPosition x="0" y="12"/><connection refLocalId="1980603" formalParameter="output"/></connectionPointIn>
    <connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>LIGA</variable></contact>
  <contact localId="10025886" negated="false" width="24" height="24"><position x="186" y="130"/>
    <connectionPointIn><relPosition x="0" y="12"/><connection refLocalId="1980603" formalParameter="output"/></connectionPointIn>
    <connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>OUT</variable></contact>
  <contact localId="8475642" negated="false" width="24" height="24"><position x="68" y="212"/>
    <connectionPointIn><relPosition x="0" y="12"/><connection refLocalId="3978207" formalParameter="left-rail"/></connectionPointIn>
    <connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>AUX0</variable></contact>
  <contact localId="6913796" negated="false" width="24" height="24"><position x="68" y="386"/>
    <connectionPointIn><relPosition x="0" y="12"/><connection refLocalId="4378669" formalParameter="left-rail"/></connectionPointIn>
    <connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>CTU0.Q</variable></contact>
  <coil localId="7122804" negated="false" width="28" height="24"><position x="304" y="38"/>
    <connectionPointIn><relPosition x="0" y="12"/>
      <connection refLocalId="10480457" formalParameter="output"/>
      <connection refLocalId="10025886" formalParameter="output"/>
    </connectionPointIn>
    <connectionPointOut><relPosition x="28" y="12"/></connectionPointOut><variable>OUT</variable></coil>
  <inVariable localId="1041858" width="80" height="32" negated="false"><position x="147" y="248"/>
    <connectionPointOut><relPosition x="80" y="16"/></connectionPointOut><expression/></inVariable>
  <inVariable localId="10668998" width="80" height="32" negated="false"><position x="147" y="288"/>
    <connectionPointOut><relPosition x="80" y="16"/></connectionPointOut><expression>3</expression></inVariable>
  <inVariable localId="10812298" width="80" height="32" negated="false"><position x="147" y="422"/>
    <connectionPointOut><relPosition x="80" y="16"/></connectionPointOut><expression>T#20S</expression></inVariable>
  <outVariable localId="1188479" width="80" height="32" negated="false"><position x="353" y="248"/>
    <connectionPointIn><relPosition x="0" y="16"/><connection refLocalId="2038184" formalParameter="CV"/></connectionPointIn>
    <expression>CONTA</expression></outVariable>
  <outVariable localId="9725934" width="80" height="32" negated="false"><position x="353" y="422"/>
    <connectionPointIn><relPosition x="0" y="16"/><connection refLocalId="8015863" formalParameter="ET"/></connectionPointIn>
    <expression/></outVariable>`

const LIBRARY_BLOCKS = `
  <addData><data name="openplc.org/library-blocks" handleUnknown="discard"><libraryBlocks>
    <pou name="CTU" pouType="functionBlock"><interface>
      <outputVars><variable name="Q"><type><BOOL/></type></variable><variable name="CV"><type><INT/></type></variable></outputVars>
      <inputVars><variable name="CU"><type><BOOL/></type></variable><variable name="R"><type><BOOL/></type></variable>
        <variable name="PV"><type><INT/></type></variable></inputVars>
    </interface></pou>
    <pou name="TP" pouType="functionBlock"><interface>
      <outputVars><variable name="Q"><type><BOOL/></type></variable><variable name="ET"><type><TIME/></type></variable></outputVars>
      <inputVars><variable name="IN"><type><BOOL/></type></variable><variable name="PT"><type><TIME/></type></variable></inputVars>
    </interface></pou>
  </libraryBlocks></data></addData>`

const USER_FB = `
  <pou name="FUNC_BLOCK" pouType="functionBlock"><interface>
    <localVars><variable name="passos"><type><INT/></type></variable></localVars>
  </interface><body><ST><xhtml:p><![CDATA[passos := passos + 1;]]></xhtml:p></ST></body></pou>`

function parseProgram(ld: string, { withLibraryBlocks = true } = {}) {
  const project = parseXmlDocument(
    `<project><types><pous>${USER_FB}<pou name="main" pouType="program"><body><LD>${ld}</LD></body></pou></pous></types>${
      withLibraryBlocks ? LIBRARY_BLOCKS : ''
    }</project>`,
  )
  const pouXml = asRecord(asRecord(project.types).pous).pou
  const resolveBlock = createBlockSignatureResolver(parsePouHeadersXml(pouXml), [], project.addData)
  const [, main] = Array.isArray(pouXml) ? pouXml : []
  return parseLadderXml('main', asRecord(asRecord(main).body).LD, { resolveBlock })
}

const isBlock = (node: Node): node is BlockNode<BlockVariant> => node.type === 'block'
const isParallel = (node: Node): node is ParallelNode => node.type === 'parallel'
const isVariableNode = (node: Node): node is VariableNode => node.type === 'variable'

function blockIn(rung: RungLadderState): BlockNode<BlockVariant> {
  const block = rung.nodes.find(isBlock)
  if (!block) throw new Error(`rung ${rung.id} has no block`)
  return block
}

type HandleData = { handles: Array<{ id?: string | null; glbPosition: { x: number; y: number } }> }

function handleY(rung: RungLadderState, nodeId: string, handleId: string | null | undefined): number | undefined {
  const node = rung.nodes.find((n) => n.id === nodeId)
  const data = node?.data as HandleData | undefined
  return data?.handles.find((handle) => handle.id === handleId)?.glbPosition.y
}

const VERTICAL_PARALLEL_HANDLES = new Set(['output-down', 'input-down', 'input-top', 'output-top'])

describe('parseLadderXml rebuilds rungs the way the editor draws them', () => {
  const { body, warnings } = parseProgram(EXPORTED_LD)
  const [sealIn, counter, timer, userBlock] = body.rungs

  it('imports the exported program without warnings, one rung per rail pair', () => {
    expect(warnings).toEqual([])
    expect(body.rungs).toHaveLength(4)
  })

  it('turns the fan-out/fan-in of the seal-in rung into an OPEN/CLOSE parallel', () => {
    const [open, close] = sealIn.nodes.filter(isParallel)
    expect([open.data.type, close.data.type]).toEqual(['open', 'close'])
    expect(open.data.parallelCloseReference).toBe(close.id)
    expect(close.data.parallelOpenReference).toBe(open.id)
    const wiring = sealIn.edges.map((e) => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`)
    expect(wiring).toEqual(
      expect.arrayContaining([
        `CONTACT-1980603.output->${open.id}.input`,
        `${open.id}.output-right->CONTACT-10480457.input`,
        `${open.id}.output-down->CONTACT-10025886.input`,
        `CONTACT-10480457.output->${close.id}.input`,
        `CONTACT-10025886.output->${close.id}.input-down`,
        `${close.id}.output-right->COIL-7122804.input`,
      ]),
    )
    // The branch drawn on top in the XML stays the serial path.
    const serial = sealIn.nodes.find((n) => n.id === 'CONTACT-10480457')
    const parallel = sealIn.nodes.find((n) => n.id === 'CONTACT-10025886')
    expect(parallel?.position.y).toBeGreaterThan(serial?.position.y ?? Infinity)
  })

  it('draws library blocks with their full signature, not only the pins the XML wired', () => {
    const ctu = blockIn(counter)
    expect(ctu.data.variant.variables.map((v) => v.name)).toEqual(['CU', 'R', 'PV', 'Q', 'CV'])
    expect(ctu.data.inputHandles.map((h) => h.id)).toEqual(['CU', 'R', 'PV'])
    expect(ctu.data.outputHandles.map((h) => h.id)).toEqual(['Q', 'CV'])
    expect(ctu.data.variable).toEqual({ name: 'CTU0' })
    expect(ctu.data.numericId).toBe('2038184')
    expect(ctu.selected).toBe(false)
  })

  it('carries the literals and variables on secondary pins as connected variables', () => {
    expect(blockIn(counter).data.connectedVariables).toEqual([
      { handleId: 'PV', handleTableId: undefined, type: 'input', variable: { name: '3' } },
      { handleId: 'CV', handleTableId: undefined, type: 'output', variable: { name: 'CONTA' } },
    ])
    expect(blockIn(timer).data.connectedVariables).toEqual([
      { handleId: 'PT', handleTableId: undefined, type: 'input', variable: { name: 'T#20S' } },
    ])
  })

  it('gives every secondary pin a variable box bound to its block, pin and pin type', () => {
    const ctu = blockIn(counter)
    const boxes = counter.nodes.filter(isVariableNode).map((n) => ({
      pin: n.data.block.handleId,
      side: n.data.variant,
      name: n.data.variable.name,
      type: n.data.block.variableType.type.value,
      block: n.data.block.id,
    }))
    expect(boxes).toEqual([
      { pin: 'R', side: 'input', name: '', type: 'BOOL', block: ctu.id },
      { pin: 'PV', side: 'input', name: '3', type: 'INT', block: ctu.id },
      { pin: 'CV', side: 'output', name: 'CONTA', type: 'INT', block: ctu.id },
    ])
  })

  it('forces execution control onto a user block with no BOOL input', () => {
    const block = blockIn(userBlock)
    expect(block.data.executionControl).toBe(true)
    expect(block.data.inputConnector?.id).toBe('EN')
    expect(block.data.outputConnector?.id).toBe('ENO')
    expect(userBlock.edges.map((e) => `${e.sourceHandle}->${e.targetHandle}`)).toEqual([
      'left-rail->EN',
      'ENO->right-rail',
    ])
  })

  it('lays every rung out from its own origin, with straight wires between elements', () => {
    for (const rung of body.rungs) {
      const leftRail = rung.nodes.find((n) => n.id === `left-rail-${rung.id}`)
      expect(leftRail?.position).toEqual({ x: 0, y: 30 })
      for (const edge of rung.edges) {
        if (
          VERTICAL_PARALLEL_HANDLES.has(edge.sourceHandle ?? '') ||
          VERTICAL_PARALLEL_HANDLES.has(edge.targetHandle ?? '')
        ) {
          continue
        }
        const from = handleY(rung, edge.source, edge.sourceHandle)
        const to = handleY(rung, edge.target, edge.targetHandle)
        expect({ edge: edge.id, y: to }).toEqual({ edge: edge.id, y: from })
      }
    }
  })
})

describe('parseLadderXml falls back to the XML layout for what the editor cannot draw', () => {
  it('keeps a rung whose block has elements on a secondary pin, and says why', () => {
    const ld = EXPORTED_LD.replace(
      '<connection refLocalId="1041858"/>',
      '<connection refLocalId="8475642" formalParameter="output"/>',
    )
    const { body, warnings } = parseProgram(ld)
    expect(warnings).toEqual([
      'POU "main": 1 unconnected LD variable box(es) skipped',
      'POU "main": rung 2 kept the layout from the XML, because elements are wired to the secondary input "R" of block "CTU"',
    ])
    expect(body.rungs[1].nodes.map((n) => n.id)).toContain('LEFT-POWER-RAIL-3978207')
    expect(body.rungs[0].nodes.some(isParallel)).toBe(true)
  })

  it('still gives the blocks of a kept rung their signature, so their inputs are not lost', () => {
    const ld = EXPORTED_LD.replace(
      '<connection refLocalId="1041858"/>',
      '<connection refLocalId="8475642" formalParameter="output"/>',
    )
    const block = blockIn(parseProgram(ld).body.rungs[1])
    expect(block.position).toEqual({ x: 257, y: 188 })
    expect(block.data.variant.variables.map((v) => v.name)).toEqual(['CU', 'R', 'PV', 'Q', 'CV'])
    expect(block.data.inputHandles.map((h) => h.id)).toEqual(['CU', 'R', 'PV'])
  })

  it('draws an unknown block from the pins the XML names, and says so', () => {
    const { body, warnings } = parseProgram(EXPORTED_LD, { withLibraryBlocks: false })
    expect(warnings).toEqual([
      'POU "main": block type "CTU" is not defined in the project or its libraries, its pins were taken from the XML',
      'POU "main": block type "TP" is not defined in the project or its libraries, its pins were taken from the XML',
    ])
    expect(blockIn(body.rungs[1]).data.inputHandles.map((h) => h.id)).toEqual(['CU', 'R', 'PV'])
  })
})

const rail = (side: 'left' | 'right', id: string, from?: string) =>
  side === 'left'
    ? `<leftPowerRail localId="${id}" width="3" height="40"><position x="0" y="0"/><connectionPointOut formalParameter=""><relPosition x="3" y="20"/></connectionPointOut></leftPowerRail>`
    : `<rightPowerRail localId="${id}" width="3" height="40"><position x="400" y="0"/><connectionPointIn><relPosition x="0" y="20"/>${connections(from)}</connectionPointIn></rightPowerRail>`

const connections = (from?: string) =>
  (from ?? '')
    .split(',')
    .filter((ref) => ref !== '')
    .map((ref) => {
      const [refLocalId, formalParameter] = ref.split('.')
      return formalParameter === undefined
        ? `<connection refLocalId="${refLocalId}"/>`
        : `<connection refLocalId="${refLocalId}" formalParameter="${formalParameter}"/>`
    })
    .join('')

const element = (tag: 'contact' | 'coil', id: string, name: string, from: string, y = 0) =>
  `<${tag} localId="${id}" negated="false" width="24" height="24"><position x="100" y="${y}"/><connectionPointIn><relPosition x="0" y="12"/>${connections(
    from,
  )}</connectionPointIn><connectionPointOut><relPosition x="24" y="12"/></connectionPointOut><variable>${name}</variable></${tag}>`

const inVariable = (id: string, expression: string) =>
  `<inVariable localId="${id}" width="80" height="32"><position x="0" y="0"/><connectionPointOut><relPosition x="80" y="16"/></connectionPointOut><expression>${expression}</expression></inVariable>`

const ctu = (from: string, extraInputs = '') =>
  `<block localId="20" typeName="CTU" instanceName="C1" width="66" height="140" executionOrderId="0"><position x="200" y="0"/><inputVariables><variable formalParameter="CU"><connectionPointIn><relPosition x="0" y="36"/>${connections(
    from,
  )}</connectionPointIn></variable>${extraInputs}</inputVariables><inOutVariables/><outputVariables><variable formalParameter="Q"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable></outputVariables></block>`

describe('parseLadderXml rebuilds the shapes the exporter flattens', () => {
  it('rebuilds an empty rung as a rail-to-rail wire', () => {
    const { body, warnings } = parseProgram(rail('left', '1') + rail('right', '2', '1.left-rail'))
    expect(warnings).toEqual([])
    const [rung] = body.rungs
    expect(rung.edges.map((e) => `${e.source}->${e.target}`)).toEqual([`left-rail-${rung.id}->right-rail-${rung.id}`])
  })

  it('nests a third branch under the parallel path, with the handles the editor uses there', () => {
    const { body, warnings } = parseProgram(
      rail('left', '1') +
        element('contact', '2', 'A', '1.left-rail', 0) +
        element('contact', '3', 'B', '1.left-rail', 50) +
        element('contact', '4', 'C', '1.left-rail', 100) +
        element('coil', '5', 'Y', '2.output,3.output,4.output') +
        rail('right', '6', '5.output'),
    )
    expect(warnings).toEqual([])
    const [rung] = body.rungs
    const [outerOpen, innerOpen, innerClose, outerClose] = rung.nodes.filter(isParallel)
    expect([outerOpen.data.type, innerOpen.data.type, innerClose.data.type, outerClose.data.type]).toEqual([
      'open',
      'open',
      'close',
      'close',
    ])
    const wiring = rung.edges.map((e) => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`)
    expect(wiring).toEqual(
      expect.arrayContaining([
        `${outerOpen.id}.output-right->CONTACT-2.input`,
        `${outerOpen.id}.output-down->${innerOpen.id}.input-top`,
        `${innerOpen.id}.output-right->CONTACT-3.input`,
        `${innerOpen.id}.output-down->CONTACT-4.input`,
        `${innerClose.id}.output-top->${outerClose.id}.input-down`,
        `${outerClose.id}.output-right->COIL-5.input`,
      ]),
    )
  })

  it('draws a plain function with its return pin first and no instance name', () => {
    const functionPou = `<pou name="DOUBLE" pouType="function"><interface><returnType><INT/></returnType><inputVars><variable name="X"><type><INT/></type></variable></inputVars></interface><body><ST><xhtml:p><![CDATA[DOUBLE := X * 2;]]></xhtml:p></ST></body></pou>`
    const project = parseXmlDocument(`<project><types><pous>${functionPou}</pous></types></project>`)
    const resolveBlock = createBlockSignatureResolver(
      parsePouHeadersXml(asRecord(asRecord(project.types).pous).pou),
      [],
      undefined,
    )
    const ld = parseXmlDocument(
      `<project><types><pous><pou name="main" pouType="program"><body><LD>${
        rail('left', '1') +
        `<block localId="7" typeName="DOUBLE" width="66" height="60" executionOrderId="0"><position x="100" y="0"/><inputVariables><variable formalParameter="EN"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="1" formalParameter="left-rail"/></connectionPointIn></variable></inputVariables><inOutVariables/><outputVariables><variable formalParameter="ENO"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable><variable formalParameter=""><connectionPointOut><relPosition x="66" y="76"/></connectionPointOut></variable></outputVariables></block>` +
        rail('right', '2', '7.ENO')
      }</LD></body></pou></pous></types></project>`,
    )
    const pou = asRecord(asRecord(asRecord(ld.types).pous).pou)
    const main = Array.isArray(pou) ? asRecord(pou[0]) : pou
    const { body, warnings } = parseLadderXml('main', asRecord(main.body).LD, { resolveBlock })
    expect(warnings).toEqual([])
    const block = blockIn(body.rungs[0])
    expect(block.data.variant.type).toBe('function')
    expect(block.data.variable).toEqual({ name: '' })
    expect(block.data.outputHandles.map((h) => h.id)).toEqual(['ENO', 'OUT'])
  })

  it.each([
    [
      'a variable box feeds a contact',
      rail('left', '1') +
        inVariable('9', 'TRUE') +
        element('contact', '2', 'A', '1.left-rail,9') +
        rail('right', '3', '2.output'),
      'a variable box is wired to something other than a block pin',
    ],
    [
      'a variable box feeds the pin the rung runs through',
      rail('left', '1') + inVariable('9', 'TRUE') + ctu('1.left-rail,9') + rail('right', '3', '20.Q'),
      'block "CTU" has a variable box on the pin the rung runs through',
    ],
    [
      'a variable box feeds a pin the block does not have',
      rail('left', '1') +
        inVariable('9', 'TRUE') +
        ctu(
          '1.left-rail',
          '<variable formalParameter="XYZ"><connectionPointIn><relPosition x="0" y="76"/><connection refLocalId="9"/></connectionPointIn></variable>',
        ) +
        rail('right', '3', '20.Q'),
      'block "CTU" has no pin "XYZ"',
    ],
    [
      'a coil hangs off a secondary output',
      rail('left', '1') +
        ctu('1.left-rail') +
        `<block localId="21" typeName="CTU" instanceName="C2" width="66" height="140" executionOrderId="0"><position x="300" y="0"/><inputVariables><variable formalParameter="CU"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="20" formalParameter="CV"/></connectionPointIn></variable></inputVariables><inOutVariables/><outputVariables><variable formalParameter="Q"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable></outputVariables></block>` +
        rail('right', '3', '21.Q'),
      'elements are wired to the secondary output "CV" of block "CTU"',
    ],
    [
      'a contact is fed from the right rail',
      rail('left', '1') + element('contact', '2', 'A', '1.left-rail,3') + rail('right', '3', '2.output'),
      'a connection runs into a power rail from the wrong side',
    ],
    [
      'a contact hangs off the rung',
      rail('left', '1') +
        element('contact', '2', 'A', '1.left-rail') +
        element('coil', '4', 'Y', '1.left-rail') +
        rail('right', '3', '4.output'),
      'the rung is not a series-parallel network from the left rail to the right rail',
    ],
  ])('keeps the XML layout when %s', (_case, ld, reason) => {
    const { warnings } = parseProgram(ld)
    expect(warnings).toEqual([`POU "main": rung 1 kept the layout from the XML, because ${reason}`])
  })
})

it('draws blocks from the XML pins when no signatures are supplied at all', () => {
  const project = parseXmlDocument(
    `<project><types><pous><pou name="main" pouType="program"><body><LD>${
      rail('left', '1') + ctu('1.left-rail') + rail('right', '3', '20.Q')
    }</LD></body></pou></pous></types></project>`,
  )
  const pou = asRecord(asRecord(project.types).pous).pou
  const main = Array.isArray(pou) ? asRecord(pou[0]) : {}
  const { warnings } = parseLadderXml('main', asRecord(main.body).LD)
  expect(warnings).toEqual([
    'POU "main": block type "CTU" is not defined in the project or its libraries, its pins were taken from the XML',
  ])
})

describe('parseLadderXml grows extensible library blocks to the inputs the XML names', () => {
  const systemLibraries = createTestStore().getState().libraries.system

  const extensibleBlock = (typeName: string, inputs: string[], feeds: string[]) => {
    const pins = inputs
      .map(
        (pin, i) =>
          `<variable formalParameter="${pin}"><connectionPointIn><relPosition x="0" y="${76 + 40 * i}"/>${connections(
            feeds[i],
          )}</connectionPointIn></variable>`,
      )
      .join('')
    return `<block localId="7" typeName="${typeName}" width="66" height="200" executionOrderId="0"><position x="100" y="0"/><inputVariables><variable formalParameter="EN"><connectionPointIn><relPosition x="0" y="36"/><connection refLocalId="1" formalParameter="left-rail"/></connectionPointIn></variable>${pins}</inputVariables><inOutVariables/><outputVariables><variable formalParameter="ENO"><connectionPointOut><relPosition x="66" y="36"/></connectionPointOut></variable><variable formalParameter=""><connectionPointOut><relPosition x="66" y="76"/></connectionPointOut></variable></outputVariables></block>`
  }

  const extensibleRung = (typeName: string, inputs: string[]) =>
    rail('left', '1') +
    inputs.map((_, i) => inVariable(String(30 + i), String(i + 1))).join('') +
    extensibleBlock(
      typeName,
      inputs,
      inputs.map((_, i) => String(30 + i)),
    ) +
    rail('right', '2', '7.ENO')

  const parseWithLibraries = (ld: string) => {
    const project = parseXmlDocument(
      `<project><types><pous><pou name="main" pouType="program"><body><LD>${ld}</LD></body></pou></pous></types></project>`,
    )
    const pou = asRecord(asRecord(project.types).pous).pou
    const main = Array.isArray(pou) ? asRecord(pou[0]) : {}
    const resolveBlock = createBlockSignatureResolver([], systemLibraries, undefined)
    return parseLadderXml('main', asRecord(main.body).LD, { resolveBlock })
  }

  it.each([
    ['ADD', ['IN1', 'IN2', 'IN3']],
    ['AND', ['IN1', 'IN2', 'IN3', 'IN4']],
    ['MUX', ['K', 'IN0', 'IN1', 'IN2']],
  ])('rebuilds %s wired on %j with every pin bound', (typeName, inputs) => {
    const { body, warnings } = parseWithLibraries(extensibleRung(typeName, inputs))
    expect(warnings).toEqual([])
    const block = blockIn(body.rungs[0])
    expect(block.data.variant.extensible).toBe(true)
    expect(block.data.inputHandles.map((h) => h.id)).toEqual(['EN', ...inputs])
    expect(block.data.connectedVariables.map((v) => v.handleId)).toEqual(inputs)
  })

  it('keeps the default inputs when the XML names fewer', () => {
    const { body } = parseWithLibraries(extensibleRung('ADD', ['IN1']))
    expect(blockIn(body.rungs[0]).data.inputHandles.map((h) => h.id)).toEqual(['EN', 'IN1', 'IN2'])
  })

  it('keeps every input of a block on a rung it cannot rebuild', () => {
    const { body, warnings } = parseWithLibraries(
      rail('left', '1') +
        element('contact', '5', 'X', '1.left-rail', 100) +
        inVariable('30', 'A') +
        inVariable('31', 'B') +
        extensibleBlock('ADD', ['IN1', 'IN2', 'IN3'], ['30', '31', '5.output']) +
        rail('right', '2', '7.ENO'),
    )
    expect(warnings).toEqual([
      'POU "main": rung 1 kept the layout from the XML, because elements are wired to the secondary input "IN3" of block "ADD"',
    ])
    const rungs = body.rungs.map((rung) => ({
      ...rung,
      nodes: rung.nodes.map((node) => ({ ...node, type: node.type ?? '' })),
    }))
    expect(emitLdBody({ rungs }).bodySt).toContain(
      'ADD(EN := TRUE, IN1 := A, IN2 := B, IN3 := X, ENO => _TMP_ADD7_ENO)',
    )
  })
})
