import { NavigationButton } from '../../../../../_atoms/navigation-button'
import { FieldHelpIcon } from '../../../../../_atoms/tooltip'

/** The look of a link to a board page in a group header. */
const boardScreenLinkStyles =
  'inline-flex items-center gap-1 font-caption text-xs font-medium text-brand-medium-dark hover:text-brand disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:text-neutral-600 dark:text-brand-light dark:hover:text-brand dark:disabled:text-neutral-700'

type BoardScreenLinkProps = {
  label: string
  /** The package's screen name; absent when the package ships no such page. */
  screen?: string
  /** Why the link is disabled, shown in a help icon when `screen` is absent. */
  reason: string
  onOpen: (screen: string) => void
  testId?: string
}

/**
 * A link to a board package's settings page. Disabled, with a help icon
 * carrying `reason`, when the package ships no such page. Needs a
 * `TooltipProvider` above it.
 */
const BoardScreenLink = ({ label, screen, reason, onOpen, testId }: BoardScreenLinkProps) => (
  <div className='flex items-center gap-1.5' data-testid={testId}>
    {screen ? (
      <NavigationButton onClick={() => onOpen(screen)} className={boardScreenLinkStyles}>
        {label}
        <span aria-hidden='true'>&#8599;</span>
      </NavigationButton>
    ) : (
      <button type='button' disabled className={boardScreenLinkStyles}>
        {label}
        <span aria-hidden='true'>&#8599;</span>
      </button>
    )}
    {screen ? null : <FieldHelpIcon text={reason} />}
  </div>
)

export { BoardScreenLink }
