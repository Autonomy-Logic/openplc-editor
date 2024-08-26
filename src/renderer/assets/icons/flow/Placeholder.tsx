type PlaceholderSVGType = {
  width?: number
  height?: number
  className?: string
}

export const PlaceholderNode = ({ width, height, className }: PlaceholderSVGType) => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width ?? 16}
      height={height ?? 16}
      className={className}
      fill='currentColor'
      viewBox='0 0 16 16'
    >
      <path d='M6.95.435c.58-.58 1.52-.58 2.1 0l6.515 6.516c.58.58.58 1.519 0 2.098L9.05 15.565c-.58.58-1.519.58-2.098 0L.435 9.05a1.48 1.48 0 0 1 0-2.098zm1.4.7a.495.495 0 0 0-.7 0L1.134 7.65a.495.495 0 0 0 0 .7l6.516 6.516a.495.495 0 0 0 .7 0l6.516-6.516a.495.495 0 0 0 0-.7L8.35 1.134z' />
    </svg>
  )
}

export const PlaceholderNodeFilled = ({ width, height, className }: PlaceholderSVGType) => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width ?? 16}
      height={height ?? 16}
      className={className}
      fill='currentColor'
      viewBox='0 0 16 16'
    >
      <path
        fillRule='evenodd'
        d='M6.95.435c.58-.58 1.52-.58 2.1 0l6.515 6.516c.58.58.58 1.519 0 2.098L9.05 15.565c-.58.58-1.519.58-2.098 0L.435 9.05a1.48 1.48 0 0 1 0-2.098z'
      />
    </svg>
  )
}
