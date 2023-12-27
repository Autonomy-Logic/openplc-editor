import { ButtonHTMLAttributes, ReactNode } from 'react';

type NavButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  order: 'prev' | 'next';
};

export default function NavButton({ order, children, ...props }: NavButtonProps) {
  /**
   * Constants to manage the state of each button in carousel
   */
  // const [prevBtnDisabled, setPrevBtnDisabled] = useState(true);
  // const [nextBtnDisabled, setNextBtnDisabled] = useState(true);

  /**
   * Function to handle the onClick event for each button
   */
  // const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  // const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);
  return (
    <button {...props} type='button' className={`embla__button embla__button--${order}`}>
      {/* Some SVG className='embla__button__svg' */}
      {children}
    </button>
  );
}
