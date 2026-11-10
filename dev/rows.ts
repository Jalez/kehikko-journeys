/**
 * `kehikot.rows.json`, for `kehikot-check-rows` (protocol 2.70.0): the header and footer this page
 * declares, built by the page's own `headerItems` and `footerItems` over a few moments of a journey.
 * `bun run dev/rows.ts` writes the file; `test/rows.test.ts` fails when it no longer matches.
 */
import { footerItems, headerItems, type FooterState } from '../src/footer.ts'

const quiet: FooterState = { status: null, progress: null, pointed: null, picked: 0 }
const progress: FooterState['progress'] = { done: 2, total: 5, blocked: 1, next: { position: 3, title: 'A reader sees what happened' }, why: null }

export function rowsStates() {
  return [
    {
      name: 'a journey, nothing picked',
      header: headerItems({ named: 3, all: false }),
      footer: footerItems({ ...quiet, progress }),
      state: true,
    },
    {
      name: 'every step picked, an agent pointing, the tracker being read',
      header: headerItems({ named: 3, all: true }),
      footer: footerItems({
        status: { said: 'Reading the tracker…', level: 'normal' },
        progress,
        pointed: { step: 2, title: 'Two', say: 'this one' },
        picked: 3,
      }),
      state: true,
    },
    {
      name: 'a journey whose steps name no reference',
      header: headerItems({ named: 0, all: false }),
      footer: footerItems({ ...quiet, progress: { done: 0, total: 2, blocked: 0, next: { position: 1, title: 'One' }, why: null } }),
      state: true,
    },
  ]
}

export const ROWS_PATH = new URL('../kehikot.rows.json', import.meta.url)
export const rowsText = () => `${JSON.stringify(rowsStates(), null, 2)}\n`

if (import.meta.main) await Bun.write(ROWS_PATH, rowsText())
