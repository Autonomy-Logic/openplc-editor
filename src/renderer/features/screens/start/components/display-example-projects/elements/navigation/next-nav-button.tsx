import { ButtonHTMLAttributes, ReactNode } from 'react';

export type ExampleNextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & unknown;

export default function NextButton(props: ExampleNextButtonProps): ReactNode {
  const { ...restProps } = props;
  return (
    <button type='button' aria-label='Next button' {...restProps}>
      <svg
        width='24'
        height='24'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M19 12.0001L5 12.0001M19 12.0001L13.1667 18.0001M19 12.0001L13.1667 6.00006'
          stroke='#0464FB'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    </button>
  );
}

export type ExampleNextButton = typeof NextButton;
