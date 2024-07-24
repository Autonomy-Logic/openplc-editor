import ElementEditor from '../element-editor'
import imageMock from '../mockImages/Group112.png'
import image1 from '../mockImages/image1.png'
import image2 from '../mockImages/image2.png'

const coilModifiers = [
  { label: 'normal', contact: imageMock },
  { label: 'negated', contact: image1 },
  { label: 'set', contact: image2 },
  { label: 'reset', contact: imageMock },
  { label: 'rising edge', contact: image2 },
  { label: 'falling edge', contact: imageMock },
]

export const CoilElement = () => (
  <ElementEditor title='Edit Coil Values' triggerLabel='Open Coil' modifierOptions={coilModifiers} />
)
