/**
 * The screens for "there is nothing here to read", none of which is an error.
 *
 * They exist because this app is honest about a nullable fact the protocol
 * hands over and about a file it may not be able to open — and a module that
 * drew either as an empty list would be telling somebody their journeys are
 * gone when they are merely somewhere else, or still on disk and unreadable.
 *
 * "No project" is the protocol's shared cover now, with this module's second
 * line under it; "that project's file will not read" and "this project has
 * none yet" are still this module's own, because they say opposite things
 * about what to do next and neither is a readiness state.
 */

/**
 * What the shared cover says under its own sentence when nothing said which project this canvas is
 * standing in — a page nobody is framing, or a host that knows a project's name and has no folder
 * to point at (`context.projectPath` is nullable).
 *
 * The cover (the protocol's `Cover`, drawn in `app.tsx`) says which fact is missing. These say
 * what follows from it HERE: a journey lives inside the project it is about, so this app will not
 * guess — guessing means writing somebody's narrative into a repository they never pointed at, and
 * reporting that it saved.
 *
 * What neither does is offer a list of projects that have journeys. That list is not available
 * here and its absence is the design working: the path IS the partition, so this app has no store
 * to enumerate and no way to know which folders on the machine hold a
 * `.kehikot/journeys/journeys.json`. A picker would be this page deciding where it is standing,
 * which is the one thing it has just said it cannot know.
 */
export const UNHOSTED_SAID =
  'The journeys are not missing — they are kept inside each project, in .kehikot/journeys/journeys.json, and which '
  + 'project to open is a question only a host can answer.'

export const NO_PROJECT_SAID =
  'A journey is kept inside the project it is about, in .kehikot/journeys/journeys.json, so this container will not '
  + 'guess at a folder.'

/**
 * A project was named, and this app will not read under it.
 *
 * The folder is gone, the path is relative, `.kehikot` resolves outside the
 * project it claims to be inside, or the file will not parse. All of them are
 * one thing from the reader's side: material that exists and is not being
 * shown, which must never look like material that does not exist.
 *
 * The sentence comes from the server rather than being composed here, because
 * the server is what knows which of those it was — and because a file that will
 * not parse is recoverable, and the word "recoverable" in front of somebody is
 * the difference between fixing a file and deleting a directory.
 */
export function Trouble({ trouble }: { trouble: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-[0.9rem] font-semibold">The journeys for this project could not be read</h2>
      <p className="text-[0.82rem] leading-6 text-muted-foreground">{trouble}</p>
      <p className="text-[0.82rem] leading-6 text-muted-foreground">
        Nothing is being written while this is true. Whatever is in that file is still in it.
      </p>
    </section>
  )
}

/**
 * A real project, opened, with no journeys in it.
 *
 * The honest first screen, and the reason nothing seeds itself any more. This
 * used to be filled automatically with the journeys this app ships with, which
 * was defensible while the store was this app's own directory and is not now
 * that it is a folder inside somebody's repository — it would put thirteen
 * narratives about another codebase into their project and make them that
 * project's answer forever, with nothing on screen looking wrong.
 *
 * So: no journeys means no journeys. It is a true thing to say about the
 * project the reader is actually looking at, which the full screen never was.
 */
export function NoJourneys({ from }: { from: string | null }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-[0.9rem] font-semibold">No journeys have been written for this project</h2>
      <p className="text-[0.82rem] leading-6 text-muted-foreground">
        Nothing is hidden and nothing is elsewhere — this project genuinely has none yet. A journey is a hand-written
        account of what has to become true for a user; nothing here ships one, because a shipped journey is this
        program having an opinion about somebody else’s work.
      </p>
      {from && (
        <p className="text-[0.75rem] leading-5 text-muted-foreground">
          They would be kept in <span className="font-mono text-[0.9em] [overflow-wrap:anywhere]">{from}</span>.
        </p>
      )}
    </section>
  )
}
