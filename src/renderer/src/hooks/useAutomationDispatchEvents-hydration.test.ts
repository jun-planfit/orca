import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOnDispatchRequested = vi.fn(() => () => {})
const mockRendererReady = vi.fn()

vi.mock('./automation-dispatch-handler', () => ({
  handleAutomationDispatchRequest: vi.fn()
}))

describe('useAutomationDispatchEvents hydration gate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: {
        automations: {
          onDispatchRequested: mockOnDispatchRequested,
          rendererReady: mockRendererReady
        }
      }
    })
  })

  async function mount(rendererReady: boolean): Promise<void> {
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof ReactModule>('react')
      return {
        ...actual,
        useEffect: (effect: () => void | (() => void)) => {
          effect()
        }
      }
    })
    const { useAutomationDispatchEvents: registerAutomationDispatchEvents } =
      await import('./useAutomationDispatchEvents')
    registerAutomationDispatchEvents(rendererReady)
  }

  it('subscribes without releasing scheduled runs before startup hydration', async () => {
    await mount(false)

    expect(mockOnDispatchRequested).toHaveBeenCalledOnce()
    expect(mockRendererReady).not.toHaveBeenCalled()
  })

  it('releases scheduled runs after startup hydration', async () => {
    await mount(true)

    expect(mockOnDispatchRequested).toHaveBeenCalledOnce()
    expect(mockRendererReady).toHaveBeenCalledOnce()
  })
})
