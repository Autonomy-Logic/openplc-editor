/** Worker entry of the HMI preview on the desktop: hands its global scope to the shared worker script. */
import { serveHmiPreview } from '../../../backend/shared/hmi/preview/preview-worker'

serveHmiPreview({
  postMessage: (message, transfer) => self.postMessage(message, { transfer }),
  addEventListener: (type, listener) => self.addEventListener(type, listener),
})
