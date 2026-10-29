import { useOpenPLCStore } from '@root/frontend/store'

type DuplicateProtocolNoticeProps = {
  /** The server whose screen is showing; it is not its own sibling. */
  name: string
  protocol: string
}

/**
 * Names the other servers of this protocol, when a project carries any.
 *
 * Creating one is refused, so this only ever shows for a project that predates
 * the rule or was edited outside the editor. Until it is said here, the state
 * is only visible in the diagnostics panel and in the message that stops a
 * build — both of which the user reaches after the work, not before it.
 */
export const DuplicateProtocolNotice = ({ name, protocol }: DuplicateProtocolNoticeProps) => {
  const servers = useOpenPLCStore((state) => state.project.data.servers)
  const siblings = (servers ?? []).filter((server) => server.protocol === protocol && server.name !== name)
  if (siblings.length === 0) return null

  return (
    <p className='rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200'>
      This project holds another {protocol} server: {siblings.map((server) => server.name).join(', ')}. Only one of them
      reaches the device, and a build with more than one enabled is refused. Delete or switch off the ones you do not
      want.
    </p>
  )
}
