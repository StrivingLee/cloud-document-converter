import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWikiFetcher } from '../src/pages/batch-download/wiki-fetch'

const ORIGIN = 'https://example.feishu.cn'
const URL = `${ORIGIN}/space/api/wiki/v2/tree/get_info/?wiki_token=ROOT`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWikiFetcher cancellation', () => {
  it('passes the signal to direct fetch and never falls back after cancellation', async () => {
    const ctrl = new AbortController()
    const query = vi.fn()
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(ctrl.signal)
      ctrl.abort()
      return Promise.reject(new Error('Aborted'))
    })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('chrome', { tabs: { query } })
    const fetcher = createWikiFetcher(ORIGIN, `${ORIGIN}/wiki/ROOT`)

    await expect(fetcher.fetchJson(URL, ctrl.signal)).rejects.toThrow(
      'cancelled',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(query).not.toHaveBeenCalled()
    await fetcher.dispose()
  })

  it('ignores a late tab response without retrying or closing a reused tab', async () => {
    const ctrl = new AbortController()
    let respond!: (value: { result: unknown }[]) => void
    const executeScript = vi.fn(
      () => new Promise<{ result: unknown }[]>(resolve => (respond = resolve)),
    )
    const remove = vi.fn()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('login')))
    vi.stubGlobal('chrome', {
      tabs: { query: () => Promise.resolve([{ id: 7 }]), remove },
      scripting: { executeScript },
    })
    const fetcher = createWikiFetcher(ORIGIN, `${ORIGIN}/wiki/ROOT`)
    const pending = fetcher.fetchJson(URL, ctrl.signal)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await vi.waitFor(() => {
      expect(executeScript).toHaveBeenCalledTimes(1)
    })
    ctrl.abort()
    await rejected
    respond([{ result: { code: 0, data: {} } }])
    await fetcher.dispose()
    expect(executeScript).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    expect(fetcher.mode()).toBe('unknown')
  })

  it('closes a new fallback tab if cancellation happens while opening it', async () => {
    const ctrl = new AbortController()
    const executeScript = vi.fn()
    const remove = vi.fn(() => Promise.resolve())
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('login')))
    vi.stubGlobal('chrome', {
      tabs: {
        query: () => Promise.resolve([]),
        create: () => {
          ctrl.abort()
          return Promise.resolve({ id: 8 })
        },
        remove,
      },
      scripting: { executeScript },
    })
    const fetcher = createWikiFetcher(ORIGIN, `${ORIGIN}/wiki/ROOT`)
    await expect(fetcher.fetchJson(URL, ctrl.signal)).rejects.toThrow(
      'cancelled',
    )
    await fetcher.dispose()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(8)
    expect(executeScript).not.toHaveBeenCalled()
  })
})
