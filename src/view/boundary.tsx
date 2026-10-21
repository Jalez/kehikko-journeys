import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * What is drawn instead of a part of the page that threw while drawing.
 *
 * ## Why this exists at all
 *
 * React unmounts the whole root when a render throws and nothing catches it.
 * This page paints its own dark surface on `html` and `body` (`index.css`), so
 * an unmounted root is not an error message, a cover or a half-drawn journey:
 * it is an empty dark rectangle, with nothing to read and nothing to press —
 * "Journey goes black", Jalez/kehikko-journeys#39. Every other not-ready moment
 * on this page is the protocol's cover and says something; a throw now does too.
 *
 * Two sizes. `page` stands in for the whole page, with the error in words and
 * Reload — the one press that is sure to start again. `part` stands in for one
 * step or one list, so a step that cannot be drawn costs that step and not the
 * journey around it; it offers to draw it again, and is cleared by itself when
 * what it was given changes (`reset`).
 */
export interface BoundaryProps {
  children: ReactNode
  /** `page` for the whole page; `part` for one step or one list inside it. */
  size?: 'page' | 'part'
  /** What the part is, for its sentence: "step 3", "the gates". */
  name?: string
  /** A value (or a list of them) that, when it changes, draws the part again after a throw. */
  reset?: unknown
}

interface Caught {
  error: Error | null
  at: unknown
}

/** The sentence for a thrown value, whatever was thrown. */
export function errorWords(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'An error with no message.'
  if (typeof error === 'string' && error) return error
  return 'Something was thrown that is not an error.'
}

/** `reset` values compared: by identity, or element by element for a list of them. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((one, i) => Object.is(one, b[i]))
  return Object.is(a, b)
}

export const PAGE_FAILED = 'Journeys stopped drawing this page.'

export class Boundary extends Component<BoundaryProps, Caught> {
  override state: Caught = { error: null, at: undefined }

  static getDerivedStateFromError(error: unknown): Partial<Caught> {
    return { error: error instanceof Error ? error : new Error(errorWords(error)) }
  }

  /* A new value of `reset` is a different thing to draw: try it. */
  static getDerivedStateFromProps(props: BoundaryProps, state: Caught): Partial<Caught> | null {
    if (same(props.reset, state.at)) return null
    return { at: props.reset, error: null }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    /* Said where somebody debugging looks first, with where it was. */
    console.error(`journeys: ${this.props.name ?? 'the page'} could not be drawn:`, error, info.componentStack ?? '')
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if ((this.props.size ?? 'page') === 'page') {
      return (
        <section
          role="alert"
          data-crashed="page"
          className="mx-auto grid w-full max-w-[44rem] gap-2 px-3 py-6 text-[0.95rem] leading-7 text-foreground"
        >
          <p className="font-semibold">{PAGE_FAILED}</p>
          <p className="text-[0.85rem] text-muted-foreground [overflow-wrap:anywhere]">
            It failed with: <span className="font-mono text-[0.8rem] text-foreground">{errorWords(error)}</span>
          </p>
          <p className="text-[0.85rem] text-muted-foreground">
            Your journeys are kept in the project and are not affected. Reloading draws the page again.
          </p>
          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border px-3 py-1 text-[0.85rem] text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              Reload
            </button>
          </div>
        </section>
      )
    }
    return (
      <p
        role="alert"
        data-crashed={this.props.name ?? 'part'}
        className="border-t pt-3 pb-1 text-[0.85rem] leading-6 text-muted-foreground [overflow-wrap:anywhere]"
      >
        {this.props.name ? `${this.props.name[0]!.toUpperCase()}${this.props.name.slice(1)}` : 'This part'} could not be
        drawn: <span className="font-mono text-[0.8rem] text-foreground">{errorWords(error)}</span>{' '}
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
        >
          draw it again
        </button>
      </p>
    )
  }
}
