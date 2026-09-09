/**
 * attach.ts pure logic: the intake decision (route a file to passthrough /
 * re-encode / reject), the scale math and the encoded-result gate. These are
 * the rules that make image intake honest on every device (accept anything
 * the browser can decode, compress before the wire, NEVER silently drop);
 * only the canvas middle needs a browser and is not unit-tested here.
 */
import { describe, expect, it } from 'vitest'
import {
  COMMENT_IMAGE_BUDGET,
  MAX_TASK_IMAGES,
  TASK_IMAGE_BUDGET,
  finishEncoded,
  intakeDecision,
  scaleToFit,
} from '../src/client/board/attach.ts'

describe('intakeDecision (route every file, say why for rejects)', () => {
  it('routes any decodable image to the re-encode path (pre-size never rejects)', () => {
    // A 12 MB phone photo is NOT rejected up front — the canvas shrinks it.
    expect(intakeDecision('image/jpeg', 12 * 1024 * 1024, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'reencode' })
    expect(intakeDecision('image/heic', 2 * 1024 * 1024, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'reencode' })
    expect(intakeDecision('image/bmp', 100, TASK_IMAGE_BUDGET)).toEqual({ kind: 'reencode' })
  })

  it('passes an in-budget gif through untouched (a canvas would kill the animation)', () => {
    expect(intakeDecision('image/gif', 1024, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'passthrough', mediaType: 'image/gif' })
    // An over-budget gif cannot be recompressed here — it is a size rejection.
    expect(intakeDecision('image/gif', COMMENT_IMAGE_BUDGET.maxBytes + 1, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'reject', reason: 'size' })
  })

  it('routes a non-image to the file lane (upload-then-receipt, never a type rejection)', () => {
    expect(intakeDecision('application/pdf', 10, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'file' })
    expect(intakeDecision('', 10, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'file' })
    expect(intakeDecision('video/mp4', 10, COMMENT_IMAGE_BUDGET)).toEqual({ kind: 'file' })
  })
})

describe('scaleToFit', () => {
  it('leaves an in-budget image untouched', () => {
    expect(scaleToFit(800, 600, 1568)).toEqual({ w: 800, h: 600 })
    expect(scaleToFit(1568, 100, 1568)).toEqual({ w: 1568, h: 100 })
  })

  it('shrinks the LONGEST edge to the budget and keeps the ratio', () => {
    expect(scaleToFit(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 })
    expect(scaleToFit(3000, 4000, 2000)).toEqual({ w: 1500, h: 2000 })
  })

  it('never collapses a dimension to zero', () => {
    const { w, h } = scaleToFit(10000, 1, 100)
    expect(w).toBe(100)
    expect(h).toBeGreaterThanOrEqual(1)
  })
})

describe('finishEncoded (the result gate: whitelist + budget, or a stated reason)', () => {
  const png100 = `data:image/png;base64,${'AA'.repeat(100)}`

  it('accepts a whitelisted type inside the budget', () => {
    const outcome = finishEncoded(png100, 'shot.png', COMMENT_IMAGE_BUDGET)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.image.mediaType).toBe('image/png')
      expect(outcome.image.name).toBe('shot.png')
      expect(outcome.image.data.startsWith('data:')).toBe(false)
    }
  })

  it('rejects an over-budget result with the size reason', () => {
    const big = `data:image/jpeg;base64,${'AA'.repeat(4000)}` // 4000 bytes > 512KB? no — use a tiny budget
    const tiny = { maxEdge: 100, maxBytes: 100, quality: 0.8 }
    expect(finishEncoded(big, 'big.jpg', tiny)).toEqual({ ok: false, reason: 'size', name: 'big.jpg' })
  })

  it('rejects a non-whitelisted encoder result as a decode failure (said out loud)', () => {
    // A browser canvas handing back an exotic type must never reach the host
    // as a mystery: the user gets the decode reason.
    expect(finishEncoded('data:image/tiff;base64,QUJD', 'odd.tif', COMMENT_IMAGE_BUDGET)).toEqual({ ok: false, reason: 'decode', name: 'odd.tif' })
    expect(finishEncoded('', 'broken', COMMENT_IMAGE_BUDGET)).toEqual({ ok: false, reason: 'decode', name: 'broken' })
  })

  it('parses a data URL carrying a charset parameter', () => {
    const outcome = finishEncoded(`data:image/webp;charset=utf-8;base64,${'AA'.repeat(50)}`, 'x.webp', COMMENT_IMAGE_BUDGET)
    expect(outcome.ok).toBe(true)
  })
})

describe('budgets (the persisted-prompt cap is deliberately tight)', () => {
  it('task prompt images cost less than comment images (they ride the shared doc)', () => {
    expect(TASK_IMAGE_BUDGET.maxBytes).toBeLessThan(COMMENT_IMAGE_BUDGET.maxBytes)
    expect(MAX_TASK_IMAGES).toBeLessThanOrEqual(3)
  })
})
