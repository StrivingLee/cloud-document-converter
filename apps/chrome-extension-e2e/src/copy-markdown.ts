import { expect, type Page } from '@playwright/test'

export interface DocxBlock {
  type: string
  snapshot?: { type: string }
  isAllDataReady?: boolean
}

export interface DocxPage {
  PageMain?: {
    blockManager?: {
      rootBlockModel?: {
        children?: DocxBlock[]
      }
    }
  }
}

export interface DocxReadiness {
  ready: boolean
  hasRoot: boolean
  pendingBlocks: number
  loadingSyncedReferences: number
}

/** Runs in the page, using the same prerequisites as Docx.isReady(). */
export function readDocxReadiness(
  pageWindow: DocxPage = window as unknown as DocxPage,
): DocxReadiness {
  const root = pageWindow.PageMain?.blockManager?.rootBlockModel
  const children = root?.children
  const pendingBlocks =
    children?.filter(
      block => !block.snapshot || block.snapshot.type === 'pending',
    ).length ?? 0
  const loadingSyncedReferences =
    children?.filter(
      block => block.type === 'synced_reference' && !block.isAllDataReady,
    ).length ?? 0
  return {
    ready:
      Boolean(root && children) &&
      pendingBlocks === 0 &&
      loadingSyncedReferences === 0,
    hasRoot: Boolean(root),
    pendingBlocks,
    loadingSyncedReferences,
  }
}

export async function copyMarkdownAndExpect(
  page: Page,
  assertion: { expectedText: string; match: 'equals' | 'contains' },
): Promise<void> {
  const copyButton = page.locator('[data-CDC-button-type="copy"]')
  await expect(copyButton).toBeVisible({ timeout: 60 * 1000 })
  await expect
    .poll(() => page.evaluate(readDocxReadiness, undefined), {
      message: 'Wait for document blocks and synced references before copying',
      timeout: 60 * 1000,
      intervals: [250, 500, 1000],
    })
    .toMatchObject({ ready: true })

  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  // Use the native methods, as the copy script does: Feishu can override them.
  await page.evaluate(async () => {
    const clipboard = navigator.clipboard
    const nativeClipboard = Object.getPrototypeOf(clipboard) as Clipboard
    await nativeClipboard.writeText.call(clipboard, '')
  })
  await copyButton.click()

  let clipboardResult = ''
  try {
    const poll = expect.poll(
      async () => {
        await page.bringToFront()
        clipboardResult = await page.evaluate(async () => {
          const clipboard = navigator.clipboard
          const nativeClipboard = Object.getPrototypeOf(clipboard) as Clipboard
          return (await nativeClipboard.readText.call(clipboard)).trim()
        })
        return clipboardResult
      },
      { timeout: 20 * 1000, intervals: [500, 1000, 2000] },
    )
    if (assertion.match === 'equals') await poll.toBe(assertion.expectedText)
    else await poll.toContain(assertion.expectedText)
  } catch (cause) {
    throw new Error(
      [
        'copy markdown 验证失败',
        `验证方式: ${assertion.match}`,
        `验证内容: ${JSON.stringify(assertion.expectedText)}`,
        `输出结果: ${JSON.stringify(clipboardResult)}`,
        `页面准备状态: ${JSON.stringify(await page.evaluate(readDocxReadiness, undefined))}`,
      ].join('\n'),
      { cause },
    )
  }
}
