const MinimizeIcon = () => {
  return (
    <svg width='12' height='2' viewBox='0 0 16 2' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <title>Minimize</title>
      <path d='M1 1H15' stroke='white' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

const MaximizeIcon = () => {
  return (
    <svg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <title>Maximize</title>
      <path
        d='M1 14V2C1 1.44772 1.44772 1 2 1H14C14.5523 1 15 1.44772 15 2V14C15 14.5523 14.5523 15 14 15H2C1.44772 15 1 14.5523 1 14Z'
        stroke='white'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  )
}

const CloseIcon = () => {
  return (
    <svg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <title>Close</title>
      <path d='M1 1L15 15M1 15L15 1' stroke='white' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

export { CloseIcon, MaximizeIcon, MinimizeIcon }
