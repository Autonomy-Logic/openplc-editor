import { useOpenPLCStore } from '../../../../store'

/** Human label for the badge, preferring the resolved plan slug over the legacy tier flag. */
function tierLabel(planSlug: string | null, tier: 'free' | 'pro'): string {
  if (planSlug && planSlug.length > 0) {
    return planSlug.charAt(0).toUpperCase() + planSlug.slice(1)
  }
  return tier === 'pro' ? 'Pro' : 'Free'
}

/** Plans that map to the free tier (no paid entitlement). */
const FREE_PLAN_SLUGS = new Set<string>(['community', 'education'])

/** Small pill next to the "AI Chat" title showing the user's current subscription tier. */
export const AITierBadge = () => {
  const { planSlug, tier } = useOpenPLCStore.useAi()
  const label = tierLabel(planSlug, tier)
  const isPaid = planSlug ? !FREE_PLAN_SLUGS.has(planSlug) : tier === 'pro'

  return (
    <span
      title={`Your plan: ${label}`}
      className={`select-none rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
        isPaid
          ? 'border-brand/30 bg-brand/10 border text-brand'
          : 'border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-400'
      }`}
    >
      {label}
    </span>
  )
}
