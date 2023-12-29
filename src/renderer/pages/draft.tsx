/* eslint-disable jsx-a11y/control-has-associated-label */
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback } from 'react';

// import LeftArrow from 'renderer/assets/icons/left-arrow-muted.svg';
// import RightArrow from 'renderer/assets/icons/right-arrow.svg';
import DataForExamples from '../../shared/data/mock/examples.json';
import TestImage from '../assets/images/example.png';
import Card from '../components/elements/card';

function Draft() {
  // It is imported on component implementation
  const [emblaRef, emblaApi] = useEmblaCarousel();

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  return (
    // <div className='w-full h-full flex justify-center items-center flex-col p-10'>
    <>
      {/* Container for cards */}
      <div className='overflow-hidden' ref={emblaRef}>
        <div className='flex'>
          {DataForExamples.map((ex) => (
            <Card.Root key={ex.example_id}>
              <Card.Preview source={TestImage} />
              <Card.Label title={ex.example_name} description={ex.example_description} />
            </Card.Root>
          ))}
        </div>
      </div>
      <div>
        <button type='button' onClick={scrollPrev}>
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
        <button type='button' onClick={scrollNext}>
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
      </div>
    </>
    // </div>
  );
}

export default Draft;

/* <div className='relative flex flex-col items-start justify-start gap-6 text-left text-xl text-black w-full bg-white'>
        <div className='flex flex-row items-start self-stretch justify-between'>
          <h3 className='relative leading-6 font-medium'>Examples</h3>
          <div className='flex flex-row flex-shrink-0 items-start justify-start gap-6'>
            <img
              alt='icon for nav left'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-cover'
              src={LeftArrow}
            />
            <img
              alt='icon for nav right'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-contain'
              src={RightArrow}
            />
          </div>
        </div>
        <div className='flex flex-row self-stretch items-start justify-start gap-6 overflow-auto'>
          {DataForExamples.map((ex) => (
            <Card.Root key={ex.example_id}>
              <Card.Preview source={TestImage} />
              <Card.Label title={ex.example_name} description={ex.example_description} />
            </Card.Root>
          ))}
        </div>
      </div> */
