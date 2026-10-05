/** One fact in a status screen's header: a small caps label over its value. */
const InfoField = ({ label, value }: { label: string; value?: string | null }) => (
  <div className='flex flex-col'>
    <dt className='text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>{label}</dt>
    <dd className='text-sm text-neutral-900 dark:text-neutral-100'>{value || '—'}</dd>
  </div>
)

export { InfoField }
