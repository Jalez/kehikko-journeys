import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's textarea, holding the one field on this page that is somebody's
 * writing rather than a value.
 *
 * `field-sizing-content` with a floor and a ceiling: a step's body is anywhere
 * between one sentence and two hundred words, and a fixed seven-rem box is
 * either a scrollbar around a paragraph or an empty half-screen. The ceiling is
 * there because a container is not a document editor and an unbounded box pushes the
 * Save button off the bottom of it.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-24 max-h-[60vh] w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1.5 text-sm leading-relaxed shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
