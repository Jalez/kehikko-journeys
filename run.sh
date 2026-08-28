#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7840 is the
#     default, and it is the number in the registration too — 7830 and 7820
#     belong to Atlas and References on this machine.
#   - `exec`, and the foreground. A script that forks and returns leaves
#     whoever started it holding a pid that stops nothing, and Stop is only
#     ever offered for what a host started.
#   - `cd` to this script's own directory, so the app's store is beside the
#     program however it was invoked.
#
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
#
# ## There is no build here, and no `dist`
#
# There was going to be. The argument for one is that starting should be
# starting: a start that shells out to a build is a start that fails when the
# network is down. The argument is fine and the shape is still wrong, because
# this program is not deployed — it runs on the machine of the person editing
# it. What `dist` actually buys is a STALE page served with a 200, every symptom
# of a working app and none of the changes, and that failure has cost this
# codebase whole afternoons three separate times in three different programs. A
# missing build announces itself. A stale one does not.
#
# So Vite serves the page, as Vite is for. The manifest, the health check, the
# MCP door and this app's own store are middleware in front of the same server —
# see `doors()` in `vite.config.ts` — because a module is one origin or it is
# nothing, and because a page that fetched its own journeys from a second port
# would be fetching them cross-origin from an opaque origin, which is to say not
# at all.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite --host 127.0.0.1 --port "${PORT:-7840}" --strictPort
