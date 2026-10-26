import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'

import { Card } from '../src/view/card.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'
import { reading, row } from './reading.ts'

/**
 * Jalez/kehikko#187: a change that is only part of an issue says so on its card, and one that
 * closes it says nothing of the kind.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const live = reading([
  row('#3912', { state: 'open', contributedBy: ['!3907'] }),
  row('!3907', { state: 'merged', contributes: ['#3912'] }),
  row('!3251', { state: 'merged', links: [{ ref: '#2638', relation: 'closes' }] }),
])

const draw = (ref: string) =>
  render(
    <ReadingProvider value={{ live, journey: null }}>
      <Card refName={ref} under />
    </ReadingProvider>,
  )

describe('a card for a change that is part of an issue', () => {
  test('says "part of #3912"', () => {
    const drawn = draw('!3907')
    const line = drawn.container.querySelector('[data-part-of]')
    expect(line?.textContent).toContain('part of')
    expect(line?.textContent).toContain('#3912')
  })

  test('a change that closes its issue has no such line', () => {
    expect(draw('!3251').container.querySelector('[data-part-of]')).toBeNull()
  })
})
