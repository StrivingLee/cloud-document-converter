import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  readDocxReadiness,
  type DocxBlock,
  type DocxPage,
} from '../src/copy-markdown.ts'

const pageWith = (children: DocxBlock[] | undefined): DocxPage => ({
  PageMain: { blockManager: { rootBlockModel: { children } } },
})

void describe('readDocxReadiness', () => {
  void it('waits for the page model and root children', () => {
    assert.equal(readDocxReadiness({}).ready, false)
    assert.equal(readDocxReadiness(pageWith(undefined)).ready, false)
  })

  void it('waits for pending blocks even when the copy button can be visible', () => {
    assert.deepEqual(
      readDocxReadiness(
        pageWith([{ type: 'paragraph', snapshot: { type: 'pending' } }]),
      ),
      {
        ready: false,
        hasRoot: true,
        pendingBlocks: 1,
        loadingSyncedReferences: 0,
      },
    )
  })

  void it('waits for synced references to finish loading', () => {
    assert.deepEqual(
      readDocxReadiness(
        pageWith([
          {
            type: 'synced_reference',
            snapshot: { type: 'synced_reference' },
            isAllDataReady: false,
          },
        ]),
      ),
      {
        ready: false,
        hasRoot: true,
        pendingBlocks: 0,
        loadingSyncedReferences: 1,
      },
    )
  })

  void it('accepts loaded grids and synced references', () => {
    assert.equal(
      readDocxReadiness(
        pageWith([
          { type: 'grid', snapshot: { type: 'grid' } },
          {
            type: 'synced_reference',
            snapshot: { type: 'synced_reference' },
            isAllDataReady: true,
          },
        ]),
      ).ready,
      true,
    )
  })
})
