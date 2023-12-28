/* eslint-disable jsx-a11y/control-has-associated-label */
import useEmblaCarousel from 'embla-carousel-react';

// import LeftArrow from 'renderer/assets/icons/left-arrow-muted.svg';
// import RightArrow from 'renderer/assets/icons/right-arrow.svg';
import DataForExamples from '../../shared/data/mock/examples.json';
import TestImage from '../assets/images/example.png';
import Card from '../components/elements/card';
import {
  NextButton,
  PrevButton,
  UsePrevNextButton,
} from '../components/ui/presentations/projects/examples/nav/nav-button';

function Draft() {
  // It is imported on component implementation
  const [emblaRef, emblaApi] = useEmblaCarousel();
  const { prevBtnDisabled, nextBtnDisabled, onPrevButtonClick, onNextButtonClick } =
    UsePrevNextButton(emblaApi);
  return (
    <div className='w-full h-full flex justify-center items-center flex-col'>
      {/* Container for buttons */}
      <div className='flex items-center'>
        <div className='embla__buttons'>
          <PrevButton onClick={onPrevButtonClick} disabled={prevBtnDisabled} />
          <NextButton onClick={onNextButtonClick} disabled={nextBtnDisabled} />
        </div>
      </div>
      {/* Container for cards */}
      <div className='embla__viewport' ref={emblaRef}>
        <div className='embla__container'>
          {DataForExamples.map((ex) => (
            <Card.Root key={ex.example_id}>
              <Card.Preview source={TestImage} />
              <Card.Label title={ex.example_name} description={ex.example_description} />
            </Card.Root>
          ))}
        </div>
      </div>
    </div>
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
