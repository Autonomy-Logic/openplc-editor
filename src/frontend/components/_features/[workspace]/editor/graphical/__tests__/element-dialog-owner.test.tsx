import { buildBlockNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/buildNodes'
import { GraphicalEditor } from '@root/frontend/components/_features/[workspace]/editor/graphical'
import type { OpenPLCStore } from '@root/frontend/store'
import type { ModalTypes } from '@root/frontend/store/slices/modal'
import { cancelFlowWriteBacks } from '@root/frontend/store/slices/shared/flow-writeback'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import ctudRung from '@root/frontend/utils/PLC/xml-generator/old-editor/language/__tests__/fixtures/ctud-parallel-output-rung.json'
import { zodRungLadderStateSchema } from '@root/middleware/shared/ports/flow-schemas'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Node } from '@xyflow/react'

type Language = 'ld' | 'fbd'

const LADDER_POUS = ['lda', 'ldb'] as const
const FBD_POUS = ['fbda', 'fbdb'] as const

const CONTACT_TITLE = 'Edit Contact Values'
const COIL_TITLE = 'Edit Coil Values'
const BLOCK_TITLE = 'Block Properties'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const isContact = (node: Node) => node.type === 'contact' && node.data.variant === 'default'
const isCoil = (node: Node) => node.type === 'coil' && node.data.variant === 'set'
const isBlock = (node: Node) => node.type === 'block'

/** Minimal stand-in for the DOMMatrixReadOnly xyflow reads when it measures nodes; jsdom has none. */
class DOMMatrixReadOnlyStub {
  readonly m22 = 1
}

/** No-op stand-in for the `Element.scrollTo` the ladder editor calls on mount; jsdom has none. */
function scrollToStub(): void {}

let installedMatrixStub = false
let installedScrollToStub = false

beforeAll(() => {
  if (!('DOMMatrixReadOnly' in window)) {
    Object.defineProperty(window, 'DOMMatrixReadOnly', {
      value: DOMMatrixReadOnlyStub,
      configurable: true,
      writable: true,
    })
    installedMatrixStub = true
  }
  if (typeof Element.prototype.scrollTo !== 'function') {
    Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollToStub, configurable: true, writable: true })
    installedScrollToStub = true
  }
})

afterEach(() => {
  cleanup()
  cancelFlowWriteBacks()
})

/** Resolves after the next animation frame, once the node measurements xyflow queued have run. */
const nextFrame = () =>
  typeof requestAnimationFrame === 'function'
    ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    : Promise.resolve()

afterAll(async () => {
  await nextFrame()
  if (installedMatrixStub) Reflect.deleteProperty(window, 'DOMMatrixReadOnly')
  if (installedScrollToStub) Reflect.deleteProperty(Element.prototype, 'scrollTo')
})

/** The CTUD fixture rung (contacts, coils and a CTUD block) with every id made unique to `pou`. */
function ladderRungFor(pou: string): RungLadderState {
  const json: unknown = JSON.parse(JSON.stringify(ctudRung).replace(UUID, (id) => `${id}-${pou}`))
  const rung = zodRungLadderStateSchema.parse(json)
  return { ...rung, nodes: rung.nodes.map((node) => ({ ...node, data: node.data })), selectedNodes: [] }
}

/** A TON block from the seeded system libraries, placed with the production builder. */
function fbdBlockFor(store: OpenPLCStore, pou: string): Node {
  const ton = store
    .getState()
    .libraries.system.flatMap((library) => library.pous)
    .find((libraryPou) => libraryPou.name === 'TON' && libraryPou.type === 'function-block')
  if (!ton) throw new Error('TON is missing from the seeded system libraries')
  return buildBlockNode({ id: `BLOCK_${pou}`, position: { x: 200, y: 100 }, variant: ton })
}

/** A store with one program per name, each with its graphical body seeded and its tab open. */
function storeWith(language: Language, names: readonly string[]): OpenPLCStore {
  const store = createTestStore()
  for (const name of names) {
    const created = store.getState().pouActions.create({ type: 'program', name, language })
    if (!created.ok) throw new Error(`could not create ${name}: ${created.message ?? ''}`)
    if (language === 'ld') {
      store.getState().ladderFlowActions.setRungs({ editorName: name, rungs: [ladderRungFor(name)] })
      store.getState().ladderFlowActions.setFlowUpdated({ editorName: name, updated: false })
    } else {
      store.getState().fbdFlowActions.setNodes({ editorName: name, nodes: [fbdBlockFor(store, name)] })
      store.getState().fbdFlowActions.setFlowUpdated({ editorName: name, updated: false })
    }
  }
  return store
}

/** Mounts one graphical editor per POU, as the workspace does for every open tab; the last one is active. */
function renderEditors(store: OpenPLCStore, language: Language, names: readonly string[]): void {
  const active = names[names.length - 1]
  render(
    <>
      {names.map((name) => (
        <GraphicalEditor key={name} name={name} language={language} isActive={name === active} />
      ))}
    </>,
    { wrapper: createStoreWrapper(store, createTestPorts({ capabilities: EDITOR_CAPABILITIES })) },
  )
}

function setup(language: Language, names: readonly string[]): OpenPLCStore {
  const store = storeWith(language, names)
  renderEditors(store, language, names)
  return store
}

const ladderFlowOf = (store: OpenPLCStore, pou: string) =>
  store.getState().ladderFlows.find((flow) => flow.name === pou)

const fbdFlowOf = (store: OpenPLCStore, pou: string) => store.getState().fbdFlows.find((flow) => flow.name === pou)

const ladderNodesOf = (store: OpenPLCStore, pou: string): Node[] =>
  ladderFlowOf(store, pou)?.rungs.flatMap((rung) => rung.nodes) ?? []

const fbdNodesOf = (store: OpenPLCStore, pou: string): Node[] => fbdFlowOf(store, pou)?.rung.nodes ?? []

function nodeOf(nodes: Node[], match: (node: Node) => boolean, pou: string): Node {
  const node = nodes.find(match)
  if (!node) throw new Error(`no matching node in ${pou}`)
  return node
}

const titles = (title: string) => screen.queryAllByText(title, { exact: true })

/** The dialog holding the only `title` on screen. */
function dialogTitled(title: string): HTMLElement {
  const found = titles(title)
  if (found.length !== 1) throw new Error(`expected one "${title}" dialog, found ${found.length}`)
  const dialog = found[0].closest('[role="dialog"]')
  if (!(dialog instanceof HTMLElement)) throw new Error(`"${title}" is not inside a dialog`)
  return dialog
}

/** Double-clicks the canvas node the way a user opens its dialog. */
const doubleClickNode = (id: string) => fireEvent.doubleClick(screen.getByTestId(`rf__node-${id}`))

const switchExecutionControlOn = (dialog: HTMLElement) => {
  const toggle = dialog.querySelector('#executionControlSwitch')
  if (!(toggle instanceof HTMLElement)) throw new Error('no execution control switch')
  fireEvent.click(toggle)
}

const pressButton = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole('button', { name }))

const otherOf = (pous: readonly string[], pou: string) => pous.filter((name) => name !== pou)[0]

describe('the element dialog opened by a double-click records the POU whose editor owns the node', () => {
  it.each<[ModalTypes, string, (node: Node) => boolean]>([
    ['contact-ladder-element', 'contact', isContact],
    ['coil-ladder-element', 'coil', isCoil],
    ['block-ladder-element', 'block', isBlock],
  ])('%s carries { pouName, node } for the %s of the first ladder POU', (type, _element, match) => {
    const store = setup('ld', LADDER_POUS)
    const node = nodeOf(ladderNodesOf(store, 'lda'), match, 'lda')

    doubleClickNode(node.id)

    expect(store.getState().modals[type]).toEqual({
      open: true,
      data: { pouName: 'lda', node: expect.objectContaining({ id: node.id }) },
    })
  })

  it('block-fbd-element carries { pouName, node } for the block of the first FBD POU', () => {
    const store = setup('fbd', FBD_POUS)

    doubleClickNode('BLOCK_fbda')

    expect(store.getState().modals['block-fbd-element']).toEqual({
      open: true,
      data: { pouName: 'fbda', node: expect.objectContaining({ id: 'BLOCK_fbda' }) },
    })
  })
})

describe('with two ladder POUs open, each element dialog renders once and edits the POU that owns the node', () => {
  it.each(LADDER_POUS)('the contact dialog of %s applies a new modifier to that contact only', (pou) => {
    const store = setup('ld', LADDER_POUS)
    const contact = nodeOf(ladderNodesOf(store, pou), isContact, pou)
    const other = otherOf(LADDER_POUS, pou)
    const otherFlow = ladderFlowOf(store, other)

    doubleClickNode(contact.id)
    expect(titles(CONTACT_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(CONTACT_TITLE)
    fireEvent.click(within(dialog).getByText('negated', { exact: true }))
    pressButton(dialog, 'Confirm')

    expect({
      dialogs: titles(CONTACT_TITLE).length,
      variant: ladderNodesOf(store, pou).find((node) => node.id === contact.id)?.data.variant,
      otherFlow: ladderFlowOf(store, other),
    }).toEqual({ dialogs: 0, variant: 'negated', otherFlow })
  })

  it.each(LADDER_POUS)('the coil dialog of %s applies a new modifier to that coil only', (pou) => {
    const store = setup('ld', LADDER_POUS)
    const coil = nodeOf(ladderNodesOf(store, pou), isCoil, pou)
    const other = otherOf(LADDER_POUS, pou)
    const otherFlow = ladderFlowOf(store, other)

    doubleClickNode(coil.id)
    expect(titles(COIL_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(COIL_TITLE)
    fireEvent.click(within(dialog).getByText('negated', { exact: true }))
    pressButton(dialog, 'Confirm')

    expect({
      dialogs: titles(COIL_TITLE).length,
      variant: ladderNodesOf(store, pou).find((node) => node.id === coil.id)?.data.variant,
      otherFlow: ladderFlowOf(store, other),
    }).toEqual({ dialogs: 0, variant: 'negated', otherFlow })
  })

  it.each(LADDER_POUS)('the block dialog of %s switches execution control on for that block only', (pou) => {
    const store = setup('ld', LADDER_POUS)
    const block = nodeOf(ladderNodesOf(store, pou), isBlock, pou)
    const other = otherOf(LADDER_POUS, pou)
    const otherFlow = ladderFlowOf(store, other)

    doubleClickNode(block.id)
    expect(titles(BLOCK_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(BLOCK_TITLE)
    switchExecutionControlOn(dialog)
    pressButton(dialog, 'Ok')

    expect({
      dialogs: titles(BLOCK_TITLE).length,
      executionControl: ladderNodesOf(store, pou).find(isBlock)?.data.executionControl,
      otherFlow: ladderFlowOf(store, other),
    }).toEqual({ dialogs: 0, executionControl: true, otherFlow })
  })
})

describe('with two FBD POUs open, the block dialog renders once and edits the POU that owns the block', () => {
  it.each(FBD_POUS)('the block dialog of %s switches execution control on for that block only', (pou) => {
    const store = setup('fbd', FBD_POUS)
    const other = otherOf(FBD_POUS, pou)
    const otherFlow = fbdFlowOf(store, other)

    doubleClickNode(`BLOCK_${pou}`)
    expect(titles(BLOCK_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(BLOCK_TITLE)
    switchExecutionControlOn(dialog)
    pressButton(dialog, 'Ok')

    expect({
      dialogs: titles(BLOCK_TITLE).length,
      executionControl: fbdNodesOf(store, pou).find(isBlock)?.data.executionControl,
      otherFlow: fbdFlowOf(store, other),
    }).toEqual({ dialogs: 0, executionControl: true, otherFlow })
  })
})

describe('an element dialog opened from the store renders only in the editor its payload names', () => {
  it.each<[ModalTypes, string, (node: Node) => boolean]>([
    ['contact-ladder-element', CONTACT_TITLE, isContact],
    ['coil-ladder-element', COIL_TITLE, isCoil],
    ['block-ladder-element', BLOCK_TITLE, isBlock],
  ])('%s with a payload for the second ladder POU renders one "%s" dialog', (type, title, match) => {
    const store = setup('ld', LADDER_POUS)
    const node = nodeOf(ladderNodesOf(store, 'ldb'), match, 'ldb')

    act(() => store.getState().modalActions.openModal(type, { pouName: 'ldb', node }))

    expect(titles(title)).toHaveLength(1)
  })

  it('block-fbd-element with a payload for the second FBD POU renders one dialog', () => {
    const store = setup('fbd', FBD_POUS)
    const node = nodeOf(fbdNodesOf(store, 'fbdb'), isBlock, 'fbdb')

    act(() => store.getState().modalActions.openModal('block-fbd-element', { pouName: 'fbdb', node }))

    expect(titles(BLOCK_TITLE)).toHaveLength(1)
  })

  it('renders no dialog for a payload naming a POU that has no open editor', () => {
    const store = setup('ld', LADDER_POUS)
    const node = nodeOf(ladderNodesOf(store, 'lda'), isContact, 'lda')

    act(() => store.getState().modalActions.openModal('contact-ladder-element', { pouName: 'ldc', node }))

    expect(titles(CONTACT_TITLE)).toHaveLength(0)
  })

  it('renders no dialog for a bare node without pouName, the payload shape the openers used to send', () => {
    const store = setup('ld', LADDER_POUS)
    const node = nodeOf(ladderNodesOf(store, 'lda'), isContact, 'lda')

    act(() => store.getState().modalActions.openModal('contact-ladder-element', node))

    expect(titles(CONTACT_TITLE)).toHaveLength(0)
  })
})

describe('with one POU open, the element dialogs open, apply and close as before', () => {
  it('the contact dialog applies a new modifier and closes', () => {
    const store = setup('ld', ['lda'])
    const contact = nodeOf(ladderNodesOf(store, 'lda'), isContact, 'lda')

    doubleClickNode(contact.id)
    expect(titles(CONTACT_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(CONTACT_TITLE)
    fireEvent.click(within(dialog).getByText('negated', { exact: true }))
    pressButton(dialog, 'Confirm')

    expect({
      dialogs: titles(CONTACT_TITLE).length,
      variant: ladderNodesOf(store, 'lda').find((node) => node.id === contact.id)?.data.variant,
    }).toEqual({ dialogs: 0, variant: 'negated' })
  })

  it('the ladder block dialog switches execution control on and closes', () => {
    const store = setup('ld', ['lda'])
    const block = nodeOf(ladderNodesOf(store, 'lda'), isBlock, 'lda')

    doubleClickNode(block.id)
    expect(titles(BLOCK_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(BLOCK_TITLE)
    switchExecutionControlOn(dialog)
    pressButton(dialog, 'Ok')

    expect({
      dialogs: titles(BLOCK_TITLE).length,
      executionControl: ladderNodesOf(store, 'lda').find(isBlock)?.data.executionControl,
    }).toEqual({ dialogs: 0, executionControl: true })
  })

  it('the FBD block dialog switches execution control on and closes', () => {
    const store = setup('fbd', ['fbda'])

    doubleClickNode('BLOCK_fbda')
    expect(titles(BLOCK_TITLE)).toHaveLength(1)

    const dialog = dialogTitled(BLOCK_TITLE)
    switchExecutionControlOn(dialog)
    pressButton(dialog, 'Ok')

    expect({
      dialogs: titles(BLOCK_TITLE).length,
      executionControl: fbdNodesOf(store, 'fbda').find(isBlock)?.data.executionControl,
    }).toEqual({ dialogs: 0, executionControl: true })
  })
})
