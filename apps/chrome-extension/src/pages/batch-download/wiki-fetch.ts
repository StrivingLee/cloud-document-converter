import {
  isLarkHost,
  throwIfWikiCancelled,
  withWikiCancellation,
  type FetchJson,
} from './wiki-hierarchy'

/**
 * Authenticated GET of a Feishu/Lark tree API URL.
 *
 * The extension already holds host permissions for Feishu/Lark, so the page
 * first tries a direct credentialed fetch. If the session cookie isn't sent
 * (or the response isn't JSON), it falls back to running the same fetch
 * inside a tab on that origin with chrome.scripting, where it is a plain
 * same-origin request. No new permissions are needed for either path.
 */
export interface WikiFetcher {
  fetchJson: FetchJson
  /** 'direct' or 'tab', decided by the first successful probe. */
  mode: () => 'direct' | 'tab' | 'unknown'
  /** Close the background tab this fetcher opened, if any. */
  dispose: () => Promise<void>
}

const isSignedInJson = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  (body as { code?: unknown }).code === 0

async function directFetch(
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, { credentials: 'include', signal })
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Runs inside the Feishu tab (isolated world), so the request is same-origin. */
async function fetchInPage(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { credentials: 'include' })
    return JSON.parse(await r.text()) as unknown
  } catch {
    return null
  }
}

type Injection = Parameters<typeof chrome.scripting.executeScript>[0]

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

export function createWikiFetcher(
  origin: string,
  pageUrl: string,
): WikiFetcher {
  let mode: 'direct' | 'tab' | 'unknown' = 'unknown'
  let tabId: number | null = null
  let openedTab = false

  const ensureTab = async (signal?: AbortSignal): Promise<number> => {
    throwIfWikiCancelled(signal)
    if (tabId !== null) {
      try {
        await chrome.tabs.get(tabId)
        return tabId
      } catch {
        tabId = null
      }
    }
    const [existing] = await chrome.tabs.query({ url: `${origin}/*` })
    throwIfWikiCancelled(signal)
    if (existing?.id !== undefined) {
      tabId = existing.id
      return existing.id
    } else {
      const tab = await chrome.tabs.create({ url: pageUrl, active: false })
      if (tab.id === undefined) throw new Error('Could not open a Feishu tab')
      tabId = tab.id
      openedTab = true
      if (signal?.aborted) {
        await chrome.tabs.remove(tabId).catch(() => undefined)
        tabId = null
        openedTab = false
        throwIfWikiCancelled(signal)
      }
      return tab.id
    }
  }

  const tabFetch = async (
    url: string,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const id = await ensureTab(signal)
    throwIfWikiCancelled(signal)
    // chrome-types declares `func: () => void`; the real API forwards `args`.
    const injection = {
      target: { tabId: id },
      func: fetchInPage,
      args: [url],
    } as unknown as Injection
    // A fresh tab can't be scripted until its Feishu document has committed;
    // only that is needed, not a full page load.
    for (let attempt = 0; ; attempt++) {
      throwIfWikiCancelled(signal)
      try {
        const [result] = await withWikiCancellation(
          chrome.scripting.executeScript(injection),
          signal,
        )
        throwIfWikiCancelled(signal)
        const value: unknown = result?.result
        return value ?? null
      } catch (err) {
        throwIfWikiCancelled(signal)
        if (attempt >= 50) throw err
        await withWikiCancellation(sleep(300), signal)
      }
    }
  }

  const fetchJson: FetchJson = async (url, signal) => {
    throwIfWikiCancelled(signal)
    const target = new URL(url)
    if (target.origin !== origin || !isLarkHost(target.hostname))
      throw new Error(`Refusing to fetch outside ${origin}`)
    if (mode === 'tab') return tabFetch(url, signal)
    if (mode === 'direct') return directFetch(url, signal)
    // Probe once: direct first, then tab. Lock in a path either way so
    // retries of a refused page don't pay for both paths every time.
    const direct = await directFetch(url, signal).catch(() => {
      throwIfWikiCancelled(signal)
      return null
    })
    throwIfWikiCancelled(signal)
    if (isSignedInJson(direct)) {
      mode = 'direct'
      return direct
    }
    const viaTab = await tabFetch(url, signal).catch(() => {
      throwIfWikiCancelled(signal)
      return null
    })
    throwIfWikiCancelled(signal)
    mode = isSignedInJson(viaTab) || direct === null ? 'tab' : 'direct'
    return viaTab ?? direct
  }

  return {
    fetchJson,
    mode: () => mode,
    dispose: async () => {
      if (openedTab && tabId !== null) {
        await chrome.tabs.remove(tabId).catch(() => undefined)
      }
      tabId = null
      openedTab = false
    },
  }
}
