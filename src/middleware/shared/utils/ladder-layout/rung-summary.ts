/** A rung node as the summary reads it: its type and its untyped data. */
export interface SummaryNode {
  type?: string
  data: Record<string, unknown>
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** The block's type name, from its variant. */
function blockName(node: SummaryNode): string {
  const variant = node.data.variant
  if (typeof variant === 'object' && variant !== null && 'name' in variant && typeof variant.name === 'string') {
    return variant.name
  }
  return 'block'
}

/** What a collapsed rung shows of its contents, as `"2 contacts · TON · 1 coil"`; empty for an empty rung. */
export function rungSummary(nodes: readonly SummaryNode[]): string {
  const contacts = nodes.filter((node) => node.type === 'contact').length
  const coils = nodes.filter((node) => node.type === 'coil').length
  const blocks = nodes.filter((node) => node.type === 'block').map(blockName)
  return [contacts > 0 ? plural(contacts, 'contact') : '', ...blocks, coils > 0 ? plural(coils, 'coil') : '']
    .filter((part) => part !== '')
    .join(' · ')
}

/** The first line of a rung comment, with an ellipsis when the comment has more lines. */
export function commentFirstLine(comment: string): string {
  const [first = '', ...rest] = comment.split('\n')
  return rest.some((line) => line.trim() !== '') ? `${first}…` : first
}
