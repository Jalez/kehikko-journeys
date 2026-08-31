import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's input, sized for a container rather than for a page.
 *
 * `h-8` and not `h-9`: the editor puts four of these in a column inside a container
 * that is often 340 pixels tall, and a control sized for a settings screen
 * spends the whole of it on the chrome around somebody's sentence.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
