import { expect, test, chromium, Page, Browser } from '@playwright/test'

// Import your createPouSlice function
import createPouSlice from '../types/PouSlice'

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser.close()
})

describe('createPouSlice', () => {
  it('should initialize pouData with default values', async () => {
    // Navigate to a test HTML page
    await page.goto('http://localhost:8080/test.html') // Replace with the actual path

    // Execute your createPouSlice function in the browser context
    const initialState = await page.evaluate(createPouSlice)

    // Assert the initial state
    expect(initialState.pouData).toEqual({
      name: '',
      type: '',
      language: '',
      body: '',
    })
  })

  it('should set pouData with provided data', async () => {
    // Navigate to a test HTML page
    await page.goto('http://localhost:8080/test.html') // Replace with the actual path

    // Execute your createPouSlice function in the browser context
    const initialState = await page.evaluate(createPouSlice)

    const newData = {
      name: 'Test Name',
      type: 'Test Type',
      language: 'Test Language',
      body: 'Test Body',
    }

    // Call the setPouData method in the browser context
    const updatedState = await page.evaluate(
      (state, newData) => {
        return state.setPouData(newData)
      },
      initialState,
      newData,
    )

    // Assert the updated state
    expect(updatedState.pouData).toEqual(newData)
  })

  it('should update the body property', async () => {
    // Navigate to a test HTML page
    await page.goto('http://localhost:8080/test.html') // Replace with the actual path

    // Execute your createPouSlice function in the browser context
    const initialState = await page.evaluate(createPouSlice)

    const newBody = 'New Body Text'

    // Call the updateBody method in the browser context
    const updatedState = await page.evaluate(
      (state, newBody) => {
        return state.updateBody(newBody)
      },
      initialState,
      newBody,
    )

    // Assert the updated body property
    expect(updatedState.pouData.body).toEqual(newBody)
  })
})
