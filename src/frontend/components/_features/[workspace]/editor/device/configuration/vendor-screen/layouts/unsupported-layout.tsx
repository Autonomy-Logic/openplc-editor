type UnsupportedLayoutProps = {
  layoutType: string
}

function UnsupportedLayout({ layoutType }: UnsupportedLayoutProps) {
  return (
    <div className='rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-600 dark:text-neutral-400'>
      Layout type &quot;{layoutType}&quot; is not yet supported.
    </div>
  )
}

export { UnsupportedLayout }
