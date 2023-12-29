import { ButtonHTMLAttributes } from 'react';

type PrevButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  goPrev: () => void;
};

export default function PrevButton(props: PrevButtonProps) {
  const { goPrev, ...restProps } = props;
  return (
    <button type='button' aria-label='Previous button' onClick={goPrev} {...restProps}>
      <svg
        width='24'
        height='24'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M5 12.0001L19 12.0001M5 12.0001L10.8333 18.0001M5 12.0001L10.8333 6.00006'
          stroke='#0464FB'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    </button>
  );
}
