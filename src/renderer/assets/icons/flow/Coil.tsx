type CoilSVGProps = {
  width?: number
  height?: number
  parenthesesClassName?: string
}

export const DefaultCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
    </svg>
  )
}

export const NegatedCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <line
        y1='-1'
        x2='20'
        y2='-1'
        transform='matrix(0.707107 -0.707107 0.763407 0.645917 11 21.1426)'
        stroke='#0464FB'
        stroke-width='2'
      />
    </svg>
  )
}

export const SetCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M18.8295 11.4545C18.7784 11.0227 18.571 10.6875 18.2074 10.4489C17.8438 10.2102 17.3977 10.0909 16.8693 10.0909C16.483 10.0909 16.1449 10.1534 15.8551 10.2784C15.5682 10.4034 15.3438 10.5753 15.1818 10.794C15.0227 11.0128 14.9432 11.2614 14.9432 11.5398C14.9432 11.7727 14.9986 11.973 15.1094 12.1406C15.223 12.3054 15.3679 12.4432 15.544 12.554C15.7202 12.6619 15.9048 12.7514 16.098 12.8224C16.2912 12.8906 16.4688 12.946 16.6307 12.9886L17.517 13.2273C17.7443 13.2869 17.9972 13.3693 18.2756 13.4744C18.5568 13.5795 18.8253 13.723 19.081 13.9048C19.3395 14.0838 19.5526 14.3139 19.7202 14.5952C19.8878 14.8764 19.9716 15.2216 19.9716 15.6307C19.9716 16.1023 19.848 16.5284 19.6009 16.9091C19.3565 17.2898 18.9986 17.5923 18.527 17.8168C18.0582 18.0412 17.4886 18.1534 16.8182 18.1534C16.1932 18.1534 15.652 18.0526 15.1946 17.8509C14.7401 17.6491 14.3821 17.3679 14.1207 17.0071C13.8622 16.6463 13.7159 16.2273 13.6818 15.75H14.7727C14.8011 16.0795 14.9119 16.3523 15.1051 16.5682C15.3011 16.7812 15.5483 16.9403 15.8466 17.0455C16.1477 17.1477 16.4716 17.1989 16.8182 17.1989C17.2216 17.1989 17.5838 17.1335 17.9048 17.0028C18.2259 16.8693 18.4801 16.6847 18.6676 16.4489C18.8551 16.2102 18.9489 15.9318 18.9489 15.6136C18.9489 15.3239 18.8679 15.0881 18.706 14.9062C18.544 14.7244 18.331 14.5767 18.0668 14.4631C17.8026 14.3494 17.517 14.25 17.2102 14.1648L16.1364 13.858C15.4545 13.6619 14.9148 13.3821 14.517 13.0185C14.1193 12.6548 13.9205 12.179 13.9205 11.5909C13.9205 11.1023 14.0526 10.6761 14.3168 10.3125C14.5838 9.94602 14.9418 9.66193 15.3906 9.46023C15.8423 9.25568 16.3466 9.15341 16.9034 9.15341C17.4659 9.15341 17.9659 9.25426 18.4034 9.45597C18.8409 9.65483 19.1875 9.92756 19.4432 10.2741C19.7017 10.6207 19.8381 11.0142 19.8523 11.4545H18.8295Z'
        fill='#0464FB'
      />
    </svg>
  )
}

export const ResetCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M14.0568 18V9.27273H17.0057C17.6875 9.27273 18.2472 9.3892 18.6847 9.62216C19.1222 9.85227 19.446 10.169 19.6562 10.5724C19.8665 10.9759 19.9716 11.4347 19.9716 11.9489C19.9716 12.4631 19.8665 12.919 19.6562 13.3168C19.446 13.7145 19.1236 14.027 18.6889 14.2543C18.2543 14.4787 17.6989 14.5909 17.0227 14.5909H14.6364V13.6364H16.9886C17.4545 13.6364 17.8295 13.5682 18.1136 13.4318C18.4006 13.2955 18.608 13.1023 18.7358 12.8523C18.8665 12.5994 18.9318 12.2983 18.9318 11.9489C18.9318 11.5994 18.8665 11.294 18.7358 11.0327C18.6051 10.7713 18.3963 10.5696 18.1094 10.4276C17.8224 10.2827 17.4432 10.2102 16.9716 10.2102H15.1136V18H14.0568ZM18.1648 14.0795L20.3125 18H19.0852L16.9716 14.0795H18.1648Z'
        fill='#0464FB'
      />
    </svg>
  )
}

export const RisingEdgeCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M14.0568 18V9.27273H17.0057C17.6903 9.27273 18.25 9.39631 18.6847 9.64347C19.1222 9.88778 19.446 10.2188 19.6562 10.6364C19.8665 11.054 19.9716 11.5199 19.9716 12.0341C19.9716 12.5483 19.8665 13.0156 19.6562 13.4361C19.4489 13.8565 19.1278 14.1918 18.6932 14.4418C18.2585 14.6889 17.7017 14.8125 17.0227 14.8125H14.9091V13.875H16.9886C17.4574 13.875 17.8338 13.794 18.1179 13.6321C18.402 13.4702 18.608 13.2514 18.7358 12.9759C18.8665 12.6974 18.9318 12.3835 18.9318 12.0341C18.9318 11.6847 18.8665 11.3722 18.7358 11.0966C18.608 10.821 18.4006 10.6051 18.1136 10.4489C17.8267 10.2898 17.446 10.2102 16.9716 10.2102H15.1136V18H14.0568Z'
        fill='#0464FB'
      />
    </svg>
  )
}

export const FallingEdgeCoil = ({ width, height, parenthesesClassName }: CoilSVGProps) => {
  return (
    <svg
      width={width ?? '34'}
      height={height ?? '28'}
      viewBox='0 0 34 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z'
        fill='#030303'
        className={parenthesesClassName}
      />
      <path
        d='M19.9773 9.27273V18H18.9545L14.1989 11.1477H14.1136V18H13.0568V9.27273H14.0795L18.8523 16.142H18.9375V9.27273H19.9773Z'
        fill='#0464FB'
      />
    </svg>
  )
}