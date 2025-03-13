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
    <svg className={className} style={style} viewBox='0 0 152 48' xmlns='http://www.w3.org/2000/svg'>
      <path d='M126.343 0C127.404 0 128.421 0.421427 129.172 1.17157L149.172 21.1716C150.734 22.7337 150.734 25.2663 149.172 26.8284L129.172 46.8284C128.421 47.5786 127.404 48 126.343 48H4C1.79086 48 0 46.2091 0 44V4C0 1.79086 1.79086 0 4 0H126.343Z' />
      {children}
    </svg>
  )
}
