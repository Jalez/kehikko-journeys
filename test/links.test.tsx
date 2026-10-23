import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { AddressOpenResult } from 'kehikot-module-protocol'

import { handLink, handsLink, stillFollow } from '../src/lib/links.ts'
import { Prose } from '../src/view/prose.tsx'
import { ReadingProvider, type Reading } from '../src/view/reading.tsx'
import { reading, row } from './reading.ts'

/**
 * A reference's link, handed to the canvas (`address.open`, protocol 2.16.0)
 * when the host answers it; a new tab otherwise.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const answer = (outcome: AddressOpenResult['outcome']): AddressOpenResult => ({ outcome, why: '' })
const URL_OF = 'https://github.com/org/repo/issues/1'
const live = reading([row('gh#1', { state: 'open', url: URL_OF })])

function draw(openAddress: Reading['openAddress']) {
  return render(
    <ReadingProvider value={{ live, journey: null, openAddress }}>
      <Prose text="Waiting on gh#1 to land." />
    </ReadingProvider>,
  )
}

describe('handsLink', () => {
  test('only with a host that takes addresses, and only an address the protocol takes', () => {
    const open = () => Promise.resolve(answer('shown'))
    expect(handsLink(URL_OF, open)).toBe(true)
    expect(handsLink(URL_OF, null)).toBe(false)
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://u:p@github.com', '', null]) {
      expect(handsLink(url, open)).toBe(false)
    }
  })
})

describe('after handing it over', () => {
  test('shown or offered: nothing more is opened', async () => {
    for (const outcome of ['shown', 'offered'] as const) {
      expect(stillFollow(answer(outcome))).toBe(false)
      const opened: string[] = []
      await handLink(URL_OF, () => Promise.resolve(answer(outcome)), (url) => void opened.push(url))
      expect(opened).toEqual([])
    }
  })
  test('declined or unanswered: the old new tab', async () => {
    for (const given of [answer('declined'), null]) {
      const opened: string[] = []
      await handLink(URL_OF, () => Promise.resolve(given), (url) => void opened.push(url))
      expect(opened).toEqual([URL_OF])
    }
  })
})

describe('a reference in prose', () => {
  test('inside a host that takes addresses, a press hands the address over and is not followed', () => {
    const asked: string[] = []
    const { getByText } = draw((url) => (asked.push(url), Promise.resolve(answer('offered'))))
    expect(fireEvent.click(getByText('gh#1'))).toBe(false)
    expect(asked).toEqual([URL_OF])
  })

  test('without one, an ordinary new-tab link', () => {
    const { getByText } = draw(null)
    const link = getByText('gh#1') as HTMLAnchorElement
    expect(link.target).toBe('_blank')
    expect(link.href).toBe(URL_OF)
    expect(fireEvent.click(link)).toBe(true)
  })
})
