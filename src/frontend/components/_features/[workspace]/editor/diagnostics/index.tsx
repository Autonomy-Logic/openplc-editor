import { useIoDiagnostics } from '@root/frontend/hooks/use-io-diagnostics'
import type {
  IoDiagnostics,
  IoDiagnosticsArea,
  IoDiagnosticsLocated,
  IoDiagnosticsServer,
} from '@root/frontend/services/io-diagnostics'
import { cn } from '@root/frontend/utils/cn'
import { useCapabilities } from '@root/middleware/shared/providers'
import { useState } from 'react'

/**
 * Developer panel: what a build would size this project's I/O image to.
 *
 * Reads the compile pipeline's own sizer on every store change, so the effect
 * of a parameter is visible while the parameter is still under the cursor
 * instead of one toolchain run later. Read-only by construction — it renders a
 * derived snapshot and owns no state but which section is open.
 */
const DiagnosticsEditor = () => {
  const capabilities = useCapabilities()
  const diagnostics = useIoDiagnostics()

  // The gate lives HERE and not only at the two entry points, because a gate a
  // caller can forget is not a guarantee. The menus are the only ways in today;
  // this is what makes a third one impossible to add by accident.
  if (!capabilities.isDevMode) return null

  return (
    <div className='flex h-full w-full select-text flex-col overflow-auto p-8'>
      <header className='mb-6'>
        <h2 className='text-xl font-semibold text-neutral-1000 dark:text-white'>I/O Image Diagnostics</h2>
        <p className='mt-1 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400'>
          What the compiler would size this project to, computed from the same functions the build runs. Developer
          tooling — it changes nothing and is not part of a release build.
        </p>
      </header>

      <div className='flex max-w-5xl flex-col gap-6'>
        <TargetCard diagnostics={diagnostics} />
        <Section title='I/O image' subtitle='Every table, in the unit its addresses use'>
          <AreaTable areas={diagnostics.areas} />
        </Section>
        <Section
          title={`Located declarations (${diagnostics.located.length})`}
          subtitle='Every VAR … AT in the project, against the compile gate'
        >
          <LocatedTable located={diagnostics.located} />
        </Section>
        <Section title={`Servers (${diagnostics.servers.length})`} subtitle='What each one contributes, and whether'>
          <ServerTable servers={diagnostics.servers} />
        </Section>
        <Section
          title={`Producer claims (${diagnostics.claims.length})`}
          subtitle='Every address a producer took, and which one took it'
        >
          <ClaimTable diagnostics={diagnostics} />
        </Section>
        <Section title='Emitted files' subtitle='image.conf and the defines.h process-image block, verbatim'>
          <Artifacts diagnostics={diagnostics} />
        </Section>
      </div>
    </div>
  )
}

const CELL = 'px-3 py-1.5 text-left align-top'
const HEAD = 'px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500'
const MONO = 'font-mono text-xs'
const TABLE = 'w-full border-collapse text-sm text-neutral-800 dark:text-neutral-200'
const ROW = 'border-t border-neutral-200 dark:border-neutral-800'

/** Collapsible, because five tables at once is a wall and only one of them is
 *  usually the question. */
const Section = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(true)
  return (
    <section className='rounded-md border border-neutral-200 dark:border-neutral-800'>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-baseline gap-2 px-4 py-3 text-left'
      >
        <span className='text-sm font-semibold text-neutral-1000 dark:text-white'>{title}</span>
        <span className='text-xs text-neutral-500'>{subtitle}</span>
        <span className='ml-auto text-xs text-neutral-500'>{open ? '−' : '+'}</span>
      </button>
      {open && <div className='overflow-x-auto px-4 pb-4'>{children}</div>}
    </section>
  )
}

const TargetCard = ({ diagnostics: { target } }: { diagnostics: IoDiagnostics }) => (
  <section className='rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800'>
    <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
      <span className='text-sm font-semibold text-neutral-1000 dark:text-white'>{target.board || '(no board)'}</span>
      <span className={cn(MONO, 'text-neutral-500')}>{target.kind}</span>
      {!target.resolved && <Badge tone='warn'>board did not resolve — producers left permissive</Badge>}
      {!target.sizesTheImage && <Badge tone='warn'>not sized on this target</Badge>}
    </div>
    <dl className='mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs'>
      <dt className='text-neutral-500'>producers active</dt>
      <dd className={cn(MONO, 'text-neutral-800 dark:text-neutral-200')}>
        {target.activeProducers.join(', ') || 'none'}
      </dd>
      <dt className='text-neutral-500'>producers off</dt>
      <dd className={cn(MONO, 'text-neutral-500')}>{target.inactiveProducers.join(', ') || 'none'}</dd>
    </dl>
  </section>
)

const AreaTable = ({ areas }: { areas: IoDiagnosticsArea[] }) => (
  <table className={TABLE}>
    <thead>
      <tr>
        <th className={HEAD}>Table</th>
        <th className={HEAD}>Prefix</th>
        <th className={HEAD}>Size</th>
        <th className={HEAD}>Unit</th>
        <th className={HEAD}>Sized by</th>
        <th className={HEAD}>Bare-metal macro</th>
      </tr>
    </thead>
    <tbody>
      {areas.map((area) => (
        <tr key={area.prefix} className={cn(ROW, !area.present && 'opacity-50')}>
          <td className={cn(CELL, MONO)}>{area.table}</td>
          <td className={cn(CELL, MONO)}>{area.prefix}</td>
          <td className={cn(CELL, MONO, area.size > 0 && 'font-semibold')}>{area.present ? area.size : '—'}</td>
          <td className={CELL}>{area.unit}</td>
          <td className={CELL}>
            {area.present ? (area.origin ?? '—') : <span className='text-neutral-500'>area absent here</span>}
          </td>
          <td className={cn(CELL, MONO, 'text-neutral-500')}>{area.macro ?? '—'}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const ISSUE_LABEL: Record<NonNullable<IoDiagnosticsLocated['issue']>, string> = {
  unbacked: 'nothing produces this address',
  unsupported: 'this target has no such area',
  'duplicate-output': 'two writers on this output',
}

const LocatedTable = ({ located }: { located: IoDiagnosticsLocated[] }) => {
  if (located.length === 0) return <Empty>No located declarations in this project.</Empty>
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <th className={HEAD}>Scope</th>
          <th className={HEAD}>Name</th>
          <th className={HEAD}>Location</th>
          <th className={HEAD}>Slots</th>
          <th className={HEAD}>Verdict</th>
        </tr>
      </thead>
      <tbody>
        {located.map((variable) => (
          <tr key={`${variable.scope}/${variable.name}`} className={ROW}>
            <td className={CELL}>{variable.scope}</td>
            <td className={cn(CELL, MONO)}>{variable.name}</td>
            <td className={cn(CELL, MONO)}>{variable.location}</td>
            <td className={cn(CELL, MONO)}>{variable.slots}</td>
            <td className={CELL}>
              {variable.issue ? <Badge tone='error'>{ISSUE_LABEL[variable.issue]}</Badge> : <Badge tone='ok'>ok</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const ServerTable = ({ servers }: { servers: IoDiagnosticsServer[] }) => {
  if (servers.length === 0) return <Empty>This project declares no servers.</Empty>
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <th className={HEAD}>Name</th>
          <th className={HEAD}>Protocol</th>
          <th className={HEAD}>Enabled</th>
          <th className={HEAD}>Target runs it</th>
          <th className={HEAD}>Sizes the image</th>
        </tr>
      </thead>
      <tbody>
        {servers.map((server) => (
          <tr key={`${server.protocol}/${server.name}`} className={ROW}>
            <td className={CELL}>{server.name}</td>
            <td className={cn(CELL, MONO)}>{server.protocol}</td>
            <td className={CELL}>{server.enabled ? 'yes' : 'no'}</td>
            <td className={CELL}>{server.runs ? 'yes' : 'no'}</td>
            <td className={CELL}>
              {/* Three separate answers on purpose: a disabled Modbus server
                  still sizes the image, and OPC UA never does. */}
              {!server.dispatched ? (
                <Badge tone='muted'>never — this protocol is not sized</Badge>
              ) : server.sizes ? (
                'yes'
              ) : (
                <Badge tone='muted'>no — another server of this protocol is read</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const ClaimTable = ({ diagnostics }: { diagnostics: IoDiagnostics }) => {
  const { claims, conflicts } = diagnostics
  if (claims.length === 0) return <Empty>No producer on this target claims an address.</Empty>
  const conflicting = new Set(conflicts.map((conflict) => conflict.address))
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <th className={HEAD}>Address</th>
          <th className={HEAD}>Producer</th>
          <th className={HEAD}>Source</th>
          <th className={HEAD}>Alias</th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={`${claim.kind}/${claim.ref}/${claim.address}`} className={ROW}>
            <td className={cn(CELL, MONO)}>
              {claim.address}
              {conflicting.has(claim.address) && <Badge tone='error'>claimed twice</Badge>}
            </td>
            <td className={cn(CELL, MONO)}>{claim.kind}</td>
            <td className={cn(CELL, MONO, 'text-neutral-500')}>{claim.ref}</td>
            <td className={cn(CELL, MONO)}>{claim.alias || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const Artifacts = ({ diagnostics: { artifacts } }: { diagnostics: IoDiagnostics }) => (
  <div className='flex flex-col gap-4'>
    <Listing title='conf/image.conf' body={artifacts.imageConf} />
    <Listing
      title='defines.h — process image'
      body={artifacts.processImageDefines}
      empty='Not emitted for this target.'
    />
  </div>
)

const Listing = ({ title, body, empty }: { title: string; body: string; empty?: string }) => (
  <div>
    <p className={cn(MONO, 'mb-1 text-neutral-500')}>{title}</p>
    <pre className='overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'>
      {body === '' ? (empty ?? '') : body}
    </pre>
  </div>
)

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className='py-2 text-sm text-neutral-500'>{children}</p>
)

const TONES = {
  ok: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400',
  muted: 'text-neutral-500',
}

const Badge = ({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) => (
  <span className={cn('ml-1 text-xs font-medium', TONES[tone])}>{children}</span>
)

export { DiagnosticsEditor }
