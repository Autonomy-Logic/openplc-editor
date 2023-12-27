/* eslint-disable @typescript-eslint/no-unused-vars */
import { EmblaCarouselType } from 'embla-carousel-react';
import { ButtonHTMLAttributes, ReactNode, useCallback, useState } from 'react';

type UsePrevNextButtonProps = {
  prevBtnDisabled: boolean;
  nextBtnDisabled: boolean;
  onPrevButtonClick: () => void;
  onNextButtonClick: () => void;
};
type NavButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  order: 'prev' | 'next';
};

const UsePrevNextButton = (emblaApi: EmblaCarouselType | undefined): UsePrevNextButtonProps => {
  /**
   * Constants to manage the state of each button in carousel
   */
  const [prevBtnDisabled, setPrevBtnDisabled] = useState(true);
  const [nextBtnDisabled, setNextBtnDisabled] = useState(true);

  /**
   * Function to handle the click event on previous button
   */
  const onPrevButtonClick = useCallback(() => {
    if (!emblaApi) return;
    emblaApi.scrollPrev();
  }, [emblaApi]);

  /**
   * Function to handle the click event on next button
   */
  const onNextButtonClick = useCallback(() => {
    if (!emblaApi) return;
    emblaApi.scrollNext();
  }, [emblaApi]);

  /**
   * Refactor - Need to normalize
   */
  // const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
  //   setPrevBtnDisabled(!emblaApi.canScrollPrev())
  //   setNextBtnDisabled(!emblaApi.canScrollNext())
  // }, [])

  /**
   * Refactor - Need to normalize
   */
  // useEffect(() => {
  //   if (!emblaApi) return
  //   onSelect(emblaApi)
  //   emblaApi.on('reInit', onSelect)
  //   emblaApi.on('select', onSelect)
  // }, [emblaApi, onSelect])

  return {
    prevBtnDisabled,
    nextBtnDisabled,
    onPrevButtonClick,
    onNextButtonClick,
  };
};

export default function NavButton({ order, children, ...props }: NavButtonProps) {
  /**
   * Refactor - Need to normalize
   * The button component in fact
   */
  // const PrevButton: React.FC<PropType> = (props) => {
  //   const { children, ...restProps } = props;
  //   return (
  //     <button className='embla__button embla__button--prev' type='button' {...restProps}>
  //       <svg className='embla__button__svg' viewBox='0 0 532 532'>
  //         <path
  //           fill='currentColor'
  //           d='M355.66 11.354c13.793-13.805 36.208-13.805 50.001 0 13.785 13.804 13.785 36.238 0 50.034L201.22 266l204.442 204.61c13.785 13.805 13.785 36.239 0 50.044-13.793 13.796-36.208 13.796-50.002 0a5994246.277 5994246.277 0 0 0-229.332-229.454 35.065 35.065 0 0 1-10.326-25.126c0-9.2 3.393-18.26 10.326-25.2C172.192 194.973 332.731 34.31 355.66 11.354Z'
  //         />
  //       </svg>
  //       {children}
  //     </button>
  //   );
  // };

  /**
   * Refactor - Need to normalize
   * The button component in fact
   */
  // const NextButton: React.FC<PropType> = (props) => {
  //   const { children, ...restProps } = props

  //   return (
  //     <button
  //       className="embla__button embla__button--next"
  //       type="button"
  //       {...restProps}
  //     >
  //       <svg className="embla__button__svg" viewBox="0 0 532 532">
  //         <path
  //           fill="currentColor"
  //           d="M176.34 520.646c-13.793 13.805-36.208 13.805-50.001 0-13.785-13.804-13.785-36.238 0-50.034L330.78 266 126.34 61.391c-13.785-13.805-13.785-36.239 0-50.044 13.793-13.796 36.208-13.796 50.002 0 22.928 22.947 206.395 206.507 229.332 229.454a35.065 35.065 0 0 1 10.326 25.126c0 9.2-3.393 18.26-10.326 25.2-45.865 45.901-206.404 206.564-229.332 229.52Z"
  //         />
  //       </svg>
  //       {children}
  //     </button>
  //   )
  // }
  return (
    <button {...props} type='button' className={`embla__button embla__button--${order}`}>
      {/* Some SVG className='embla__button__svg' */}
      {children}
    </button>
  );
}
