import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { copyMarkdownAndExpect, type DocxPage } from '../src/copy-markdown.js'

const ORIGIN = 'https://copy.example.test'
const EXPECTED = 'Synthetic grid and synced reference'

async function preparePage(
  page: Page,
  context: BrowserContext,
  loading: 'pending' | 'synced' | 'none',
  writeOnClick = true,
) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: ORIGIN,
  })
  await page.route(`${ORIGIN}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button data-CDC-button-type="copy" data-clicks="0">Copy</button>',
    }),
  )
  await page.goto(ORIGIN)
  await page.evaluate(
    ({ loading, writeOnClick, expected }) => {
      const root = {
        children: [
          {
            type: 'grid',
            snapshot: { type: loading === 'pending' ? 'pending' : 'grid' },
          },
          {
            type: 'synced_reference',
            snapshot: { type: 'synced_reference' },
            isAllDataReady: loading !== 'synced',
          },
        ],
      }
      let probes = 0
      const docxWindow = window as unknown as DocxPage
      docxWindow.PageMain = {
        blockManager: {
          get rootBlockModel() {
            document.body.dataset['probes'] = String(++probes)
            return root
          },
        },
      }
      const button = document.querySelector<HTMLButtonElement>('button')
      if (!button) throw new Error('Copy button missing')
      button.addEventListener('click', () => {
        button.dataset['clicks'] = String(Number(button.dataset['clicks']) + 1)
        if (writeOnClick) {
          const clipboard = navigator.clipboard
          const nativeClipboard = Object.getPrototypeOf(clipboard) as Clipboard
          nativeClipboard.writeText
            .call(clipboard, expected)
            .catch(console.error)
        }
      })
      // Simulate the page overriding clipboard methods.
      Object.defineProperty(navigator.clipboard, 'readText', {
        value: () => Promise.resolve('intercepted'),
        configurable: true,
      })
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () => Promise.resolve(),
        configurable: true,
      })
    },
    { loading, writeOnClick, expected: EXPECTED },
  )
}

for (const loading of ['pending', 'synced'] as const) {
  test(`copy waits for ${loading} content before clicking a visible button`, async ({
    page,
    context,
  }) => {
    await preparePage(page, context, loading)
    const copy = copyMarkdownAndExpect(page, {
      expectedText: EXPECTED,
      match: 'equals',
    })
    await expect(page.locator('body')).toHaveAttribute('data-probes', /\d+/)
    await expect(page.locator('button')).toHaveAttribute('data-clicks', '0')
    await page.evaluate(() => {
      const root = (window as unknown as DocxPage).PageMain?.blockManager
        ?.rootBlockModel
      if (!root?.children) throw new Error('Root model missing')
      for (const block of root.children) {
        block.snapshot = { type: block.type }
        block.isAllDataReady = true
      }
    })
    await copy
    await expect(page.locator('button')).toHaveAttribute('data-clicks', '1')
  })
}

test('stale clipboard content cannot pass when the copy action writes nothing', async ({
  page,
  context,
}) => {
  await preparePage(page, context, 'none', false)
  await page.bringToFront()
  await page.evaluate(async expected => {
    const clipboard = navigator.clipboard
    const nativeClipboard = Object.getPrototypeOf(clipboard) as Clipboard
    await nativeClipboard.writeText.call(clipboard, expected)
  }, EXPECTED)
  await expect(
    copyMarkdownAndExpect(page, { expectedText: EXPECTED, match: 'equals' }),
  ).rejects.toThrow('copy markdown 验证失败')
  await expect(page.locator('button')).toHaveAttribute('data-clicks', '1')
})
