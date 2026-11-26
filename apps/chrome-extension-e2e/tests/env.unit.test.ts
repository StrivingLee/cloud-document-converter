import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_LIVE_USER_DATA_DIR,
  resolveLiveCopyConfig,
} from '../src/env.ts'

void describe('resolveLiveCopyConfig', () => {
  void it('uses the default profile and headless mode', () => {
    assert.deepEqual(resolveLiveCopyConfig({}), {
      userDataDir: DEFAULT_LIVE_USER_DATA_DIR,
      headless: true,
      targetUrl: '',
      expectedText: '',
    })
  })

  void it('reads the profile, URL and expected text from the supplied environment', () => {
    assert.deepEqual(
      resolveLiveCopyConfig({
        CDC_E2E_USER_DATA_DIR: '/tmp/cdc-synthetic-profile',
        CDC_E2E_HEADLESS: '0',
        CDC_E2E_TARGET_URL: 'https://example.feishu.cn/wiki/TEST',
        CDC_E2E_EXPECTED_TEXT: 'Synthetic content',
      }),
      {
        userDataDir: '/tmp/cdc-synthetic-profile',
        headless: false,
        targetUrl: 'https://example.feishu.cn/wiki/TEST',
        expectedText: 'Synthetic content',
      },
    )
  })

  void it('allows an empty profile path for temporary browser profiles', () => {
    assert.equal(
      resolveLiveCopyConfig({ CDC_E2E_USER_DATA_DIR: '' }).userDataDir,
      '',
    )
  })

  for (const value of ['1', '0', '', 'true']) {
    void it(`enables headless mode only for "1", given ${JSON.stringify(value)}`, () => {
      assert.equal(
        resolveLiveCopyConfig({ CDC_E2E_HEADLESS: value }).headless,
        value === '1',
      )
    })
  }
})
