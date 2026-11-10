import { describe, expect, test } from 'bun:test'
import { rowsAdvice } from 'kehikot-module-protocol'

import { ROWS_PATH, rowsStates, rowsText } from '../dev/rows.ts'

/** `kehikot.rows.json` is the page's own rows, regenerated (`bun run dev/rows.ts`), and follows the rule. */
describe('kehikot.rows.json', () => {
  test('is what the page declares', async () => {
    expect(await Bun.file(ROWS_PATH).text()).toBe(rowsText())
  })

  test('draws no advice', () => {
    for (const state of rowsStates()) expect(rowsAdvice(state.header, state.footer, { state: state.state })).toEqual([])
  })
})
