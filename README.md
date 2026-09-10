# Daybook

A quiet collection of **twelve daily logic puzzles**, with unlimited practice, guided tutorials, and
offline play. Built with **Phaser 3, TypeScript, Vite, and Deno 2**; the puzzle boards,
illustrations, menus, and controls are drawn in the game engine.

**[Play Daybook](https://puzzle.dumbhome.uk)** · [MIT License](LICENSE)

- **A fresh daily collection:** one puzzle of each kind, a rotating featured game, and a calendar
  showing started and completed days.
- **Unlimited practice:** generate another puzzle whenever you want, independently of daily
  progress.
- **Install and play offline:** a phone-friendly PWA with on-device puzzle generation and locally
  saved daily progress.
- **Learn the rules:** first-visit tutorials for all twelve games, replayable from each puzzle page.
  Every tutorial starts with a finished example; highlights explain each rule.
- **Two kinds of hints:** preview one revealed move or an explained logical deduction in any daily
  or practice puzzle. Hints run locally and work offline.
- **Comfortable night play:** warm paper and dim night themes, larger readable labels, gentle touch
  feedback, and an optional timer. Completed puzzles remain visible beside or above the next-puzzle
  controls.
- **No account, points, or streaks:** solving time is recorded, with no leaderboard, sounds, or
  cross-device profile.

## The games

| Game            | Goal                                                                                                                     | Board |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| Sudoku          | Place 1–9 once in each row, column, and 3 × 3 box                                                                        | 9 × 9 |
| Pipes           | Rotate pipes to connect every tile and endpoint to the water source without leaks                                        | 5 × 5 |
| Atoms           | Match each atom's required bonds using one or two lines between adjacent atoms; connect the whole network                | 4 × 4 |
| Killer Sudoku   | Follow Sudoku rules and satisfy cage totals, without repeating digits inside a cage                                      | 9 × 9 |
| Regional Queens | Place one queen per row, column, and region; queens cannot touch, even diagonally                                        | 6 × 6 |
| Shikaku         | Cover the grid with rectangles, each containing one clue equal to its area                                               | 6 × 6 |
| Number Path     | Visit numbered dots in order along one path that fills every square exactly once                                         | 5 × 5 |
| Balance         | Place three of each shape per row and column, with no three consecutive identical shapes; satisfy = and × clues          | 6 × 6 |
| Mosaic          | Shade squares so every clue matches its surrounding 3 × 3 area, including its own square                                 | 6 × 6 |
| Dosun-Fuwari    | Place one supported balloon and one supported weight in each region                                                      | 6 × 6 |
| Nurikabe        | Make numbered islands of exact sizes, with one clue each, surrounded by connected water with no solid 2 × 2 water blocks | 5 × 5 |
| Five Cells      | Partition the grid into connected groups of five; clues count bordering sides, including the outer frame                 | 5 × 5 |

Completion is checked against each game's rules. Sudoku, Killer Sudoku, Regional Queens, Shikaku,
Balance, Mosaic, Dosun-Fuwari, Nurikabe, and Five Cells have solver-checked unique solutions. Pipes,
Atoms, and Number Path are generated from valid constructions and accept any valid solution.

Regional Queens uses the regional placement rules, so queens do not attack along an entire chess
diagonal. Balance does not require different rows to have unique patterns. Atoms connects only
orthogonally adjacent grid cells. Mosaic is a gentler Fill-a-Pix variant: numbered squares start
with their correct shading locked; empty marks on other squares are optional aids and unshaded
squares can stay blank. Unused Dosun-Fuwari squares can stay blank.

The additional rules references are Nikoli's
[Dosun-Fuwari](https://www.nikoli.co.jp/en/puzzles/dosun_fuwari/),
[Nurikabe](https://www.nikoli.co.jp/en/puzzles/nurikabe/), and
[Five Cells](https://www.nikoli.co.jp/en/puzzles/five_cells/). Daybook's generators, wording, and
Phaser drawings are independently implemented.

## Install and play offline

Daybook is an installable Progressive Web App. Open it online once and wait for **Available
offline** beneath the collection. Every puzzle is generated on your device, so today's collection,
practice, and the calendar work without a connection after the app is cached. Progress remains in
localStorage; there is no account or server download needed for each day's puzzles.

- **Android / Chrome:** use **Install Daybook** below the collection, or the browser's Install app
  menu item.
- **iPhone / iPad:** open the site in Safari, use **Share → Add to Home Screen**, and keep **Open as
  Web App** enabled if shown.
  ([Apple's installation guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios))
- Open the installed app online once too, and check for **Available offline** before leaving your
  connection. Browser and installed-app storage can be separate, so check your progress there.

The production build generates a versioned service worker that caches the complete app shell and
install icons. It never caches health checks or third-party requests. Updates download in the
background when online, on returning to the app, and once a minute while it is visible. A complete
new shell activates immediately; the app saves the open puzzle and reloads into the new release. The
same daily or practice puzzle reopens with its entries, notes and elapsed time. Old app caches are
removed only after the new shell has downloaded successfully; failed downloads keep the working
offline version. HTML, service-worker and other unversioned responses forbid browser/CDN caching;
hashed game assets stay cacheable. Existing installations from before this updater may need one
online refresh to start using it. Saved puzzle progress is preserved across updates. Clearing
browser/site data also removes the offline cache and progress, and browsers may evict stored data
when device space is low.

Installation requires HTTPS (localhost also works for testing). Development mode does not register a
service worker, keeping local edits fresh. To test offline support, run `deno task build` followed
by `deno task start`, open port 8000 online, wait for the offline-ready message, then disconnect and
reopen the app. See
[MDN's caching guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching).

## Guided rules tutorials

Each game's first visit on a device opens a short, step-by-step tutorial. Daily and practice share
the same per-game flag in local storage (`daybook:tutorials:v1:<kind>`). Finishing or skipping marks
that tutorial as seen; leaving before either lets it appear again next time. The **Tutorial** button
on every puzzle page replays it, including completed puzzles.

Every tutorial starts with a labeled finished example on a separate board, so players can see the
goal before learning the rules. Each following step explains a rule or control and highlights its
relevant cells, clues, regions or edges. Nurikabe also uses teaching boards to show allowed corner
touches and forbidden patterns, then returns to the current puzzle. Other games return to the
current board after the finished example. Tutorials never read the current puzzle’s solution,
suggest a move, or edit progress. Solving time pauses throughout. Use Previous/Next, the arrow keys,
or Enter to advance; Skip or Escape returns to the puzzle. The board stays visible beside or above
the instructions, in either theme. If local storage is unavailable, the seen flag lasts for the
current session only.

## Hints

The **Hint** button on every unfinished daily and practice puzzle offers two choices:

- **Smart hint:** applies logical rules to the visible clues and current entries, explains one
  forced placement or elimination, and highlights the relevant squares. It never reads the hidden
  answer. Existing entries and optional marks are treated as assumptions; detected contradictions
  are explained. When the implemented rules cannot prove a deduction, it says so.
- **Reveal move:** shows one cell, bond, boundary, rectangle, or path step from a generated
  solution. This is explicitly an answer reveal. Games with multiple solutions may have other valid
  moves. Any required path backtracking or replacement of overlapping rectangles is described first.

Both choices show a proposed move on a preview board before **Apply move** changes progress. Close
returns without edits. Applying a move creates one undo step while the puzzle remains unfinished,
prunes conflicting Sudoku notes, saves daily progress, and checks completion. Solving time pauses
while hints are open. Hints are computed on the device, work offline, and require no prewritten
puzzles, AI service, account, or network calls.

Logical rules include Sudoku singles and cage totals, Mosaic clue counts and overlapping areas,
Queens exclusions, Balance constraints, pipe orientation constraints, bond capacity, Shikaku
rectangle candidates, legal path continuations, island boundaries, supported pieces, and possible
five-square groups. They do not yet constitute a complete logical solver for every position.

## Daily collection and practice

- Each **local calendar date** deterministically seeds one puzzle of each kind. The same date and
  generator version produce the same puzzles on every device.
- Dosun-Fuwari, Nurikabe, and Five Cells join daily collections from **September 9, 2026**. Earlier
  dates retain nine games and their existing completion status. All twelve are available in
  practice. Existing generators and saved puzzle identifiers are unchanged.
- The featured game rotates through the kinds available on that date. Puzzles generate on demand, so
  an unattended server needs no cron job.
- The calendar allows past dates and prevents future-day play. A day is complete when all games
  available on that date are finished. Partial completion and started days have markers.
- Practice uses a fresh random seed on every opening and never changes the daily calendar. Practice
  state exists only for the current browser session.
- Entries, pencil notes, completion timestamps, and accumulated solving seconds are saved in
  localStorage. Daily progress resumes after reload. Undo/redo history is session-only. There is no
  cross-device sync or server-side profile.
- Time stops on completion, while a hint, tutorial, pause, rules, or settings dialog is open, while
  the tab is hidden, and when leaving the puzzle. A hidden tab requires resuming.
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
  Placing an answer removes notes that conflict with written numbers in the same row, column, box,
  or Killer cage. Undo restores the entry and its removed notes together. Double-tap or double-click
  a cell with exactly one note to fill its number, even with notes on. Digits with nine placed
  copies turn gray and cannot be entered from the keypad or keyboard; clearing or undoing an entry
  enables them again.
- **Pipes:** tap to rotate clockwise.
- **Atoms:** tap midway between two atoms to cycle no bond → one line → two lines. With a keyboard,
  select an atom with arrows, then Shift + an arrow cycles its bond.
- **Regional Queens:** click or tap to mark a large X, or drag across cells to paint Xs.
  Double-click or double-tap to place a queen. Tap a mark to clear it. Dragging preserves queens and
  is undone as one action. With a keyboard, arrows select and Space cycles the marks.
- **Balance / Mosaic:** tap to cycle an editable cell’s three states. Mosaic’s numbered squares have
  fixed shading; only the unnumbered squares are editable. It finishes when shaded squares satisfy
  every clue; empty marks are optional. Mosaic clues turn red for excess shading, or for too little
  shading once their whole neighborhood is decided. Untouched areas stay neutral; edges count only
  on-board cells.
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

## Structure

- `src/main.ts`: Phaser scenes, responsive engine UI, input, themes, and timers.
- `src/puzzles.ts`: deterministic generators, constraint solvers, validators.
- `src/extra-puzzles.ts`: generators, solvers, and validators for the three added games.
- `src/input.ts`: Sudoku note cleanup and Queens tap/double-tap and drag gesture state.
- `src/hints.ts`: local deductions and one-move reveals with preview explanations.
- `src/tutorial-boards.json`: fixed finished teaching boards, independent of playable puzzles.
- `src/tutorials.ts`: rules walkthroughs, visible-board highlights, and device first-visit flags.
- `src/pwa.ts`: installation prompts, service worker registration, and offline status.
- `src/service-worker.js`: offline cache lifecycle; Vite injects the build hash and asset list.
- `public/manifest.webmanifest` / `public/icons/`: phone installation metadata and icons.
- `src/storage.ts`: dates, feature rotation, durations, and local persistence.
- `tests/`: generation, validation, persistence, gesture, note, and tutorial regression coverage.
- `server.ts`: production static server, cache headers, and health endpoint.
- `Dockerfile` / `compose.yaml`: standalone container hosting.

Potential next additions: Nonograms (picture logic) and Slitherlink (one continuous loop). They fit
the same daily format; they are suggestions, not part of the current collection.

Framework references: [Vite with Deno](https://docs.deno.com/examples/vite_tutorial/) and
[Phaser scaling](https://docs.phaser.io/phaser/concepts/scale-manager).

## Verification

The current code passes **39 regression tests**, TypeScript checking, lint, and a production build.
Run the maintained checks with `deno task check`, `deno task test`, and `deno task build`.

The regression suite covers deterministic generation, uniqueness where required, rule validation,
dates and progress storage, Sudoku note cleanup, Queens gestures, tutorial flags, and highlight
bounds. Finished examples and Nurikabe’s teaching boards are checked by the same validators as the
games. Tutorial and smart-hint tests prevent access to hidden puzzle solutions. Hint coverage checks
sound deductions against valid completions, explicit correction previews, and progressive reveals
for every game. Mosaic save migration preserves existing marks and elapsed time.

Browser checks cover all twelve tutorials at phone, landscape, and desktop sizes; first visits,
replay, daily/practice flags, paused time, and unchanged puzzle progress. Input checks include
Sudoku multi-cell notes and single-note double taps, disabled completed digits, undo/redo, touch
feedback, and saved daily completion. Hint checks cover both modes, preview isolation, paused time,
apply/undo, responsive layouts, and offline use; Mosaic checks cover locked clues and completion
without empty marks.

Production PWA checks cover Chrome installability, offline reload and browser restart, saved
progress, automatic upgrades with daily/practice resume, failed-update recovery, and cache cleanup.
Physical iPhone installation has not been verified on a device.

The Dockerfile has been built and tested with Podman for `linux/amd64` on Apple Silicon. The
container passes health and asset checks with a non-root user, read-only filesystem, dropped
capabilities, and a 256 MiB memory limit. Deployment checks verify the running image, public assets,
and offline loading.

## License and third-party software

Daybook is released under the [MIT License](LICENSE), copyright 2026 Carlos Ravelo.

The puzzle generators, interface, and rule descriptions are independently implemented. The project
uses established puzzle mechanics and is not affiliated with other puzzle publishers. No
screenshots, artwork, or puzzle collections from other games are included.

[Third-party notices](public/THIRD_PARTY_NOTICES.txt) preserve the MIT licenses for Phaser,
EventEmitter3, and the Vite build tool. Each production build also emits `dependency-licenses.txt`
with notices for bundled dependencies. The Deno runtime is distributed separately; see its
[license](https://github.com/denoland/deno/blob/main/LICENSE.md).
