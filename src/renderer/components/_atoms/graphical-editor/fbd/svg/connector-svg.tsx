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
    <svg className={className} style={style} viewBox='0 0 152 48' xmlns='http://www.w3.org/2000/svg'>
      <path d='M24.6569 0C23.596 0 22.5786 0.421427 21.8284 1.17157L1.82843 21.1716C0.26633 22.7337 0.26633 25.2663 1.82843 26.8284L21.8284 46.8284C22.5786 47.5786 23.596 48 24.6569 48H147C149.209 48 151 46.2091 151 44V4C151 1.79086 149.209 0 147 0H24.6569Z' />
      {children}
    </svg>
  )
}
