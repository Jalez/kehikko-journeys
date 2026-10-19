import { DOOR_PROJECT_SAYS, resolveDoorProject, type HostHasProjectOptions } from 'kehikot-module-protocol/serve'

/**
 * The one project check. A project is the host's to vouch for: a folder that exists on disk is not
 * enough, because a folder renamed away leaves its old path free for an unrelated one, and this module
 * would write `.kehikot/journeys/` into it.
 *
 * `answer()` resolves every project path a caller hands it here, once, at the door, and the rest of the
 * module works only on the path that comes back. `ASK` is where a test stands in for the host.
 */
export const ASK: { options: HostHasProjectOptions } = { options: {} }

export type Project = { ok: true; path: string; followed: string | null } | { ok: false; error: string }

export async function resolveProject(path: string): Promise<Project> {
  const at = await resolveDoorProject(path, ASK.options)
  if (!at.ok) return { ok: false, error: at.why }
  return { ok: true, path: at.path, followed: at.movedFrom ? DOOR_PROJECT_SAYS.followed(at.movedFrom, at.path) : null }
}
