import React from 'react'

interface ContinuationSVGComponentProps {
  className?: string
  style?: React.CSSProperties
}

export const ContinuationSVGComponent = ({
  children,
  className,
  style,
}: ContinuationSVGComponentProps & React.PropsWithChildren) => {
  return (
    <svg className={className} style={style} viewBox='0 0 112 32' xmlns='http://www.w3.org/2000/svg'>
      <path d="M0 4C0 1.79086 1.79086 0 4 0H86.7889C87.5786 0 88.3506 0.233752 89.0077 0.671799L107.008 12.6718C109.383 14.2551 109.383 17.7449 107.008 19.3282L89.0077 31.3282C88.3506 31.7662 87.5786 32 86.7889 32H4C1.79086 32 0 30.2091 0 28V4Z" />
      {children}
    </svg>
  )
}
