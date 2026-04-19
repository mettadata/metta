import { describe, it, expect, afterEach } from 'vitest'
import { askYesNo } from '../src/cli/helpers.js'

describe('askYesNo', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    // Restore original TTY state so other tests are unaffected.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    })
  })

  function setTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      value,
      configurable: true,
      writable: true,
    })
  }

  it('returns defaultYes=false when stdin is not a TTY', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?', { defaultYes: false })).resolves.toBe(false)
  })

  it('returns defaultYes=true when stdin is not a TTY', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?', { defaultYes: true })).resolves.toBe(true)
  })

  it('returns defaultYes when jsonMode is true (even if TTY)', async () => {
    setTTY(true)
    await expect(
      askYesNo('prompt?', { defaultYes: true, jsonMode: true }),
    ).resolves.toBe(true)
    await expect(
      askYesNo('prompt?', { defaultYes: false, jsonMode: true }),
    ).resolves.toBe(false)
  })

  it('defaults to false in non-TTY when defaultYes is omitted', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?')).resolves.toBe(false)
  })

  it('defaults to false in non-TTY when opts object is omitted entirely', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?')).resolves.toBe(false)
  })

  it('defaults to false in jsonMode when defaultYes is omitted', async () => {
    setTTY(true)
    await expect(askYesNo('prompt?', { jsonMode: true })).resolves.toBe(false)
  })
})
