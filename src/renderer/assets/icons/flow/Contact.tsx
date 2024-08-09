type ContactSVGType = {
  width?: number
  height?: number
  strokeClassName?: string
}

export const DefaultContact = ({ strokeClassName, width, height }: ContactSVGType) => {
  return (
    <svg
      width={width ?? '28'}
      height={height ?? '28'}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <line x1='26.75' x2='26.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <line x1='0.75' x2='0.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
    </svg>
  )
}

export const NegatedContact = ({ strokeClassName, width, height }: ContactSVGType) => {
  return (
    <svg
      width={width ?? '28'}
      height={height ?? '28'}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <line x1='26.75' x2='26.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <line x1='0.75' x2='0.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <line
        y1='-0.75'
        x2='26'
        y2='-0.75'
        transform='matrix(0.707107 -0.707107 0.763407 0.645917 5 23.3848)'
        stroke='#0464FB'
        stroke-width='1.5'
      />
    </svg>
  )
}

export const RisingEdgeContact = ({ strokeClassName, width, height }: ContactSVGType) => {
  return (
    <svg
      width={width ?? '28'}
      height={height ?? '28'}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <line x1='26.75' x2='26.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <line x1='0.75' x2='0.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <path
        d='M11.0568 18V9.27273H14.0057C14.6903 9.27273 15.25 9.39631 15.6847 9.64347C16.1222 9.88778 16.446 10.2188 16.6562 10.6364C16.8665 11.054 16.9716 11.5199 16.9716 12.0341C16.9716 12.5483 16.8665 13.0156 16.6562 13.4361C16.4489 13.8565 16.1278 14.1918 15.6932 14.4418C15.2585 14.6889 14.7017 14.8125 14.0227 14.8125H11.9091V13.875H13.9886C14.4574 13.875 14.8338 13.794 15.1179 13.6321C15.402 13.4702 15.608 13.2514 15.7358 12.9759C15.8665 12.6974 15.9318 12.3835 15.9318 12.0341C15.9318 11.6847 15.8665 11.3722 15.7358 11.0966C15.608 10.821 15.4006 10.6051 15.1136 10.4489C14.8267 10.2898 14.446 10.2102 13.9716 10.2102H12.1136V18H11.0568Z'
        fill='#0464FB'
      />
    </svg>
  )
}

export const FallingEdgeContact = ({ strokeClassName, width, height }: ContactSVGType) => {
  return (
    <svg
      width={width ?? '28'}
      height={height ?? '28'}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <line x1='26.75' x2='26.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <line x1='0.75' x2='0.75' y2='28' stroke='#030303' className={strokeClassName} stroke-width='1.5' />
      <path
        d='M16.9773 9.27273V18H15.9545L11.1989 11.1477H11.1136V18H10.0568V9.27273H11.0795L15.8523 16.142H15.9375V9.27273H16.9773Z'
        fill='#0464FB'
      />
    </svg>
  )
}
