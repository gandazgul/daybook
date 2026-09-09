# Daybook

Nine daily logic puzzles, a calendar, and a quiet place to play. Built entirely in **Phaser 3**,
with **TypeScript, Vite, and Deno 2**. All boards, illustrations, menus, dialogs, and controls are
drawn in the engine. No image service, artwork assets, account, score, streak, audio, or external
font is required.

## Run locally

Install [Deno 2](https://docs.deno.com/runtime/getting_started/installation/), then:

```sh
deno install --frozen
deno task dev
```

Open [Daybook locally](http://localhost:5198). The development server uses port 5198 with strict
port checking. To select a different port:

```sh
deno task dev --port 5200
```

```sh
deno task check  # TypeScript and lint
deno task test   # Generation, uniqueness, validation, dates, and persistence
deno task build  # Checked, optimized production build
deno task start  # Production server on port 8000
```

## Host with a container

```sh
podman build --format docker -t daybook .
podman run --rm --name daybook --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=256m -p 8000:8000 daybook
```

Open [Daybook on port 8000](http://localhost:8000). `compose.yaml` is also available for
Compose-compatible tooling.

To build on Apple Silicon for an amd64 host, add `--platform linux/amd64` to the build command. Tag
the resulting image for your registry and push it using `podman push`.

For Kubernetes, expose container port 8000 through a Service and your HTTPS Ingress. Use `/healthz`
for readiness and liveness probes. The server supports running as UID/GID 1000 with a read-only
filesystem and all Linux capabilities dropped. A 256 MiB memory limit passed the container smoke
test, including amd64 emulation on Apple Silicon.

The multi-stage image builds with Deno, then runs a small dependency-free Deno static server as a
non-root user. Compose makes the filesystem read-only and drops Linux capabilities. `/healthz` is
the health endpoint. Put your normal HTTPS reverse proxy in front for a public domain. There are no
backend data volumes or scheduled generation jobs to maintain. `PORT` configures the server's listen
port; Compose's published port must match if you change it.

## The games

| Game            | Rules                                                                                                | Generated board                          |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Sudoku          | Digits 1–9 once per row, column, and 3 × 3 box                                                       | 9 × 9, unique solution                   |
| Pipes           | Rotate tiles to connect every pipe and endpoint to the source, without leaks                         | 5 × 5, constructed from a connected tree |
| Atoms           | Satisfy each numbered atom with single or double bonds to adjacent atoms; connect the entire network | 4 × 4, one or two lines per bond         |
| Killer Sudoku   | Sudoku plus outlined sum cages with no repeated digits                                               | 9 × 9, unique solution                   |
| Regional Queens | One queen per row, column, and region; no touching, including diagonally                             | 6 × 6, unique solution                   |
| Shikaku         | Cover the grid with rectangles; each contains one clue equal to its area                             | 6 × 6, unique solution                   |
| Number Path     | Visit numbered dots in order with a single path that fills every square                              | 5 × 5, a constructed Hamiltonian path    |
| Balance         | Three of each shape per row/column, no three consecutive, respecting = and × clues                   | 6 × 6, unique solution                   |
| Mosaic          | Each clue counts shaded squares in its surrounding 3 × 3 area, including itself                      | 6 × 6, unique solution                   |

Number Path, Pipes, and Atoms accept **any valid solution**, not just the generated witness.
Regional Queens follows the regional queen-placement rules (not full chess queen diagonals). Balance
uses the two-symbol rules; it does not add a separate rule forbidding duplicate rows. Mosaic is the
Fill-a-Pix interpretation. Atoms uses orthogonally adjacent cells, with no line crossing or diagonal
bonds. All generators and validators live in `src/puzzles.ts`, independent of Phaser.

## Daily collection and practice

- Each **local calendar date** deterministically seeds one puzzle of each kind. The same date and
  generator version produce the same puzzles on every device.
- The featured game rotates through all nine kinds. All nine remain available every day. Puzzles
  generate on demand, so an unattended server needs no cron job.
- The calendar allows past dates and prevents future-day play. A day is complete when all nine are
  finished. Partial completion and started days have markers.
- Practice uses a fresh random seed on every opening and never changes the daily calendar. Practice
  state exists only for the current browser session.
- Entries, pencil notes, completion timestamps, and accumulated solving seconds are saved in
  localStorage. Daily progress resumes after reload. Undo/redo history is session-only. There is no
  cross-device sync or server-side profile.
- Time stops on completion, while a pause, rules, or settings dialog is open, while the tab is
  hidden, and when leaving the puzzle. A hidden tab requires resuming.
- At midnight, the collection updates to the new day; an open puzzle stays on its original date so
  current work is not interrupted.

Changing the generator after release requires preserving the versioned algorithm or introducing a
new generator version; otherwise archived puzzles would change. Clearing browser data also clears
your puzzle history. If storage is blocked, the collection shows that progress is temporary.

Completed puzzles remain visible, with the success message and next-puzzle button beside the board
on desktop or below it on smaller screens.

## Night play and controls

Night mode is selected on first use between 7 pm and 7 am, using the device's clock. The header
theme button switches between warm paper and dim night colors; your choice is remembered. The timer
is hidden by default but still records time. Puzzle settings let you show it and reset the current
board. No flashing effects, celebration animations, sounds, leaderboards, streaks, or urgency cues
are used.

- **Sudoku / Killer:** tap a cell, then use the keypad or 1–9. `N` toggles notes; Backspace/Delete
  clears. Fixed clues cannot be edited. Conflicting digits are highlighted without revealing the
  answer.
- **Pipes:** tap to rotate clockwise.
- **Atoms:** tap midway between two atoms to cycle no bond → one line → two lines. With a keyboard,
  select an atom with arrows, then Shift + an arrow cycles its bond.
- **Regional Queens / Balance / Mosaic:** tap to cycle the cell's three states. In Regional Queens,
  crosses are optional notes. In Mosaic, mark all unshaded squares as empty.
- **Shikaku:** drag between opposite corners, or tap two corners. Tap a placed rectangle to remove
  it. Invalid rectangles are rejected with a short message.
- **Number Path:** drag or tap adjacent cells. Tap an earlier path cell to backtrack.
- **All puzzles:** `U` or Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Escape pauses. Arrows select
  cells and Space activates them. Tab cycles menu controls; Enter activates the focused control.
  Wheel or touch-drag scrolls the collection.

The layout adapts to phones and desktop windows. Region letters supplement color. Canvas controls
have keyboard navigation and a live text announcement region; this is not yet a full screen-reader
grid interface.

## Structure

- `src/main.ts`: Phaser scenes, responsive engine UI, input, themes, and timers.
- `src/puzzles.ts`: deterministic generators, constraint solvers, validators.
- `src/storage.ts`: dates, feature rotation, durations, and local persistence.
- `tests/puzzles_test.ts`: puzzle and persistence regression coverage.
- `server.ts`: production static server, cache headers, and health endpoint.
- `Dockerfile` / `compose.yaml`: standalone container hosting.

Potential next additions: Nonograms (picture logic), Slitherlink (one continuous loop), and Nurikabe
(islands and connected water). They fit the same daily format; they are suggestions, not part of the
current nine-game collection.

Framework references: [Vite with Deno](https://docs.deno.com/examples/vite_tutorial/) and
[Phaser scaling](https://docs.phaser.io/phaser/concepts/scale-manager).

## Verification

The initial implementation passed type checking, lint, eight regression tests, and a production
build. A separate full-year sweep generated and validated **3,285 puzzles (all nine games for every
day of 2027)**. Browser checks cover phone and desktop rendering, Regional Queens completion, saved
completion after reload, Sudoku notes and keyboard entry, Atoms single/double bonds and undo, Mosaic
shading, Number Path dragging, and Shikaku rectangles.

The production Deno server was checked directly. The Dockerfile also builds successfully with Podman
for `linux/amd64` on an Apple Silicon host. Container verification covers non-root operation, a
read-only filesystem, dropped capabilities, the image health check, HTML and bundled assets, cache
headers, and invalid request handling. The container passed at a 256 MiB memory limit; a 128 MiB
limit caused an OOM during startup under amd64 emulation.

## License and third-party software

Daybook is released under the [MIT License](LICENSE), copyright 2026 Carlos Ravelo.

The puzzle generators, interface, and rule descriptions are independently implemented. The project
uses established puzzle mechanics and is not affiliated with other puzzle publishers. No
screenshots, artwork, or puzzle collections from other games are included.

[Third-party notices](public/THIRD_PARTY_NOTICES.txt) preserve the MIT licenses for Phaser,
EventEmitter3, and the Vite build tool. Each production build also emits `dependency-licenses.txt`
with notices for bundled dependencies. The Deno runtime is distributed separately; see its
[license](https://github.com/denoland/deno/blob/main/LICENSE.md).
