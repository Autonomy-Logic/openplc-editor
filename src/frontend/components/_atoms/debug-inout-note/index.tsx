import { describeInOutLeaf } from '../../../utils/inout-force'

/**
 * The first line of a force menu opened on a function-block in-out: what the
 * in-out shows, and where a force goes (IEC 61131-3 §3.48 — an in-out is the
 * caller's variable). Renders nothing for an ordinary variable.
 */
const DebugInOutNote = ({ debugIndex }: { debugIndex: number | undefined }) => {
  const text = describeInOutLeaf(debugIndex)
  if (text === undefined) return null
  return (
    <p
      role='note'
      className='max-w-64 border-b border-neutral-200 px-2 py-1 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'
    >
      {text}
    </p>
  )
}

export { DebugInOutNote }
