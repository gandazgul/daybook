# Daybook

Twelve daily logic puzzles, a calendar, and a quiet place to play. Built entirely in **Phaser 3**,
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

## Install and play offline

Daybook is an installable Progressive Web App. Open it online once and wait for **Available
offline** beneath the collection. Every puzzle is generated on your device, so today's collection,
practice, and the calendar work without a connection after the app is cached. Progress remains in
localStorage; there is no account or server download needed for each day's puzzles.

- **Android / Chrome:** use **Install Daybook** below the collection, or the browser's Install app
  menu item.
- **iPhone / iPad:** open the site in Safari, use **Share → Add to Home Screen**, and keep **Open as
  Web App** enabled if shown. ([Apple's installation guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios))
- Open the installed app online once too, and check for **Available offline** before leaving your
  connection. Browser and installed-app storage can be separate, so check your progress there.

The production build generates a versioned service worker that caches the complete app shell and
install icons. It never caches health checks or third-party requests. Updates download in the
background when online and wait until all Daybook tabs/windows close before activating. This keeps
an open puzzle on one consistent build; the previous app cache is removed after activation.
Saved puzzle progress is preserved across updates. Clearing browser/site data also removes the
offline cache and progress, and browsers may evict stored data when device space is low.

Installation requires HTTPS (localhost also works for testing). Development mode does not register
a service worker, keeping local edits fresh. To test offline support, run `deno task build` followed
by `deno task start`, open port 8000 online, wait for the offline-ready message, then disconnect and
reopen the app. See [MDN's caching guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching).

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
bonds. Generators and validators live in `src/puzzles.ts` and `src/extra-puzzles.ts`, independent
of Phaser.

The additional games follow the rules described by Nikoli, using original generators, wording, and
Phaser drawings: [Dosun-Fuwari](https://www.nikoli.co.jp/en/puzzles/dosun_fuwari/),
[Nurikabe](https://www.nikoli.co.jp/en/puzzles/nurikabe/), and
[Five Cells](https://www.nikoli.co.jp/en/puzzles/five_cells/).

- **Dosun-Fuwari (6 × 6):** one balloon and one weight in each region, supported vertically by the
  appropriate outer edge, a rock, or the same kind of piece. Region walls do not support pieces.
- **Nurikabe (5 × 5):** numbered islands of exact sizes, separated by a connected sea with no 2 × 2
  sea squares. Each island has one clue.
- **Five Cells (5 × 5):** connected groups of five cells, with clues counting the bordering sides of
  a cell, including the outer frame. No extra borders inside groups.

All three have deterministic, solver-checked unique solutions. Dosun-Fuwari reshapes connected
regions while retaining uniqueness; Nurikabe builds a sea and validates island clues; Five Cells
uses pentomino tilings and removes redundant clues. Completion checks the rules, not equality with
the generator's stored solution.

## Daily collection and practice

- Each **local calendar date** deterministically seeds one puzzle of each kind. The same date and
  generator version produce the same puzzles on every device.
- Dosun-Fuwari, Nurikabe, and Five Cells join daily collections from **September 9, 2026**. Earlier
  dates retain nine games and their existing completion status. All twelve are available in
  practice. Existing generators and saved puzzle identifiers are unchanged.
- The featured game rotates through the kinds available on that date. Puzzles generate on demand,
  so an unattended server needs no cron job.
- The calendar allows past dates and prevents future-day play. A day is complete when all games
  available on that date are finished. Partial completion and started days have markers.
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

## Guided rules tutorials

Each game's first visit on a device opens a short, step-by-step tutorial. Daily and practice share
the same per-game flag in local storage (`daybook:tutorials:v1:<kind>`). Finishing or skipping marks
that tutorial as seen; leaving before either lets it appear again next time. The **Tutorial**
button on every puzzle page replays it, including completed puzzles.

Each step explains a rule or control and highlights its relevant cells, clues, regions or edges.
Nurikabe uses labeled teaching boards to show completed islands and water, allowed corner touches,
and forbidden patterns, then returns to the current puzzle. Other tutorials highlight the current
board throughout. Tutorials never read the solution, suggest a move, or edit progress. Solving time
pauses throughout. Use Previous/Next, the arrow keys, or Enter to advance; Skip or Escape returns to
the puzzle. The board stays visible beside or above the instructions, in either theme. If local
storage is unavailable, the seen flag lasts for the current session only.

## Night play and controls

Night mode is selected on first use between 7 pm and 7 am, using the device's clock. The header
theme button switches between warm paper and dim night colors; your choice is remembered. The timer
is visible by default. Hide it by tapping it or using puzzle settings; when hidden, no placeholder
is shown and solving time is still recorded. Settings let you show it again and reset the current
board. No flashing effects, celebration animations, sounds, leaderboards, streaks, or urgency cues
are used. Touches receive a brief, muted ring that gently expands and fades. With the system’s
reduced-motion setting, this becomes a stationary highlight.

- **Sudoku / Killer:** tap a cell, then use the keypad or 1–9. `N` toggles notes; Backspace/Delete
  clears. Fixed clues cannot be edited. Conflicting digits are highlighted without revealing the
  answer. Drag across cells to select several and automatically enable notes. A keypad digit adds
  that note to every selected empty cell, or removes it when they all already contain it. Existing
  answers and fixed clues stay intact during bulk note entry. Each batch is one undo step. Tap a
  cell or use an arrow to return to a single selection; turning notes off also selects one cell.
  Placing an answer removes notes that conflict with written numbers in the same row, column,
  box, or Killer cage. Undo restores the entry and its removed notes together.
  Double-tap or double-click a cell with exactly one note to fill its number, even with notes on.
  Digits with nine placed copies turn gray and cannot be entered from the keypad or keyboard;
  clearing or undoing an entry enables them again.
- **Pipes:** tap to rotate clockwise.
- **Atoms:** tap midway between two atoms to cycle no bond → one line → two lines. With a keyboard,
  select an atom with arrows, then Shift + an arrow cycles its bond.
- **Regional Queens:** click or tap to mark a large X, or drag across cells to paint Xs.
  Double-click or double-tap to place a queen. Tap a mark to clear it. Dragging preserves queens and
  is undone as one action. With a keyboard, arrows select and Space cycles the marks.
- **Balance / Mosaic:** tap to cycle the cell's three states. In Mosaic, mark all unshaded squares
  as empty. Mosaic clues turn red for excess shading, or for too little shading once their whole
  neighborhood is decided. Untouched areas stay neutral; edges count only on-board cells.
- **Shikaku:** drag between opposite corners, or tap two corners. Tap a placed rectangle to remove
  it. Invalid rectangles are rejected with a short message.
- **Number Path:** drag or tap adjacent cells. Tap an earlier path cell to backtrack.
- **Dosun-Fuwari:** tap to cycle balloon → weight → X note → clear. Rocks are fixed; X notes are
  optional and unused squares can stay blank. Balloons are white balloon shapes; weights are black
  with a wider base, in both themes. Arrows and Space work too.
- **Nurikabe:** tap to cycle sea → island dot → clear. Numbered cells are fixed land. Mark all other
  cells to finish; arrows and Space also work.
- **Five Cells:** tap an internal grid edge to add/remove a border. Drag along grid lines to draw or
  erase several borders as one undoable action. The outer frame is fixed. With a keyboard, arrows
  select a cell and Shift + an arrow toggles its shared border. Groups of five gain a tint.
- **All puzzles:** `U` or Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Escape pauses. Arrows select
  cells and Space activates them. Tab cycles menu controls; Enter activates the focused control.
  Wheel or touch-drag scrolls the collection.

The layout adapts to phones and desktop windows. Region letters supplement color. Canvas controls
have keyboard navigation and a live text announcement region; this is not yet a full screen-reader
grid interface.

## Structure

- `src/main.ts`: Phaser scenes, responsive engine UI, input, themes, and timers.
- `src/puzzles.ts`: deterministic generators, constraint solvers, validators.
- `src/extra-puzzles.ts`: generators, solvers, and validators for the three added games.
- `src/input.ts`: queen tap/double-tap and drag gesture state.
- `src/tutorials.ts`: rules walkthroughs, visible-board highlights, and device first-visit flags.
- `src/pwa.ts`: installation prompts, service worker registration, and offline status.
- `src/service-worker.js`: offline cache lifecycle; Vite injects the build hash and asset list.
- `public/manifest.webmanifest` / `public/icons/`: phone installation metadata and icons.
- `src/storage.ts`: dates, feature rotation, durations, and local persistence.
- `tests/puzzles_test.ts`: puzzle and persistence regression coverage.
- `server.ts`: production static server, cache headers, and health endpoint.
- `Dockerfile` / `compose.yaml`: standalone container hosting.

Potential next additions: Nonograms (picture logic) and Slitherlink (one continuous loop). They fit
the same daily format; they are suggestions, not part of the current collection.

Framework references: [Vite with Deno](https://docs.deno.com/examples/vite_tutorial/) and
[Phaser scaling](https://docs.phaser.io/phaser/concepts/scale-manager).

## Verification

Tutorial tests cover all twelve games, daily/practice seeds, in-bounds highlights, no solution
access, and per-game seen flags with persistent, damaged and unavailable storage. Browser checks
cover first visits, replay, navigation, paused time, protected progress and responsive layouts.

PWA checks cover Chrome installability, all twelve puzzles offline, saved notes and completion after
offline reload and a full browser restart, waiting updates, old assets remaining available during
an update, and cache cleanup after activation. The updated app also reopens offline with saved
progress intact. Physical iPhone installation still requires checking on the device.

The initial implementation passed type checking, lint, eight regression tests, and a production
build. A separate full-year sweep generated and validated **3,285 puzzles (all nine games for every
day of 2027)**. Browser checks cover phone and desktop rendering, Regional Queens completion, saved
completion after reload, Sudoku notes and keyboard entry, Atoms single/double bonds and undo, Mosaic
shading, Number Path dragging, and Shikaku rectangles.

Gesture regression coverage includes single/double taps, fast drags, preserving queens, revisiting
cells, cancellation, and grouped undo. Browser checks also cover touch feedback across all nine
games, reduced motion, multiple fingers, and completing Queens by double-tap.

The twelve-game collection passes type checking, lint, **21 regression tests**, and a production
build. A further full-year sweep generated **1,095 new puzzles** (365 per added game), checking
every solution's validity and uniqueness. The original nine puzzle payloads remain unchanged.
Browser checks cover the three added games on phone and desktop in light and night modes, touch
playthroughs, Five Cells border drawing/erasing and grouped undo/redo, keyboard borders, saved daily
completion, next-puzzle controls, and the calendar's nine-to-twelve-game transition.

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
