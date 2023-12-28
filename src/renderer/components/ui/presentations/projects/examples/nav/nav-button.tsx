/* eslint-disable react/function-component-definition */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { EmblaCarouselType } from 'embla-carousel-react';
import { ButtonHTMLAttributes, useCallback, useEffect, useState } from 'react';
import PrevIcon from 'renderer/assets/icons/base/left-arrow.svg';
import NextIcon from 'renderer/assets/icons/base/right-arrow.svg';

export type UsePrevNextButtonProps = {
  prevBtnDisabled: boolean;
  nextBtnDisabled: boolean;
  onPrevButtonClick: () => void;
  onNextButtonClick: () => void;
};
export type NavButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & unknown;

export const UsePrevNextButton = (
  emblaApi: EmblaCarouselType | undefined
): UsePrevNextButtonProps => {
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
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
    setPrevBtnDisabled(!emblaApi.canScrollPrev());
    setNextBtnDisabled(!emblaApi.canScrollNext());
  }, []);

  /**
   * Refactor - Need to normalize
   */
  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on('reInit', onSelect);
    emblaApi.on('select', onSelect);
  }, [emblaApi, onSelect]);

  return {
    prevBtnDisabled,
    nextBtnDisabled,
    onPrevButtonClick,
    onNextButtonClick,
  };
};

/**
 * Refactor - Need to normalize
 * The button component in fact
 */
export const PrevButton: React.FC<NavButtonProps> = (props) => {
  const { children, ...restProps } = props;
  return (
    <button className='embla__button embla__button--prev' type='button' {...restProps}>
      <PrevIcon />
      {children}
    </button>
  );
};

/**
 * Refactor - Need to normalize
 * The button component in fact
 */
export const NextButton: React.FC<NavButtonProps> = (props) => {
  const { children, ...restProps } = props;

  return (
    <button className='embla__button embla__button--next' type='button' {...restProps}>
      <NextIcon />
      {children}
    </button>
  );
};

//   return (
//     <button {...props} type='button' className={`embla__button embla__button--${order}`}>
//       {/* Some SVG className='embla__button__svg' */}
//       {children}
//     </button>
//   );
// }
