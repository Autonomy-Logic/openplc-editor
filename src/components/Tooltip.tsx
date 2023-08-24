import { cloneElement, FC, PropsWithChildren } from 'react'
import { PlacesType, Tooltip as ReactTooltip } from 'react-tooltip'
/**
 * Props for the Tooltip component.
 */
export type TooltipProps = {
  id: string
  label: string
  place?: PlacesType
}
/**
 * Tooltip component that wraps a child element with a tooltip.
 * @returns a JSX component with the tooltip.
 */
const Tooltip: FC<PropsWithChildren<TooltipProps>> = ({
  id,
  children,
  label,
  place,
}) => {
  return (
    <>
      {cloneElement(children as JSX.Element, {
        'data-tooltip-id': id,
        'data-tooltip-content': label,
      })}
      <ReactTooltip
        id={id}
        place={place}
        className="z-20 whitespace-nowrap rounded bg-white px-2 py-1 text-xs font-medium text-gray-500 shadow transition-opacity duration-300 dark:bg-gray-800 dark:text-gray-400"
      />
    </>
  )
}

export default Tooltip
