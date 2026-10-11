import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './react-app/src/App'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

describe('React App - Component Rendering', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('should render the React app component', async () => {
    render(<App />, { container })

    await waitFor(() => {
      const title = screen.getByRole('heading', { level: 1 })
      expect(title).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT_MS })

    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toContain('Seed Protocol SDK')
  })

  it('should display client status after rendering', async () => {
    render(<App />, { container })

    await waitFor(() => {
      const statusElement = screen.getByTestId('client-status')
      expect(statusElement.textContent).not.toBe('Checking...')
    }, { timeout: WAIT_TIMEOUT_MS })

    const statusElement = screen.getByTestId('client-status')
    expect(statusElement).toBeTruthy()
    expect(statusElement.textContent).not.toBe('Checking...')
  })
})

