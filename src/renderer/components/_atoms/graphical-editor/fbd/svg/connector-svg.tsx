import React from 'react'

interface ConnectorSVGComponentProps {
  className?: string
  style?: React.CSSProperties
}

export const ConnectorSVGComponent = ({
  children,
  className,
  style,
}: ConnectorSVGComponentProps & React.PropsWithChildren) => {
  return (
    <svg className={className} style={style} viewBox='0 0 112 32' xmlns='http://www.w3.org/2000/svg'>
      <path d="M109 4C109 1.79086 107.209 0 105 0H22.2111C21.4214 0 20.6494 0.233752 19.9923 0.671799L1.9923 12.6718C-0.382632 14.2551 -0.382631 17.7449 1.9923 19.3282L19.9923 31.3282C20.6494 31.7662 21.4214 32 22.2111 32H105C107.209 32 109 30.2091 109 28V4Z" />
      {children}
    </svg>
  )
}
