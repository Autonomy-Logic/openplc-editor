/* eslint-disable consistent-return */
// import logoSvg from './assets/logo'

/**
 * Waits for the specified document ready states before resolving.
 * @param condition - The document ready states to wait for.
 * @returns A promise that resolves when the specified ready states are reached.
 */
const domReady = (
	/**
	 * Represents the possible ready states of the document.
	 */
	// eslint-disable-next-line no-undef
	condition: DocumentReadyState[] = ['complete', 'interactive']
) =>
	new Promise((resolve) => {
		if (condition.includes(document.readyState)) {
			resolve(true)
		} else {
			document.addEventListener('readystatechange', () => {
				if (condition.includes(document.readyState)) {
					resolve(true)
				}
			})
		}
	})

/**
 * Utility functions for safely manipulating the DOM.
 */
const safeDOM = {
	/**
	 * Appends a child element to a parent element, only if not already present.
	 * @param parent - The parent element to append to.
	 * @param child - The child element to append.
	 */
	append(parent: HTMLElement, child: HTMLElement | Document) {
		if (!Array.from(parent.children).find((e) => e === child)) {
			return parent.appendChild(child)
		}
	},
	/**
	 * Removes a child element from a parent element, if present.
	 * @param parent - The parent element to remove from.
	 * @param child - The child element to remove.
	 */
	remove(parent: HTMLElement, child: HTMLElement) {
		if (Array.from(parent.children).find((e) => e === child)) {
			return parent.removeChild(child)
		}
	},
}

/**
 * Creates loading screen components and methods.
 * @returns Loading screen utility methods.
 */
const useLoading = () => {
	const preloadClassName = 'preload'
	const logoClassName = 'logo'
	const styleContent = `
    .${preloadClassName} {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      background: transparent;
    }
    .${logoClassName} {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30rem;
      height: 18.75rem;
      background: black;
      overflow: hidden;
      border-radius: 0.5rem;
    }
    .${logoClassName} svg {
      transform: scale(1.2);
      margin-left: -12rem;
    }
  `

	const style = document.createElement('style')
	const container = document.createElement('div')
	// const content = `<div class=${logoClassName}>${logoSvg}</div>`

	style.id = 'app-loading-style'
	style.innerHTML = styleContent

	container.className = preloadClassName
	// container.innerHTML = content
	return {
		/**
		 * Appends the loading screen elements to the document.
		 */
		appendLoading() {
			safeDOM.append(document.head, style)
			safeDOM.append(document.body, container)
		},
		/**
		 * Removes the loading screen elements from the document.
		 */
		removeLoading() {
			safeDOM.remove(document.head, style)
			safeDOM.remove(document.body, container)
		},
	}
}

// eslint-disable-next-line react-hooks/rules-of-hooks
const { appendLoading, removeLoading } = useLoading()

// Wait for the DOM to be ready before appending the loading screen.
domReady()
	.then(appendLoading)
	// eslint-disable-next-line no-console
	.catch(() => console.log('Failed to load the dom'))

/**
 * Handles the 'message' event sent to the window.
 * @param event - The message event.
 */
window.onmessage = (event) => {
	if (event.data.payload === 'removeLoading') removeLoading()
}

// Remove the loading screen after a certain timeout.
setTimeout(removeLoading, 1000)
