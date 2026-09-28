# Daybook domain language

This document defines the terms used in Daybook's product and code. Use these terms consistently in interface text, tests, and documentation.

## Puzzles and collections

- **Game**: A kind of logic puzzle, such as Sudoku or Pipes. A game defines its rules and board format.
- **Puzzle**: One board for one game, identified by its game kind and seed. A puzzle has clues, player progress, and a solution used by validation and reveal hints.
- **Daily collection**: The set of games offered for a calendar date. The available games can vary by date. A collection can include only one puzzle per game kind.
- **Daily puzzle**: A puzzle opened from a date's daily collection. Its progress is saved for that date and game kind.
- **Practice puzzle**: A puzzle generated for practice rather than a daily collection. Practice is unlimited and does not count toward daily completion.
- **Featured game**: The game highlighted as the collection's featured choice. It is a shortcut to a daily puzzle, not a separate puzzle or progress record.
- **Game kind**: The stable identifier for a game, such as `sudoku`, `pipes`, or `nurikabe`. Code and saved data use this identifier; display names can be clearer or longer.

## Rules and difficulty

- **Clue**: Information printed on a board that constrains valid solutions, such as a number, a region, or a required bond count.
- **Entry**: A value or mark the player puts on the board. An entry is not necessarily correct.
- **Note**: An optional player mark used to track candidates or possibilities. Notes do not replace entries.
- **Solution**: A complete board that satisfies the game's rules. Some games can accept more than one valid solution.
- **Completion**: The board passes that game's validation rules. Completion does not mean that every cell must contain an entry; some games permit blank cells.
- **Difficulty**: A label for a puzzle's challenge level where the game supports difficulty choices. `Classic` means the original version without a selected difficulty variant. Not every game supports every choice.
- **Reveal move**: A hint that uses a generated solution to show an answer. It is distinct from a smart hint.
- **Smart hint**: An explanation of a deduction supported by the visible clues and current entries. It does not inspect the hidden solution.

## Dates and saved progress

- **Collection date**: The calendar date used to choose the daily games and puzzles. It is represented in code as a date string in `YYYY-MM-DD` form.
- **Calendar day**: A date shown in the calendar. It can have no progress, started progress, or completed progress.
- **Progress**: The saved state of a puzzle, including player entries, notes, elapsed time, and completion where applicable.
- **Started**: A puzzle has saved progress but is not complete.
- **Completed**: A puzzle passes validation and is recorded as complete.
- **Local storage**: Browser storage used for progress and preferences on the current device. Daybook has no account or cross-device profile.
- **Archive snapshot**: A checked-in, fixed puzzle record for a date. Snapshots keep published daily boards stable when puzzle-generation code changes.

Daily progress belongs to its collection date and game kind. Practice progress is separate from daily progress. Do not use *streak*, *score*, or *account* to describe Daybook features: the app does not provide them.

## Interface terms

- **Collection**: The screen listing the day's available games.
- **Tutorial**: A guided explanation of a game's rules and controls. It uses teaching examples and does not change the current puzzle.
- **Hint**: An optional assistance flow. It offers a smart hint or a reveal move when available.
- **Undo**: Revert the most recent player change, including an applied hint move where supported.
- **Theme**: The display palette, such as the light paper theme or night theme. A theme does not change puzzle rules or progress.

## Naming guidance

Use **game** for a rule set and its user-facing choice; use **puzzle** for a particular board. Say **daily collection** when referring to the set for a date, and **daily puzzle** when referring to one board from it. Say **practice** for non-daily play. Keep persisted game-kind identifiers stable even if a display name changes. Refer to assistance specifically as a **smart hint** or **reveal move** when the distinction matters.
