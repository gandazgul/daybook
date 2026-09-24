import { ARCHIVE_START } from "./puzzle-archive.ts";
import { ScrollMomentum } from "./scroll.ts";
import { akariLights, AKARI_WHITE } from "./akari.ts";
import {
  dailyDifficulty, DIFFICULTIES, DIFFICULTY_LABELS, difficultyDescription,
  DifficultyChoices, type DifficultyChoice, isDifficulty, supportsDifficulty,
} from "./difficulty.ts";
import { ACTION_ICONS, drawActionIcon } from "./icons.ts";
import { cardAttributes, cardDescription, findSets, SET_ATTRIBUTES } from "./sets.ts";
import Phaser from "phaser";
import "./style.css";
import { type Hint, revealHint, smartHint } from "./hints.ts";
import { fiveRegions } from "./extra-puzzles.ts";
import { cyclePaintCells, gridLine, pruneSudokuNotes, QueensInput } from "./input.ts";
import { installDaybook, pwa, startPwa } from "./pwa.ts";
import { type TutorialStep, tutorialSteps, TutorialStore } from "./tutorials.ts";
import {
  adjacent,
  canStepNumberPath,
  generate,
  isSolved,
  type Kind,
  KINDS,
  kindsForDate,
  META,
  mosaicClueConflict,
  type Puzzle,
  rectangle,
  rotate,
  waterCells,
} from "./puzzles.ts";
import {
  dateKey,
  featured,
  formatTime,
  parseDate,
  type Progress,
  ProgressStore,
} from "./storage.ts";

type Page = "today" | "calendar" | "practice" | "game";
type Modal = "help" | "pause" | "reset" | "settings" | "install" | "tutorial" | "hint" | "difficulty" | null;
const LIGHT = {
  bg: 0xf6f5ef,
  panel: 0xfdfcf8,
  ink: 0x292e28,
  muted: 0x7d8176,
  line: 0xdcded3,
  accent: 0x566b51,
  soft: 0xe9ede2,
  white: 0xffffff,
  error: 0xa95745,
};
const DARK = {
  bg: 0x1c211f,
  panel: 0x242b27,
  ink: 0xd8d8c9,
  muted: 0x979f90,
  line: 0x3b443b,
  accent: 0xa1b394,
  soft: 0x323e31,
  white: 0x242b27,
  error: 0xd9977f,
};
// Render at device density while keeping layout and game logic in CSS pixels.
const RENDER_SCALE = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const blend = (a: number, b: number, t: number) => {
  const r = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (r(16) << 16) | (r(8) << 8) | r(0);
};
let browserStorage: Storage;
try {
  browserStorage = localStorage;
} catch {
  browserStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  } as unknown as Storage;
}
const store = new ProgressStore(browserStorage);
const difficultyChoices = new DifficultyChoices(browserStorage, (kind, seed) => !!store.get(seed, kind));
const tutorials = new TutorialStore(browserStorage);
let savedSettings: { night?: boolean; timer?: boolean } = {};
try {
  savedSettings = JSON.parse(browserStorage.getItem("daybook:settings") || "{}");
} catch { /* Safe defaults for private browsing. */ }

class Daybook extends Phaser.Scene {
  page: Page = "today";
  selectedDate = dateKey();
  month = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  night = savedSettings?.night ?? (new Date().getHours() >= 19 || new Date().getHours() < 7);
  showTimer = savedSettings?.timer ?? true;
  modal: Modal = null;
  difficultyTarget?: { kind: Kind; seed: string; choice: DifficultyChoice };
  settingsReturn: "tutorial" | "hint" | null = null;
  helpPage = 0;
  tutorialPage = 0;
  hint?: Hint;
  puzzle?: Puzzle;
  progress?: Progress;
  selected = -1;
  selectedCells = new Set<number>();
  reviewSet = -1;
  notes = false;
  history: { values: number[]; notes: Record<number, number[]> }[] = [];
  redoHistory: { values: number[]; notes: Record<number, number[]> }[] = [];
  board = { x: 0, y: 0, cell: 0, n: 0 };
  scrollY = 0;
  contentHeight = 0;
  rectStart = -1;
  pointerStart = -1;
  pointerLast = -1;
  pointerY = 0;
  scrollMomentum = new ScrollMomentum();
  pointerDragged = false;
  boardPointerId = -1;
  nurikabeVisited = new Set<number>();
  borderVisited = new Set<number>();
  borderLastPoint?: { x: number; y: number };
  borderPaintValue = 1;
  queensInput = new QueensInput();
  sudokuTap?: { index: number; time: number };
  sudokuPointerTime = 0;
  handledKeys = new WeakSet<KeyboardEvent>();
  touchPulses: { x: number; y: number; radius: number; time: number }[] = [];
  touchGraphics?: Phaser.GameObjects.Graphics;
  reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  clockText?: Phaser.GameObjects.Text;
  private textCache = new Map<string, Phaser.GameObjects.Text[]>();
  private nextTextCache?: Map<string, Phaser.GameObjects.Text[]>;
  private textCacheContext = "";
  notice = "";
  saveClock = 0;
  today = dateKey();
  get C() {
    return this.night ? DARK : LIGHT;
  }
  get W() {
    return this.scale.width / RENDER_SCALE;
  }
  get H() {
    return this.scale.height / RENDER_SCALE;
  }
  get mobile() {
    return this.W < 720;
  }
  get margin() {
    return Math.max(this.mobile ? 22 : 40, (this.W - 1120) / 2);
  }
  get width() {
    return this.W - this.margin * 2;
  }
  get active() {
    return this.page === "game" && this.progress && !this.progress.completed && !this.modal &&
      !document.hidden;
  }
  constructor() {
    super("Daybook");
  }
  create() {
    globalThis.addEventListener("daybook:pwa", () => {
      if (this.page !== "game" || this.modal === "install") this.draw();
    });
    globalThis.addEventListener("daybook:before-update", (event) => {
      this.persist();
      if (this.page !== "game" || !this.puzzle || !this.progress) return;
      try {
        sessionStorage.setItem("daybook:update-resume:v1", JSON.stringify({
          kind: this.puzzle.kind, seed: this.puzzle.seed, progress: this.progress,
          difficulty: this.puzzle.difficulty ?? "classic",
        }));
      } catch {
        // Do not discard a running puzzle if this device cannot save its reload snapshot.
        event.preventDefault();
      }
    });
    startPwa();
    this.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
    this.scale.on("resize", () => {
      this.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
      this.scrollY = 0;
      this.draw();
    });
    // Respond to the safe-area container itself, including rotation while the game is paused.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && (this.scale.width !== Math.round(width * RENDER_SCALE) || this.scale.height !== Math.round(height * RENDER_SCALE))) {
        this.scale.resize(Math.round(width * RENDER_SCALE), Math.round(height * RENDER_SCALE));
      }
    });
    resize.observe(document.getElementById("game")!);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => resize.disconnect());
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _x: number, dy: number) => {
      // Trackpads already provide their own momentum through wheel events.
      this.scrollMomentum.stop();
      if ((!this.modal || this.modal === "tutorial" || this.modal === "hint") && this.contentHeight > this.H) {
        this.scrollTo(this.scrollY + dy);
      }
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.boardPointerId >= 0 && p.id !== this.boardPointerId) return;
      this.pointerY = (p.y / RENDER_SCALE);
      // A tap on a moving collection brakes it without opening the card underneath.
      this.pointerDragged = this.scrollMomentum.moving;
      if (this.page !== "game" && !this.modal) this.scrollMomentum.begin(performance.now());
      else this.scrollMomentum.stop();
      this.pointerStart = -1;
      if (this.page !== "game" || this.modal || this.progress?.completed) {
        this.queensInput.reset();
        this.sudokuTap = undefined;
        return;
      }
      const i = this.cellAt(p);
      this.pointerStart = this.pointerLast = i;
      if (i < 0) {
        this.queensInput.reset();
        this.sudokuTap = undefined;
        return;
      }
      this.boardPointerId = p.id;
      this.sudokuPointerTime = performance.now();
      if (this.puzzle!.kind === "fivecells") {
        this.borderVisited.clear();
        this.borderLastPoint = undefined;
        this.paintFiveBorders((p.x / RENDER_SCALE), (p.y / RENDER_SCALE));
      } else if (this.puzzle!.kind === "nurikabe") {
        this.nurikabeVisited.clear();
        this.paintNurikabe(i);
      } else if (this.puzzle!.kind === "queens") {
        const edit = this.queensInput.begin(i, this.progress!.values, performance.now());
        if (!edit.mergeUndo) this.snapshot();
        this.selected = i;
        edit.marks.forEach(({ index, value }) => this.progress!.values[index] = value);
        this.changed();
      } else if (this.puzzle!.kind !== "shikaku") this.actCell(i, p);
      this.touchFeedback((p.x / RENDER_SCALE), (p.y / RENDER_SCALE), Math.min(24, this.board.cell * .32));
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || (this.modal && this.modal !== "tutorial" && this.modal !== "hint") || (this.boardPointerId >= 0 && p.id !== this.boardPointerId)) {
        return;
      }
      if (this.page !== "game" || this.pointerStart < 0) {
        const dy = this.pointerY - (p.y / RENDER_SCALE);
        if (Math.abs(dy) > 4 || this.pointerDragged) {
          this.pointerDragged = true;
          if (this.page !== "game" && !this.modal) this.scrollMomentum.move(dy, performance.now());
          this.scrollTo(this.scrollY + dy);
          this.pointerY = (p.y / RENDER_SCALE);
        }
        return;
      }
      if (this.puzzle?.kind === "fivecells" && !this.progress?.completed) {
        this.pointerDragged = true;
        this.paintFiveBorders((p.x / RENDER_SCALE), (p.y / RENDER_SCALE));
        return;
      }
      const i = this.cellAt(p);
      if (i >= 0 && i !== this.pointerLast && !this.progress?.completed) {
        this.pointerDragged = true;
        if (this.puzzle?.kind === "sudoku" || this.puzzle?.kind === "killer") {
          this.extendSudokuSelection(i);
          return;
        }
        if (this.puzzle?.kind === "nurikabe") {
          this.paintNurikabe(i);
          return;
        }
        this.pointerLast = i;
        if (this.puzzle?.kind === "queens") {
          const marks = this.queensInput.move(i, this.progress!.values, this.puzzle.size);
          if (marks.length) {
            marks.forEach(({ index, value }) => this.progress!.values[index] = value);
            this.selected = i;
            this.changed();
            marks.forEach(({ index }) => this.cellFeedback(index));
          }
        } else if (this.puzzle?.kind === "snap") {
          this.actCell(i, p);
          this.cellFeedback(i);
        } else if (this.puzzle?.kind === "shikaku") {
          this.selected = i;
          this.draw();
          this.cellFeedback(i);
        }
      }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.boardPointerId >= 0 && p.id !== this.boardPointerId) return;
      this.scrollMomentum.release(performance.now());
      if (this.page === "game" && !this.modal && !this.progress?.completed) {
        const i = this.cellAt(p);
        if (
          (this.puzzle?.kind === "sudoku" || this.puzzle?.kind === "killer") &&
          this.pointerStart >= 0 && i >= 0 && i !== this.pointerLast
        ) this.extendSudokuSelection(i);
        if (this.puzzle?.kind === "sudoku" || this.puzzle?.kind === "killer") {
          const now = performance.now(), previous = this.sudokuTap;
          const tapped = i >= 0 && i === this.pointerStart && !this.pointerDragged &&
            this.selectedCells.size === 1 && now - this.sudokuPointerTime <= 400;
          this.sudokuTap = tapped ? { index: i, time: now } : undefined;
          if (tapped && previous?.index === i && now - previous.time <= 320) {
            this.sudokuTap = undefined;
            const candidates = this.progress!.notes[i];
            if (!this.progress!.values[i] && candidates?.length === 1) {
              this.enterNumber(candidates[0], true);
            }
          }
        }
        if (this.puzzle?.kind === "nurikabe" && this.pointerStart >= 0 && i >= 0) this.paintNurikabe(i);
        if (this.puzzle?.kind === "queens") this.queensInput.end(i, performance.now());
        if (this.puzzle?.kind === "shikaku" && i >= 0 && this.pointerStart >= 0) {
          if (i !== this.pointerStart) this.placeRectangle(this.pointerStart, i);
          else this.actCell(i, p);
          this.touchFeedback((p.x / RENDER_SCALE), (p.y / RENDER_SCALE), Math.min(24, this.board.cell * .32));
        }
      }
      this.pointerStart = this.boardPointerId = -1;
    });
    const cancelGesture = () => {
      this.scrollMomentum.stop();
      this.pointerStart = this.boardPointerId = -1;
      this.queensInput.reset();
      this.sudokuTap = undefined;
    };
    this.input.on("pointerupoutside", cancelGesture);
    this.game.canvas.addEventListener("touchcancel", cancelGesture);
    globalThis.addEventListener("blur", cancelGesture);
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.key(e));
    this.game.canvas.setAttribute("tabindex", "0");
    this.game.canvas.setAttribute(
      "aria-label",
      "Daybook. Tab cycles buttons; Enter activates. In puzzles use arrows to select a cell, digits to fill, Space to toggle, U to undo, and Escape to pause. Touch and mouse are supported.",
    );
    document.addEventListener("visibilitychange", () => {
      this.scrollMomentum.stop();
      this.persist();
      if (document.hidden && this.page === "game" && !this.progress?.completed && !this.modal) {
        this.modal = "pause";
        this.draw();
      }
    });
    globalThis.addEventListener("pagehide", () => this.persist());
    this.restoreAfterUpdate();
    this.draw();
  }
  restoreAfterUpdate() {
    try {
      const raw = sessionStorage.getItem("daybook:update-resume:v1");
      sessionStorage.removeItem("daybook:update-resume:v1");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!KINDS.includes(saved.kind) || typeof saved.seed !== "string" || saved.seed.length > 200 ||
        !(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(saved.seed) || saved.seed.startsWith("practice:"))) return;
      const choice = isDifficulty(saved.difficulty) ? saved.difficulty : "classic";
      const difficulty = choice === "classic" ? undefined : choice;
      // ProgressStore validates entries and reapplies any new fixed clues before rendering.
      if (saved.progress && (saved.seed.startsWith("practice:") || !store.available)) {
        const temporary = new ProgressStore({
          getItem: () => JSON.stringify({ [store.key(saved.seed, saved.kind, difficulty)]: saved.progress }),
          setItem: () => {},
        });
        const progress = temporary.get(saved.seed, saved.kind, difficulty);
        if (progress) store.save(saved.seed, saved.kind, progress, difficulty);
      }
      this.openGame(saved.kind, saved.seed, choice);
    } catch { /* A damaged or unavailable snapshot should not prevent the app from opening. */ }
  }
  override update(_time: number, delta: number) {
    if (this.scrollMomentum.moving) {
      const distance = this.scrollMomentum.step(delta), previous = this.scrollY;
      this.scrollTo(previous + distance);
      if (Math.abs(this.scrollY - previous - distance) > .01) this.scrollMomentum.stop();
    }
    this.drawTouchFeedback();
    if (this.active) {
      this.progress!.elapsed += Math.min(delta, 1000) / 1000;
      this.saveClock += delta;
      if (this.clockText?.active) {
        this.clockText.setText(formatTime(this.progress!.elapsed));
      }
      if (this.saveClock > 3000) {
        this.persist();
        this.saveClock = 0;
      }
    }
    const now = dateKey();
    if (now !== this.today) {
      const wasToday = this.selectedDate === this.today;
      this.today = now;
      if (this.page !== "game" && wasToday) {
        this.selectedDate = now;
        this.month = new Date(parseDate(now).getFullYear(), parseDate(now).getMonth(), 1, 12);
        this.draw();
      }
    }
  }
  touchFeedback(x: number, y: number, radius = 18) {
    this.touchPulses.push({ x, y, radius, time: performance.now() });
    this.touchPulses = this.touchPulses.slice(-12);
    this.drawTouchFeedback();
  }
  cellFeedback(index: number) {
    const { x, y, cell, n } = this.board;
    this.touchFeedback(
      x + (index % n + .5) * cell,
      y + (Math.floor(index / n) + .5) * cell,
      Math.min(24, cell * .32),
    );
  }
  drawTouchFeedback() {
    const now = performance.now(), reduced = this.reducedMotion.matches;
    const duration = reduced ? 120 : 200;
    this.touchPulses = this.touchPulses.filter((pulse) => now - pulse.time < duration);
    if (!this.touchPulses.length) {
      this.touchGraphics?.destroy();
      this.touchGraphics = undefined;
      return;
    }
    if (!this.touchGraphics?.active) {
      this.touchGraphics = this.add.graphics().setDepth(1000).setName("touch-feedback");
    }
    const g = this.touchGraphics.clear();
    for (const pulse of this.touchPulses) {
      const progress = Math.max(0, (now - pulse.time) / duration);
      const alpha = reduced ? .65 : (1 - progress) ** 2;
      const radius = pulse.radius * (reduced ? 1 : .8 + .2 * progress);
      g.fillStyle(this.C.accent, .12 * alpha).fillCircle(pulse.x, pulse.y, radius);
      g.lineStyle(2, this.C.accent, .65 * alpha).strokeCircle(pulse.x, pulse.y, radius);
    }
  }
  persist() {
    if (this.puzzle && this.progress) store.save(this.puzzle.seed, this.puzzle.kind, this.progress, this.puzzle.difficulty);
  }
  settings() {
    try {
      browserStorage.setItem(
        "daybook:settings",
        JSON.stringify({ night: this.night, timer: this.showTimer }),
      );
    } catch { /* Theme still works for this session. */ }
  }
  announce(s: string) {
    document.getElementById("status")!.textContent = s;
  }
  text(
    x: number,
    y: number,
    text: string,
    size = 16,
    color = this.C.ink,
    font = "Arial",
    width?: number,
  ) {
    const key = JSON.stringify([x, y, text, size, color, font, width]);
    const cached = this.nextTextCache ? this.textCache.get(key)?.pop() : undefined;
    const label = cached || this.add.text(x, y, text, {
      fontFamily: font,
      fontSize: `${size}px`,
      color: css(color),
      lineSpacing: 6,
      ...(width ? { wordWrap: { width, useAdvancedWrap: true } } : {}),
    }).setResolution(RENDER_SCALE);
    if (cached) {
      // Restore placement before callers apply their alignment/scale. The text texture
      // and digit metrics remain intact; setText is a no-op unless the timer changed it.
      this.add.existing(label);
      label.setPosition(x, y).setOrigin(0).setScale(1).setText(text);
    }
    if (this.nextTextCache) {
      const entries = this.nextTextCache.get(key) || [];
      entries.push(label);
      this.nextTextCache.set(key, entries);
    }
    return label;
  }
  line(x1: number, y1: number, x2: number, y2: number, color = this.C.line, width = 1) {
    this.add.graphics().lineStyle(width, color).lineBetween(x1, y1, x2, y2);
  }
  box(
    x: number,
    y: number,
    w: number,
    h: number,
    fill = this.C.panel,
    stroke?: number,
    radius = 12,
  ) {
    const g = this.add.graphics();
    g.fillStyle(fill).fillRoundedRect(x, y, w, h, radius);
    if (stroke !== undefined) g.lineStyle(1, stroke).strokeRoundedRect(x, y, w, h, radius);
    return g;
  }
  circle(x: number, y: number, r: number, fill: number, stroke?: number) {
    const g = this.add.graphics();
    g.fillStyle(fill).fillCircle(x, y, r);
    if (stroke !== undefined) g.lineStyle(1.5, stroke).strokeCircle(x, y, r);
    return g;
  }
  controls: { x: number; y: number; w: number; h: number; label: string; action: () => void; fixed?: boolean }[] =
    [];
  focused = -1;
  focusOutline?: Phaser.GameObjects.Graphics;
  hit(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: () => void,
    hover?: Phaser.GameObjects.Graphics,
  ) {
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerDragged) {
        this.focused = -1;
        this.queensInput.reset();
        action();
        this.touchFeedback((pointer.x / RENDER_SCALE), (pointer.y / RENDER_SCALE));
      }
    });
    if (hover) {
      zone.on("pointerover", () => hover.setAlpha(.7));
      zone.on("pointerout", () => hover.setAlpha(1));
    }
    this.controls.push({ x, y, w, h, label, action });
    return zone;
  }
  button(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: () => void,
    primary = false,
    disabled = false,
    radius = 8,
  ) {
    const bg = this.box(
      x,
      y,
      w,
      h,
      primary ? this.C.accent : this.C.panel,
      primary ? undefined : this.C.line,
      radius,
    );
    const caption = this.text(
      x + w / 2,
      y + h / 2,
      label,
      14,
      disabled ? this.C.muted : primary ? this.C.bg : this.C.ink,
    ).setOrigin(.5);
    if (!disabled) this.hit(x, y, w, h, label, action, bg);
    return caption;
  }
  iconButton(
    x: number, y: number, w: number, h: number, label: string, action: () => void,
    primary = false, disabled = false, radius = 8,
  ) {
    const active = label === "Notes on", filled = primary || active;
    const fill = filled ? this.C.accent : this.C.panel;
    const bg = this.box(x, y, w, h, fill, filled ? undefined : this.C.line, radius);
    const color = disabled ? this.C.muted : filled ? this.C.bg : this.C.ink;
    const icon = this.add.graphics().setName(`control-icon:${label}`);
    drawActionIcon(icon, ACTION_ICONS[label], x + w / 2, y + h / 2,
      label === "Settings" ? 34 : Math.min(26, h * .65, w * .75), color, fill);
    if (active) this.circle(x + w - 9, y + 9, 2.5, color);
    if (disabled) icon.setAlpha(.45);
    else {
      const zone = this.hit(x, y, w, h, label, action, bg);
      zone.on("pointerover", () => { this.game.canvas.title = label; });
      zone.on("pointerout", () => { this.game.canvas.title = ""; });
    }
    return icon;
  }
  tint(kind: Kind) {
    return this.night ? blend(META[kind].color, DARK.ink, .42) : META[kind].color;
  }
  pale(kind: Kind) {
    return this.night ? blend(DARK.panel, META[kind].color, .19) : META[kind].pale;
  }
  go(page: Page) {
    this.queensInput.reset();
    this.persist();
    this.page = page;
    this.settingsReturn = null;
    this.modal = null;
    this.scrollY = 0;
    this.focused = -1;
    this.notice = "";
    this.draw();
  }
  logo(x: number, y: number) {
    const g = this.add.graphics().fillStyle(this.C.accent);
    g.fillRoundedRect(x, y, 9, 9, 2);
    g.fillRoundedRect(x + 13, y, 9, 9, 2);
    g.fillRoundedRect(x, y + 13, 9, 9, 2);
    g.fillCircle(x + 17.5, y + 17.5, 4.5);
  }
  header() {
    const m = this.margin, y = 32 - this.scrollY, c = this.C;
    this.logo(m, y + 3);
    this.text(m + 35, y - 3, "daybook", 29, c.ink, "Georgia");
    this.hit(m, y - 7, 165, 45, "Daybook home", () => {
      this.selectedDate = this.today;
      this.go("today");
    });
    const navY = this.mobile ? y + 61 : y + 9;
    const start = this.mobile ? m : this.W / 2 - 140;
    ([["today", "Today"], ["calendar", "Calendar"], ["practice", "Practice"]] as [Page, string][])
      .forEach(([page, label], i) => {
        const x = start + i * (this.mobile ? 94 : 104), active = this.page === page;
        this.text(x, navY, label, 14, active ? c.ink : c.muted);
        if (active) this.line(x, navY + 25, x + label.length * 7, navY + 25, c.accent, 2);
        this.hit(x - 8, navY - 12, 88, 44, label, () => {
          if (page === "today") this.selectedDate = this.today;
          this.go(page);
        });
      });
    const x = this.W - m - 34;
    this.circle(x + 14, y + 12, 17, c.soft);
    const moon = this.add.graphics().lineStyle(1.5, c.accent);
    if (this.night) {
      moon.strokeCircle(x + 14, y + 12, 6);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        moon.lineBetween(
          x + 14 + Math.cos(a) * 9,
          y + 12 + Math.sin(a) * 9,
          x + 14 + Math.cos(a) * 12,
          y + 12 + Math.sin(a) * 12,
        );
      }
    } else {
      moon.fillStyle(c.accent).fillCircle(x + 14, y + 12, 8);
      moon.fillStyle(c.soft).fillCircle(x + 18, y + 8, 7);
    }
    this.hit(
      x - 7,
      y - 9,
      44,
      44,
      this.night ? "Switch to paper theme" : "Switch to night theme",
      () => {
        this.night = !this.night;
        this.settings();
        this.draw();
      },
    );
    if (!this.mobile) {
      this.text(
        x - 163,
        y + 6,
        this.night ? "A softer kind of evening." : "A little space to think.",
        12,
        c.muted,
      );
    }
    this.line(
      m,
      (this.mobile ? 143 : 94) - this.scrollY,
      this.W - m,
      (this.mobile ? 143 : 94) - this.scrollY,
    );
  }
  scrollTo(value: number) {
    if (this.contentHeight <= this.H) return;
    if (this.page === "game" && !this.modal && (this.W < 760)) return;
    const next = Phaser.Math.Clamp(value, 0, Math.max(0, this.contentHeight - this.H + 20));
    const delta = next - this.scrollY;
    if (!delta) return;
    this.scrollY = next;
    this.touchPulses = [];
    this.game.canvas.title = "";
    // Scrolling changes placement only. Retain card previews, text textures and hit areas.
    for (const object of this.children.getAll()) {
      if (object !== this.touchGraphics && !object.getData("fixedHeader")) (object as Phaser.GameObjects.Graphics).y -= delta;
    }
    this.controls.forEach((control) => { if (!control.fixed) control.y -= delta; });
    if (this.page === "game") this.board.y -= delta;
    this.drawTouchFeedback();
  }
  draw() {
    this.scrollMomentum.stop();
    this.game.canvas.title = "";
    // Every puzzle and menu retains unchanged text textures between updates.
    // Scrolling only translates display objects; no textures or hit areas are rebuilt.
    const context = JSON.stringify([this.page, this.modal, this.puzzle?.kind,
      this.puzzle?.seed, this.W, this.H, this.night]);
    const retained = context && context === this.textCacheContext
      ? new Set([...this.textCache.values()].flat())
      : new Set<Phaser.GameObjects.GameObject>();
    // Rebuild input areas so their enabled state and callbacks always reflect the move.
    this.children.getAll().forEach((object) => {
      if (retained.has(object)) this.children.remove(object);
      else object.destroy();
    });
    if (!retained.size) this.textCache.clear();
    this.textCacheContext = context;
    this.nextTextCache = context ? new Map() : undefined;
    this.controls = [];
    this.clockText = undefined;
    this.focusOutline = undefined;
    this.cameras.main.setBackgroundColor(this.C.bg);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", css(this.C.bg));
    document.documentElement.style.backgroundColor = css(this.C.bg);
    this.contentHeight = this.H;
    if (this.modal === "tutorial" || this.modal === "hint") this.drawTutorial();
    else if (this.page === "game") this.drawGame();
    else {
      this.header();
      if (this.page === "calendar") this.drawCalendarPage();
      else this.drawCollection();
    }
    if (this.modal && this.modal !== "tutorial" && this.modal !== "hint") this.drawModal();
    this.drawFocus();
    this.drawTouchFeedback();
    // Discard removed notes/changed labels immediately; the cache is bounded by one screen.
    for (const entries of this.textCache.values()) for (const text of entries) text.destroy();
    this.textCache = this.nextTextCache || new Map();
    this.nextTextCache = undefined;
  }
  drawFocus() {
    this.focusOutline?.destroy();
    const b = this.controls[this.focused];
    if (b) {
      this.focusOutline = this.add.graphics().lineStyle(2, this.C.accent).strokeRoundedRect(
        b.x - 3,
        b.y - 3,
        b.w + 6,
        b.h + 6,
        8,
      ).setData("fixedHeader", !!b.fixed);
    }
  }
  drawCollection() {
    const m = this.margin,
      w = this.width,
      c = this.C,
      practice = this.page === "practice",
      top = (this.mobile ? 172 : 134) - this.scrollY;
    const kinds = practice ? KINDS : kindsForDate(this.selectedDate);
    const d = parseDate(this.selectedDate),
      date = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
        .toUpperCase();
    this.text(m, top, date, 11, c.accent)
      .setLetterSpacing(1.7);
    const title = this.text(
      m,
      top + 32,
      practice
        ? "Follow your curiosity."
        : this.night
        ? "Let the day unwind."
        : "A fresh page for your mind.",
      this.mobile ? 33 : 45,
      c.ink,
      "Georgia",
      this.mobile || practice ? w : w - 320,
    );
    const description = this.text(
      m,
      Math.max(top + (this.mobile ? 89 : 98), title.y + title.height + 16),
      practice
        ? "Freshly generated puzzles, whenever you feel like it."
        : `${kinds.length} little challenges. Take your time.`,
      this.mobile ? 16 : 18,
      c.muted,
      undefined,
      this.mobile || practice ? w : w - 335,
    );
    const progressY = Math.max(
      top + (this.mobile ? 139 : 149),
      description.y + description.height + 30,
    );
    if (!practice) {
      const completed = store.count(this.selectedDate), py = progressY;
      for (let i = 0; i < kinds.length; i++) {
        this.circle(
          m + 5 + i * (this.mobile ? 12 : 20),
          py + 5,
          4,
          i < completed ? c.accent : c.line,
        );
      }
      this.text(
        m + kinds.length * (this.mobile ? 12 : 20) + 14,
        py - 2,
        `${completed} of ${kinds.length} completed`,
        14,
        c.muted,
      );
      if (!this.mobile) this.miniCalendar(m + w - 274, top - 8, 274);
    }
    let gridY = Math.max(
      top + (practice ? (this.mobile ? 152 : 185) : (this.mobile ? 195 : 260)),
      practice ? description.y + description.height + 40 : progressY + 56,
    );
    if (!practice) this.text(m, gridY, "YOUR DAILY COLLECTION", 11, c.muted)
      .setLetterSpacing(1.6);
    const pick = featured(this.selectedDate);
    if (!this.mobile && !practice) {
      this.text(
        m + w,
        gridY,
        `Today’s pick  /  ${META[pick].name}`,
        12,
        c.muted,
      ).setOrigin(1, 0);
    }
    if (!practice) gridY += 34;
    const cols = this.W < 550 ? 2 : 3,
      gap = this.mobile ? 12 : 18,
      cw = (w - gap * (cols - 1)) / cols,
      ch = this.mobile ? (practice ? 164 : 192) : (practice ? 184 : cw < 224 ? 236 : 208);
    kinds.forEach((kind, i) => {
      const x = m + (i % cols) * (cw + gap),
        y = gridY + Math.floor(i / cols) * (ch + gap),
        meta = META[kind],
        saved = practice ? undefined : store.dailyProgress(this.selectedDate, kind),
        done = saved?.completed;
      const card = this.box(
        x,
        y,
        cw,
        ch,
        c.panel,
        undefined,
        0,
      );
      this.box(x + 14, y + 14, cw - 28, 80, this.pale(kind), undefined, 0);
      this.miniature(kind, x + cw / 2, y + 53, 64);
      if (!practice && kind === pick) this.circle(x + cw - 24, y + 24, 4, this.tint(kind));
      const fs = this.mobile ? 18 : 22;
      const title = this.text(
        x + 16,
        y + 108,
        meta.name,
        kind === "killer" && this.mobile ? 16 : fs,
        c.ink,
        "Georgia",
        cw - (done ? 60 : 32),
      );
      if (done) {
        const checkX = x + cw - 25, checkY = y + 108 + fs / 2;
        this.add.graphics().lineStyle(2.2, c.accent)
          .beginPath().moveTo(checkX - 7, checkY)
          .lineTo(checkX - 2, checkY + 5).lineTo(checkX + 7, checkY - 5).strokePath();
      }
      if (!this.mobile) {
        this.text(x + 16, Math.max(y + 140, title.y + title.height + 6),
          meta.description, 14, c.muted, undefined, cw - 32);
      }
      if (!practice) {
        const choice = difficultyChoices.get(kind, this.selectedDate);
        const level = choice && choice !== "classic" ? DIFFICULTY_LABELS[choice] : "default";
        this.text(x + 16, y + ch - 25, `Difficulty: ${level}`, 12, c.accent, undefined, cw - 32);
      }
      this.hit(
        x,
        y,
        cw,
        ch,
        `${meta.name}${done ? ", completed" : ""}`,
        () => {
          const seed = practice ? `practice:${crypto.randomUUID()}` : this.selectedDate;
          if (practice && supportsDifficulty(kind)) this.openDifficulty(kind, seed);
          else this.openGame(kind, seed);
        },
        card,
      );
    });
    const end = gridY + Math.ceil(kinds.length / cols) * (ch + gap) + 19;
    this.line(m, end, m + w, end);
    this.text(
      m,
      end + 23,
      practice
        ? "No finish line. Just a little practice."
        : "A new collection every day. Nothing to keep up with.",
      12,
      c.muted,
      undefined,
      this.mobile ? w : w - 270,
    );
    if (!this.mobile) {
      this.text(
        m + w,
        end + 23,
        store.available
          ? "Saved on this device  ·  No account needed"
          : "Storage unavailable · progress is temporary",
        11,
        c.muted,
      ).setOrigin(1, 0);
    } else {this.text(
        m,
        end + 63,
        store.available ? "Saved on this device" : "Progress is temporary: storage unavailable",
        11,
        c.muted,
      );}
    if (!pwa.enabled) {
      this.contentHeight = end + 110 + this.scrollY;
      return;
    }
    const installY = end + (this.mobile ? 97 : 65);
    if (!pwa.installed) {
      this.button(m, installY, Math.min(200, w), 40, "Install Daybook", () => {
        this.modal = "install";
        this.draw();
      });
    }
    if (pwa.enabled) {
      this.text(
        m,
        installY + (pwa.installed ? 0 : 52),
        pwa.ready ? pwa.updateWaiting
          ? "Available offline · Update ready."
          : "Available offline" : pwa.failed
          ? "Offline setup needs a connection. Open Daybook again online."
          : "Preparing offline play…",
        12,
        c.muted,
        undefined,
        w,
      );
    }
    this.contentHeight = installY + 105 + this.scrollY;
  }
  miniature(kind: Kind, cx: number, cy: number, s: number) {
    const color = this.tint(kind),
      g = this.add.graphics().lineStyle(2, color),
      x = cx - s / 2,
      y = cy - s / 2;
    if (kind === "sets") {
      for (let i = 0; i < 3; i++) {
        this.box(x + i * s * .28, y + 5 + i * 4, s * .4, s * .65, this.C.panel, color, 4);
        this.circle(x + i * s * .28 + s * .2, y + 5 + i * 4 + s * .32, s * .06, color);
      }
    } else if (kind === "sudoku" || kind === "killer") {
      g.strokeRoundedRect(x + 5, y + 2, s - 10, s - 3, 3);
      for (let k = 1; k < 3; k++) {
        g.lineBetween(x + 5 + k * (s - 10) / 3, y + 2, x + 5 + k * (s - 10) / 3, y + s - 1);
        g.lineBetween(x + 5, y + 2 + k * (s - 3) / 3, x + s - 5, y + 2 + k * (s - 3) / 3);
      }
      if (kind === "killer") {
        const cellW = (s - 10) / 3, cellH = (s - 3) / 3;
        g.lineStyle(1, color);
        for (const [col, row, cols, rows, sum] of [[0, 0, 2, 1, 12], [1, 1, 2, 2, 20]]) {
          const left = x + 7 + col * cellW, top = y + 4 + row * cellH;
          const right = left + cols * cellW - 4, bottom = top + rows * cellH - 4;
          for (let xx = left; xx < right; xx += 4) {
            g.lineBetween(xx, top, Math.min(xx + 2, right), top);
            g.lineBetween(xx, bottom, Math.min(xx + 2, right), bottom);
          }
          for (let yy = top; yy < bottom; yy += 4) {
            g.lineBetween(left, yy, left, Math.min(yy + 2, bottom));
            g.lineBetween(right, yy, right, Math.min(yy + 2, bottom));
          }
          this.text(left + 2, top + 2, String(sum), 8, color);
        }
      } else {
        this.text(x + 13, y + 7, "3", 15, color);
        this.text(x + 32, y + 27, "8", 15, color);
        this.text(x + 13, y + 46, "1", 15, color);
      }
    } else if (kind === "pipes") {
      g.lineStyle(10, color).beginPath().moveTo(x + 5, y + 45).lineTo(x + 22, y + 45).lineTo(
        x + 22,
        y + 17,
      ).lineTo(x + 49, y + 17).lineTo(x + 49, y + 48).strokePath();
      g.fillStyle(color).fillCircle(x + 5, y + 45, 6).fillCircle(x + 49, y + 48, 6);
      g.lineStyle(4, this.pale(kind)).lineBetween(x + 22, y + 31, x + 22, y + 35);
    } else if (kind === "atoms") {
      const pts = [[x + 12, y + 12], [x + 49, y + 12], [x + 12, y + 49], [x + 49, y + 49]];
      g.lineBetween(x + 12, y + 12, x + 49, y + 12).lineBetween(x + 49, y + 12, x + 49, y + 49)
        .lineBetween(x + 12, y + 49, x + 49, y + 49);
      g.lineBetween(x + 9, y + 12, x + 9, y + 49).lineBetween(x + 15, y + 12, x + 15, y + 49);
      pts.forEach(([a, b], i) => {
        this.circle(a, b, 11, this.pale(kind), color);
        this.text(a, b, [3, 2, 3, 2][i].toString(), 12, color).setOrigin(.5);
      });
    } else if (kind === "queens") this.queen(cx, cy + 3, s * .68, color);
    else if (kind === "akari") {
      this.box(x + 2, y + 2, s - 4, s - 4, this.pale(kind), undefined, 0);
      this.akariBulb(cx, cy, s, color);
    }
    else if (kind === "shikaku") {
      g.strokeRoundedRect(x + 2, y + 3, 60, 58, 2).lineBetween(x + 23, y + 3, x + 23, y + 61)
        .lineBetween(x + 23, y + 24, x + 62, y + 24).lineBetween(x + 42, y + 24, x + 42, y + 61);
      this.text(x + 10, y + 25, "6", 15, color);
      this.text(x + 38, y + 6, "4", 13, color);
      this.text(x + 48, y + 37, "3", 13, color);
    } else if (kind === "snap") {
      g.lineStyle(7, color).beginPath().moveTo(x + 7, y + 11).lineTo(x + 7, y + 49).lineTo(
        x + 32,
        y + 49,
      ).lineTo(x + 32, y + 11).lineTo(x + 56, y + 11).lineTo(x + 56, y + 49).strokePath();
      [[x + 7, y + 11], [x + 32, y + 49], [x + 56, y + 49]].forEach(([a, b], i) => {
        this.circle(a, b, 9, this.pale(kind), color);
        this.text(a, b, String(i + 1), 11, color).setOrigin(.5);
      });
    } else if (kind === "mosaic") {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const filled = (r + c) % 3 !== 0;
          g.fillStyle(color, filled ? .8 : .15).fillRoundedRect(x + c * 22, y + r * 22, 18, 18, 2);
        }
      }
      this.text(x + 28, y + 3, "4", 12, this.C.bg);
    } else if (kind === "mambo") {
      this.circle(x + 14, y + 15, 10, color);
      this.diamond(x + 48, y + 15, 12, color);
      this.diamond(x + 14, y + 49, 12, color);
      this.circle(x + 48, y + 49, 10, color);
    }
    if (kind === "dosun") {
      this.box(cx - 25, cy - 25, 50, 50, this.pale(kind), color, 3);
      this.line(cx, cy - 25, cx, cy + 25, color);
      this.dosunPiece(cx - 12, cy - 12, 30, 1);
      this.dosunPiece(cx + 12, cy + 12, 30, 2);
    } else if (kind === "nurikabe") {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const sea = [1, 4, 5, 6, 10, 11, 12, 13, 14].includes(r * 4 + c);
          this.box(
            cx - 28 + c * 14,
            cy - 28 + r * 14,
            12,
            12,
            sea ? color : this.C.panel,
            undefined,
            1,
          );
        }
      }
      this.text(cx - 22, cy - 21, "1", 10, this.C.ink).setOrigin(.5);
    } else if (kind === "fivecells") {
      const cells = [[0, 0], [1, 0], [1, 1], [2, 1], [1, 2]];
      cells.forEach(([c, r]) =>
        this.box(cx - 25 + c * 17, cy - 25 + r * 17, 16, 16, this.pale(kind), color, 1)
      );
      this.text(cx, cy, "2", 12, color).setOrigin(.5);
    }
  }
  dosunPiece(x: number, y: number, s: number, value: number) {
    const dark = 0x242824, white = this.night ? 0xd8d8c9 : 0xfdfcf8;
    const g = this.add.graphics();
    if (value === 1) {
      g.lineStyle(Math.max(1, s * .018), this.night ? white : dark);
      g.beginPath().moveTo(x, y + s * .17).lineTo(x - s * .035, y + s * .25)
        .lineTo(x + s * .02, y + s * .32).strokePath();
      g.fillStyle(white).lineStyle(Math.max(1, s * .018), dark);
      g.fillEllipse(x, y - s * .065, s * .38, s * .46);
      g.strokeEllipse(x, y - s * .065, s * .38, s * .46);
      g.fillTriangle(x, y + s * .13, x - s * .045, y + s * .19, x + s * .045, y + s * .19);
    } else if (value === 2) {
      const edge = this.night ? this.C.muted : dark;
      g.lineStyle(Math.max(2, s * .035), edge)
        .strokeRoundedRect(x - s * .08, y - s * .23, s * .16, s * .17, s * .045);
      const corners = [
        { x: x - s * .14, y: y - s * .12 },
        { x: x + s * .14, y: y - s * .12 },
        { x: x + s * .25, y: y + s * .23 },
        { x: x - s * .25, y: y + s * .23 },
      ];
      g.fillStyle(dark).fillPoints(corners, true);
      g.lineStyle(Math.max(1, s * .015), edge).strokePoints(corners, true);
    }
  }
  queen(x: number, y: number, s: number, color: number) {
    const g = this.add.graphics().fillStyle(color), w = s * .43;
    g.fillPoints([
      { x: x - w, y: y - s * .23 },
      { x: x - w * .6, y: y + s * .2 },
      { x: x + w * .6, y: y + s * .2 },
      { x: x + w, y: y - s * .23 },
      { x: x + w * .32, y: y - s * .02 },
      { x, y: y - s * .36 },
      { x: x - w * .32, y: y - s * .02 },
    ], true);
    g.fillRoundedRect(x - w * .66, y + s * .28, w * 1.32, s * .1, 2);
    g.fillCircle(x - w, y - s * .26, s * .06);
    g.fillCircle(x, y - s * .38, s * .06);
    g.fillCircle(x + w, y - s * .26, s * .06);
  }
  diamond(x: number, y: number, r: number, color: number) {
    this.add.graphics().fillStyle(color).fillPoints([{ x, y: y - r }, { x: x + r, y }, {
      x,
      y: y + r,
    }, { x: x - r, y }], true);
  }
  miniCalendar(x: number, y: number, w: number) {
    const c = this.C, d = parseDate(this.selectedDate);
    this.box(x, y, w, 221, c.panel, c.line, 10);
    this.text(
      x + 18,
      y + 17,
      d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      15,
      c.ink,
      "Georgia",
    );
    this.text(x + w - 24, y + 17, "↗", 16, c.muted);
    this.hit(x + 10, y + 7, w - 20, 34, "Open calendar", () => this.go("calendar"));
    this.calendarGrid(x + 17, y + 55, w - 34, d.getFullYear(), d.getMonth(), 25, true);
  }
  calendarGrid(
    x: number,
    y: number,
    w: number,
    year: number,
    month: number,
    rowH: number,
    small = false,
  ) {
    const c = this.C,
      cw = w / 7,
      first = (new Date(year, month, 1).getDay() + 6) % 7,
      days = new Date(year, month + 1, 0).getDate();
    ["M", "T", "W", "T", "F", "S", "S"].forEach((d, i) =>
      this.text(x + cw * (i + .5), y, d, small ? 9 : 16, c.muted).setOrigin(.5, 0)
    );
    for (let day = 1; day <= days; day++) {
      const slot = first + day - 1,
        dx = x + (slot % 7 + .5) * cw,
        dy = y + 22 + Math.floor(slot / 7) * rowH + (small ? 0 : rowH / 2 - 8),
        key = dateKey(new Date(year, month, day, 12)),
        done = store.count(key),
        future = key > this.today || key < ARCHIVE_START,
        selected = key === this.selectedDate;
      if (selected) this.circle(dx, dy + 8, small ? 11 : Math.min(22, rowH * .48, cw * .45), c.accent);
      else if (done === kindsForDate(key).length) this.circle(dx, dy + 8, small ? 11 : Math.min(22, rowH * .48, cw * .45), c.soft);
      this.text(
        dx,
        dy + 8,
        String(day),
        small ? 11 : 22,
        selected ? c.bg : future ? blend(c.bg, c.muted, .45) : c.ink,
      ).setOrigin(.5);
      if (!selected && (done > 0 || store.started(key))) {
        this.circle(
          dx + (!small && rowH < 38 ? cw * .39 : 0),
          dy + (small ? 17 : rowH < 38 ? 8 : 8 + rowH * .4),
          small ? 1.5 : 4,
          done === kindsForDate(key).length ? c.accent : done > 0 ? this.tint("shikaku") : c.muted,
        );
      }
      if (!future) {
        this.hit(
          dx - cw / 2,
          dy + (small ? -2 : 8 - rowH / 2),
          cw,
          rowH,
          `${key}, ${done} of ${kindsForDate(key).length} completed`,
          () => {
            this.selectedDate = key;
            this.go("today");
          },
        );
      }
    }
  }
  drawCalendarPage() {
    const c = this.C, m = this.margin, w = this.width;
    const top = this.mobile ? 172 : 134;
    this.scrollY = 0;
    this.text(m, top, parseDate(this.selectedDate).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    }).toUpperCase(), 11, c.accent).setLetterSpacing(1.7);
    const title = this.text(m, top + 32, "One day at a time.", this.mobile ? 33 : 45, c.ink, "Georgia", w);
    let cy = title.y + title.height + 18;
    // Keep the full six-week calendar visible even on shorter phone screens.
    if (this.H - cy >= 420) {
      const description = this.text(m, cy, "Revisit a day, finish a thought, or start something new.",
        14, c.muted, undefined, w);
      cy += description.height + 24;
    }
    const cw = Math.min(w, 590), cx = m + (w - cw) / 2;
    const calendarHeight = Math.min(420, this.H - cy - 16);
    this.box(cx, cy, cw, calendarHeight, c.panel, c.line, 0);
    const pad = this.mobile ? 10 : 18, buttonY = cy + pad;
    const todayWidth = 80, arrowWidth = 46, buttonHeight = 52;
    this.button(cx + pad, buttonY, todayWidth, buttonHeight, "Today", () => {
      this.selectedDate = this.today;
      const today = parseDate(this.today);
      this.month = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      this.draw();
    }, false, false, 0).setFontSize(16);
    const prevX = cx + pad + todayWidth + 6, nextX = cx + cw - pad - arrowWidth;
    this.iconButton(prevX, buttonY, arrowWidth, buttonHeight, "Previous month", () => {
      this.month.setMonth(this.month.getMonth() - 1);
      this.draw();
    }, false, dateKey(this.month) <= ARCHIVE_START, 0);
    const today = parseDate(this.today);
    const canNext = this.month.getFullYear() < today.getFullYear() ||
      (this.month.getFullYear() === today.getFullYear() && this.month.getMonth() < today.getMonth());
    this.iconButton(nextX, buttonY, arrowWidth, buttonHeight, "Next month", () => {
      this.month.setMonth(this.month.getMonth() + 1);
      this.draw();
    }, false, !canNext, 0);
    const monthLeft = prevX + arrowWidth + 6, monthWidth = nextX - 6 - monthLeft;
    const month = this.text(monthLeft + monthWidth / 2, buttonY + buttonHeight / 2,
      this.month.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      this.mobile ? 18 : 24, c.ink, "Georgia").setOrigin(.5);
    if (month.width > monthWidth) month.setScale(monthWidth / month.width);
    const gridY = cy + 96, legendY = cy + calendarHeight - 24;
    // Always reserve six weeks so navigating months never moves the controls.
    const rowH = Math.min(46, (legendY - 12 - gridY - 22) / 6);
    this.calendarGrid(cx + pad, gridY, cw - pad * 2,
      this.month.getFullYear(), this.month.getMonth(), rowH);
    const legendWidth = (cw - pad * 2) / 3;
    [["Complete", c.accent], ["In progress", this.tint("shikaku")], ["Unplayed", c.line]]
      .forEach(([label, color], i) => {
        const x = cx + pad + i * legendWidth;
        const text = this.text(x + 13, legendY, label as string, 14, c.muted);
        this.circle(x + 4, text.y + text.height / 2 - 1, 4, color as number);
      });
    this.contentHeight = this.H;
  }
  openGame(kind: Kind, seed: string, choice = difficultyChoices.get(kind, seed)) {
    this.queensInput.reset();
    this.sudokuTap = undefined;
    this.pointerStart = this.boardPointerId = -1;
    this.persist();
    this.notice = "";
    this.reviewSet = -1;
    try {
      this.puzzle = generate(kind, seed, choice === "classic" ? undefined : choice);
      this.progress = store.load(this.puzzle);
      if (choice) difficultyChoices.set(kind, seed, choice);
    } catch (error) {
      console.error(error);
      this.notice = "This puzzle could not load. Please choose another day.";
      this.announce(this.notice);
      return;
    }
    this.page = "game";
    if (!seed.startsWith("practice:")) this.selectedDate = seed;
    this.modal = null;
    this.selected = -1;
    this.selectedCells.clear();
    this.rectStart = -1;
    this.history = [];
    this.redoHistory = [];
    this.notes = false;
    this.scrollY = 0;
    if (!tutorials.hasSeen(kind)) {
      this.startTutorial();
      return;
    }
    this.draw();
    this.announce(`${META[kind].name}${choice ? `, ${DIFFICULTY_LABELS[choice]}` : ""}. ${META[kind].rules.join(" ")}`);
  }
  openDifficulty(kind: Kind, seed: string) {
    this.persist();
    const choice = difficultyChoices.get(kind, seed)!;
    this.difficultyTarget = { kind, seed, choice: seed.startsWith("practice:") && choice === "classic" ? "medium" : choice };
    this.modal = "difficulty";
    this.draw();
  }
  startTutorial() {
    if (!this.puzzle || !this.progress) return;
    this.persist();
    this.modal = "tutorial";
    this.tutorialPage = 0;
    this.scrollY = 0;
    this.focused = -1;
    this.pointerStart = this.boardPointerId = -1;
    this.queensInput.reset();
    this.sudokuTap = undefined;
    this.touchPulses = [];
    this.draw();
    this.announceTutorial();
  }
  announceTutorial() {
    const steps = tutorialSteps(this.puzzle!), step = steps[this.tutorialPage];
    this.announce(`${META[this.puzzle!.kind].name} tutorial. Step ${this.tutorialPage + 1} of ${steps.length}. ${step.title}. ${step.text}`);
  }
  advanceTutorial(delta: number) {
    const count = tutorialSteps(this.puzzle!).length;
    if (this.tutorialPage + delta >= count) {
      this.finishTutorial(true);
      return;
    }
    this.tutorialPage = Math.max(0, this.tutorialPage + delta);
    this.scrollY = 0;
    this.focused = -1;
    this.draw();
    this.announceTutorial();
  }
  finishTutorial(markSeen = false) {
    if (markSeen) tutorials.markSeen(this.puzzle!.kind);
    this.modal = null;
    this.focused = -1;
    this.scrollY = 0;
    this.draw();
    this.announce("Tutorial closed. You can replay it with the Tutorial button.");
  }
  openHint(mode?: "smart" | "reveal") {
    if (!this.puzzle || !this.progress || this.progress.completed) return;
    this.persist();
    this.modal = "hint";
    this.scrollY = 0;
    this.focused = -1;
    this.pointerStart = this.boardPointerId = -1;
    this.rectStart = -1;
    this.queensInput.reset();
    this.sudokuTap = undefined;
    this.touchPulses = [];
    this.hint = mode === "smart" ? smartHint(this.puzzle, this.progress.values)
      : mode === "reveal" ? revealHint(this.puzzle, this.progress.values) : undefined;
    if (mode === "smart" && this.hint?.values) {
      this.hint.text += " This assumes your existing entries and marks are correct.";
    }
    this.draw();
    this.announce(this.hint?.text || "Choose a smart hint with an explanation, or reveal one move.");
  }
  closeHint() {
    this.modal = null;
    this.hint = undefined;
    this.scrollY = 0;
    this.draw();
  }
  applyHint() {
    if (!this.hint?.values || !this.progress || this.modal !== "hint") return;
    this.snapshot();
    this.progress.values = [...this.hint.values];
    if (this.puzzle!.kind === "sudoku" || this.puzzle!.kind === "killer") {
      this.progress.notes = pruneSudokuNotes(this.progress.values, this.progress.notes, this.puzzle!.cages);
    }
    this.modal = null;
    this.hint = undefined;
    this.selected = -1;
    this.selectedCells.clear();
    this.scrollY = 0;
    this.changed();
  }
  drawTutorial() {
    const p = this.puzzle!, c = this.C, inHint = this.modal === "hint";
    const steps: TutorialStep[] = inHint ? [this.hint ?? {
      title: "A little help",
      text: "Smart hint explains a logical next move or elimination using your entries. Reveal move gives one move from a generated solution. Preview either here before applying it to your puzzle.",
      cells: Array.from({ length: p.size ** 2 }, (_, i) => i),
    }] : tutorialSteps(p);
    const step = steps[inHint ? 0 : this.tutorialPage];
    const n = step.boardExample?.size ?? step.example?.rows.length ?? p.size;
    const legendHeight = steps.some((item) => item.example) ? 30 : 0;
    const layout = this.puzzleLayout();
    const { m: left, w: width, headerTop, by: top } = layout;
    const margin = 16, gap = layout.compact ? layout.landscape ? 22 : 24 : layout.gap;
    const wide = !layout.compact || layout.landscape;
    this.drawPuzzleIdentity(layout);
    const boardSpace = wide ? layout.size : width;
    const cardX = wide ? layout.bx + layout.size + gap : left;
    const cardWidth = wide ? this.W - left - cardX : width;
    const pad = 16, textWidth = cardWidth - pad * 2;
    const short = wide && this.H < 400;
    const title = this.text(0, 0, step.title, short ? 21 : 23, c.ink, "Georgia", textWidth);
    const body = this.text(0, 0, step.text, short ? 14 : 16, c.ink, undefined, textWidth);
    if (short) body.setLineSpacing(4);
    // Keep the board and navigation still between steps, even when a rule takes more lines.
    const height = Math.max(...steps.map((item) => {
      title.setText(item.title);
      body.setText(item.text);
      return pad * 2 + 52 + title.height + 12 + body.height + 20 + 42;
    }));
    title.setText(step.title);
    body.setText(step.text);
    const size = layout.size;
    const bx = layout.bx;
    const by = top;
    const cardY = wide ? layout.landscape && layout.compact
      ? top + 66 + (supportsDifficulty(p.kind) ? 44 : 0) : top : by + size + gap + legendHeight;

    this.board = { x: bx, y: by, cell: size / n, n };
    // Render fixed examples through the same board renderer, restoring all player state synchronously.
    const selected = this.selected, selectedCells = this.selectedCells, progress = this.progress;
    this.selected = -1;
    this.selectedCells = new Set();
    try {
      if (step.boardExample) {
        this.puzzle = { ...step.boardExample, seed: "tutorial:finished-example:v1", solution: [] };
        this.progress = { values: step.boardExample.values, notes: {}, elapsed: 0, completed: true };
        this.drawBoard();
      } else if (inHint && this.hint?.values) {
        this.progress = { ...this.progress!, values: this.hint.values };
        this.drawBoard();
      } else if (step.example) this.drawNurikabeExample(step.example.rows);
      else this.drawBoard();
    } finally {
      this.puzzle = p;
      this.progress = progress;
      this.selected = selected;
      this.selectedCells = selectedCells;
    }
    const focus = new Set(step.cells), s = this.board.cell;
    const overlay = this.add.graphics().setName("tutorial-highlight");
    const highlight = step.example?.invalid ? c.error : c.accent;
    if (p.kind === "sets") {
      for (let i = 0; i < 8; i++) {
        const r = this.setsCardRect(i);
        if (!focus.has(i)) overlay.fillStyle(c.bg, .68).fillRoundedRect(r.x, r.y, r.w, r.h, 5);
        else overlay.lineStyle(2.5, highlight).strokeRoundedRect(r.x, r.y, r.w, r.h, 5);
      }
    } else {
    for (let i = 0; i < n ** 2; i++) {
      const x = bx + i % n * s, y = by + Math.floor(i / n) * s;
      if (!focus.has(i)) overlay.fillStyle(c.bg, .68).fillRect(x, y, s, s);
    }
    // Outline the highlighted area's perimeter; keep its symbols and clue numbers unobscured.
    overlay.lineStyle(2.5, highlight);
    for (const i of focus) {
      const x = bx + i % n * s, y = by + Math.floor(i / n) * s;
      if (!focus.has(i - n)) overlay.lineBetween(x, y, x + s, y);
      if (!focus.has(i + n)) overlay.lineBetween(x, y + s, x + s, y + s);
      if (i % n === 0 || !focus.has(i - 1)) overlay.lineBetween(x, y, x, y + s);
      if (i % n === n - 1 || !focus.has(i + 1)) overlay.lineBetween(x + s, y, x + s, y + s);
    }
    }
    for (const [x1, y1, x2, y2] of step.lines || []) {
      overlay.lineStyle(4, c.accent, .8).lineBetween(bx + x1 * s, by + y1 * s, bx + x2 * s, by + y2 * s);
    }
    if (step.anchor !== undefined) {
      overlay.lineStyle(2, c.accent).strokeCircle(
        bx + (step.anchor % n + .5) * s,
        by + (Math.floor(step.anchor / n) + .5) * s,
        s * .32,
      );
    }
    for (const [x, y, radius] of step.rings || []) {
      overlay.lineStyle(2, c.accent).strokeCircle(bx + x * s, by + y * s, radius * s);
    }
    if (legendHeight) {
      const legendWidth = wide ? boardSpace : width, legendX = wide ? left : (this.W - legendWidth) / 2;
      ["Land", "Water", "Blank"].forEach((label, index) => {
        const x = legendX + (index + .5) * legendWidth / 3 - 28, y = by + size + 14;
        this.box(x, y, 12, 12, index === 1 ? this.tint("nurikabe") : c.panel, c.line, 1);
        if (index === 0) this.circle(x + 6, y + 6, 2, c.accent);
        this.text(x + 17, y - 2, label, 12, c.muted);
      });
    }
    this.box(cardX, cardY, cardWidth, height, c.panel, undefined, 0);
    const stepLabel = this.text(cardX + pad, cardY + pad + 12,
      inHint ? (this.hint?.values ? "HINT · PROPOSED MOVE" : "HINT") : `${step.finished ? "FINISHED EXAMPLE" : step.example ? "RULE EXAMPLE" : "TUTORIAL"} · ${this.tutorialPage + 1} OF ${steps.length}`,
      12, c.accent).setLetterSpacing(1);
    if (stepLabel.width > textWidth - 84) stepLabel.setScale((textWidth - 84) / stepLabel.width);
    this.button(cardX + cardWidth - pad - 72, cardY + pad, 72, 40, inHint ? "Close" : "Skip",
      () => inHint ? this.closeHint() : this.finishTutorial(true), false, false, 0).setFontSize(16);
    title.setPosition(cardX + pad, cardY + pad + 52);
    body.setPosition(cardX + pad, cardY + pad + 52 + title.height + 12);
    this.children.bringToTop(title);
    this.children.bringToTop(body);
    const buttonY = cardY + height - pad - 42, buttonWidth = (textWidth - 10) / 2;
    if (inHint) {
      this.button(cardX + pad, buttonY, buttonWidth, 42, this.hint ? "Hints" : "Smart hint",
        () => this.openHint(this.hint ? undefined : "smart"));
      this.button(cardX + pad + buttonWidth + 10, buttonY, buttonWidth, 42,
        this.hint ? this.hint.values ? "Apply move" : "Close" : "Reveal move",
        () => this.hint ? this.hint.values ? this.applyHint() : this.closeHint() : this.openHint("reveal"), true);
    } else {
    this.button(cardX + pad, buttonY, buttonWidth, 42, "Previous", () => this.advanceTutorial(-1), false, this.tutorialPage === 0).setFontSize(16);
    this.button(cardX + pad + buttonWidth + 10, buttonY, buttonWidth, 42,
      this.tutorialPage === steps.length - 1 ? "Finish" : "Next", () => this.advanceTutorial(1), true).setFontSize(16);
    }
    this.contentHeight = Math.max(this.H, by + size + legendHeight + margin, cardY + height + margin);
    if (this.scrollY) {
      this.children.getAll().forEach((object) => {
        (object as Phaser.GameObjects.Graphics).y -= this.scrollY;
      });
      this.controls.forEach((control) => control.y -= this.scrollY);
      this.board.y -= this.scrollY;
    }
    this.drawPuzzleHeader(left, headerTop, true);
  }
  drawNurikabeExample(rows: string[]) {
    const { x, y, cell: s } = this.board, c = this.C;
    rows.forEach((row, r) => [...row].forEach((value, col) => {
      const xx = x + col * s, yy = y + r * s;
      this.box(xx, yy, s, s, c.panel, c.line, 0);
      if (value === "#") this.box(xx + 2, yy + 2, s - 4, s - 4, this.tint("nurikabe"), undefined, 2);
      else if (value === "o") this.circle(xx + s / 2, yy + s / 2, s * .065, c.accent);
      else if (value !== "?") this.text(xx + s / 2, yy + s / 2, value, s * .4, c.ink).setOrigin(.5);
    }));
  }
  puzzleLayout() {
    const compact = this.W < 760 || this.H < 480, landscape = this.W > this.H, short = this.H < 720;
    const notePuzzle = this.puzzle!.kind === "sudoku" || this.puzzle!.kind === "killer";
    const m = compact ? this.mobile ? 12 : this.margin : Math.max(24, (this.W - 1120) / 2);
    const w = this.W - m * 2, headerTop = compact || short ? 8 : 19;
    const identityBy = compact ? landscape ? 76 : this.H < 700 ? 132 : 164 : short ? 166 : 196;
    const by = identityBy + (compact && !landscape && supportsDifficulty(this.puzzle!.kind) ? 44 : 0);
    const gap = Phaser.Math.Clamp(w * .035, 20, 40), buttonSize = short ? 44 : 52;
    const footer = compact ? this.progress!.completed ? 132 : notePuzzle ? 174 : 124
      : (notePuzzle ? 54 : 0) + buttonSize * 2 + 46 + (this.notice ? 48 : 0);
    const available = compact ? landscape
      ? Math.min(this.H - by - 12, this.W * .48 - 20)
      : Math.min(this.W - 20, 480, this.H - by - footer)
      : Math.min(492, (w - gap) * .52, Math.max(120, this.H - by - footer));
    const size = notePuzzle ? Math.floor(available / 9) * 9 : compact ? available : Math.round(available);
    const bx = compact && !landscape ? (this.W - size) / 2 : m;
    const titleX = compact && landscape ? bx + size + 22 : m;
    const titleWidth = this.W - m - titleX;
    const titleY = compact ? landscape ? by : identityBy - 66 : short ? 82 : 108;
    return { compact, landscape, m, w, headerTop, by, size, bx, titleX, titleWidth, titleY, gap, buttonSize };
  }
  drawPuzzleIdentity(layout: ReturnType<Daybook["puzzleLayout"]>) {
    const p = this.puzzle!, c = this.C;
    const { compact, landscape, titleX: x, titleY: y, titleWidth: w } = layout;
    const practice = p.seed.startsWith("practice:");
    const date = practice ? compact ? "PRACTICE" : "THE PRACTICE ROOM"
      : parseDate(p.seed).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      }).toUpperCase();
    this.text(x, y, date, 11, c.accent).setLetterSpacing(compact ? 0 : 1.5);
    if (this.showTimer) {
      this.clockText = this.text(x + w, y, formatTime(this.progress!.elapsed), compact ? 12 : 14, c.muted).setOrigin(1, 0);
      if (!compact) this.hit(x + w - 90, y - 8, 90, 36, "Hide timer", () => {
        this.showTimer = false; this.settings(); this.draw();
      });
    }
    const heading = this.text(x, y + (compact ? 21 : 25), META[p.kind].name,
      compact ? landscape ? 26 : 30 : 40, c.ink, "Georgia");
    if (compact && heading.width > w) heading.setScale(w / heading.width);
    if (supportsDifficulty(p.kind)) {
      const label = `${DIFFICULTY_LABELS[p.difficulty ?? "classic"]} · Change`;
      const dx = compact ? x : x + w - 160, dy = compact ? y + 60 : y + 27;
      this.button(dx, dy, compact ? Math.min(w, 190) : 160, 40, label,
        () => this.openDifficulty(p.kind, p.seed), false, !!this.modal, 0).setFontSize(14);
    }
  }
  drawPuzzleHeader(m: number, top: number, fixed = false) {
    const before = new Set(this.children.getAll()), controlStart = this.controls.length;
    const separatorY = this.W < 760 ? top + 54 : top === 8 ? 68 : 86;
    if (fixed) this.add.rectangle(0, 0, this.W, separatorY, this.C.bg).setOrigin(0).setInteractive();
    this.iconButton(m, top, 46, 52, "Back to collection", () =>
      this.go(this.puzzle!.seed.startsWith("practice:") ? "practice" : "today"), false, false, 0);
    const wordmark = this.text(0, top + 26, "daybook", 25, this.C.ink, "Georgia").setOrigin(0, .5);
    const brandX = (this.W - wordmark.width - 30) / 2;
    this.logo(brandX, top + 15);
    wordmark.setX(brandX + 30);
    this.iconButton(this.W - m - 52, top, 52, 52, "Settings", () => {
      this.settingsReturn = this.modal === "tutorial" || this.modal === "hint" ? this.modal : null;
      this.modal = "settings";
      this.scrollY = 0;
      this.draw();
    }, false, false, 0);
    if (this.W >= 760) this.line(m, separatorY, this.W - m, separatorY);
    if (fixed) {
      for (const object of this.children.getAll()) if (!before.has(object)) object.setData("fixedHeader", true);
      this.controls.slice(controlStart).forEach((control) => control.fixed = true);
    }
  }
  closeSettings() {
    this.modal = this.settingsReturn;
    this.settingsReturn = null;
    this.scrollY = 0;
    this.draw();
  }
  drawCompactGame() {
    const p = this.puzzle!, progress = this.progress!, c = this.C;
    const landscape = this.W > this.H;
    const notePuzzle = p.kind === "sudoku" || p.kind === "killer";
    const practice = p.seed.startsWith("practice:");
    const layout = this.puzzleLayout();
    const { m, by, size, bx, titleX: ux, titleWidth: uw, titleY } = layout;
    this.scrollY = 0;
    this.drawPuzzleHeader(m, layout.headerTop);
    this.board = { x: bx, y: by, cell: size / p.size, n: p.size };
    this.drawPuzzleIdentity(layout);
    this.drawBoard();
    const controlsY = landscape ? titleY + 66 + (supportsDifficulty(p.kind) ? 44 : 0) : by + size + 10;
    if (progress.completed) {
      this.text(ux, controlsY, `${META[p.kind].name} completed`, 18, c.accent);
      const remaining = kindsForDate(p.seed).find((kind) => !store.dailyProgress(p.seed, kind)?.completed);
      this.button(ux, controlsY + 30, uw, 42,
        practice ? "Another of these" : remaining ? `Next: ${META[remaining].name}` : "The day is complete",
        () => {
          if (practice) this.openGame(p.kind, `practice:${crypto.randomUUID()}`, p.difficulty);
          else if (remaining) this.openGame(remaining, p.seed);
          else this.go("today");
        }, true, false, 0);
      this.button(ux, controlsY + 82, uw, 40, "Tutorial", () => this.startTutorial(), false, false, 0);
    } else {
      if (notePuzzle) this.keypad(ux, controlsY, uw, 40);
      const rowGap = landscape && this.H < 360 && notePuzzle ? 44 : 50;
      const ty = controlsY + (notePuzzle ? rowGap : 0), bw = (uw - 24) / 4;
      this.iconButton(ux, ty, bw, 40, "Undo", () => this.undo(), false, !this.history.length);
      this.iconButton(ux + bw + 8, ty, bw, 40, notePuzzle ? this.notes ? "Notes on" : "Notes" : "Reset", () => {
        if (notePuzzle) this.toggleNotes();
        else this.modal = "reset";
        this.draw();
      });
      this.iconButton(ux + (bw + 8) * 2, ty, bw, 40, "Rules", () => {
        this.helpPage = 0; this.modal = "help"; this.draw();
      });
      this.iconButton(ux + (bw + 8) * 3, ty, bw, 40, "Pause", () => {
        this.modal = "pause"; this.draw();
      });
      this.button(ux, ty + rowGap, (uw - 10) / 2, 40, "Tutorial", () => this.startTutorial(), false, false, 0);
      this.iconButton(ux + (uw + 10) / 2, ty + rowGap, (uw - 10) / 2, 40, "Hint", () => this.openHint(), false, false, 0);
      if (this.notice) {
        // Feedback stays visible without pushing controls below the viewport.
        const message = this.text(ux, ty + rowGap + 45, this.notice, 11, c.error, undefined, uw);
        if (message.height > this.H - message.y - 4) {
          message.setScale(Math.min(1, (this.H - message.y - 4) / message.height));
        }
        this.announce(this.notice);
      }
    }
    this.contentHeight = this.H;
  }
  drawGame() {
    if (!this.puzzle || !this.progress) return;
    // Keep the rules visible whenever both columns have room. No intermediate sidebar layout.
    if (this.W < 760 || this.H < 480) { this.drawCompactGame(); return; }
    const p = this.puzzle, progress = this.progress, c = this.C;
    const short = this.H < 720;
    const layout = this.puzzleLayout();
    const { m, by, size, bx, gap, buttonSize } = layout;
    const notePuzzle = p.kind === "sudoku" || p.kind === "killer";
    this.drawPuzzleHeader(m, layout.headerTop);
    this.drawPuzzleIdentity(layout);
    const sx = bx + size + gap, sw = this.W - m - sx;
    this.board = { x: bx, y: by, cell: size / p.size, n: p.size };
    this.drawBoard();
    const bottom = by + size;
    let sidebarBottom: number;
    if (progress.completed) {
      sidebarBottom = by + this.drawCompletion(sx, by, sw);
      this.button(bx, bottom + 14, size, buttonSize, "Tutorial", () => this.startTutorial(), false, false, 0);
      this.contentHeight = Math.max(this.H, sidebarBottom + 24, bottom + buttonSize + 38);
    } else {
      this.text(sx, by, "HOW TO PLAY", 11, c.accent).setLetterSpacing(1.5);
      sidebarBottom = by + 28 + this.drawRules(sx, by + 28, sw, META[p.kind].rules, 0, short ? 13 : 14, short ? 7 : 10);
      if (notePuzzle) this.keypad(bx, bottom + 14, size, 42);
      const controlsY = bottom + 14 + (notePuzzle ? 54 : 0);
      const actions = [
        { label: "Undo", action: () => this.undo(), disabled: !this.history.length },
        { label: "Redo", action: () => this.redo(), disabled: !this.redoHistory.length },
        { label: notePuzzle ? this.notes ? "Notes on" : "Notes" : "Reset", action: () => {
          if (notePuzzle) this.toggleNotes(); else this.modal = "reset";
          this.draw();
        } },
        { label: "Pause", action: () => { this.modal = "pause"; this.draw(); } },
      ];
      const buttonGap = (size - buttonSize * actions.length) / (actions.length - 1);
      actions.forEach(({ label, action, disabled }, i) => {
        this.iconButton(bx + i * (buttonSize + buttonGap), controlsY, buttonSize, buttonSize,
          label, action, false, disabled, 0);
      });
      const tutorialY = controlsY + buttonSize + 12;
      this.button(bx, tutorialY, (size - 12) / 2, buttonSize, "Tutorial", () => this.startTutorial(), false, false, 0);
      this.iconButton(bx + (size + 12) / 2, tutorialY, (size - 12) / 2, buttonSize, "Hint", () => this.openHint(), false, false, 0);
      let controlsBottom = tutorialY + buttonSize;
      if (this.notice) {
        const notice = this.text(bx, controlsBottom + 12, this.notice, 12, c.error, undefined, size);
        controlsBottom = notice.y + notice.height;
      }
      this.contentHeight = Math.max(this.H, sidebarBottom + 24, controlsBottom + 20);
    }
    if (this.scrollY) {
      this.children.getAll().forEach((object) => (object as Phaser.GameObjects.Graphics).y -= this.scrollY);
      this.controls.forEach((control) => control.y -= this.scrollY);
      this.board.y -= this.scrollY;
    }
  }
  keypad(x: number, y: number, w: number, h: number) {
    const gap = 5, bw = (w - gap * 9) / 10;
    for (let v = 1; v <= 9; v++) {
      const bx = x + (v - 1) * (bw + gap);
      const digit = this.button(
        bx,
        y,
        bw,
        h,
        String(v),
        () => this.enterNumber(v),
        false,
        this.progress?.completed || this.sudokuDigitDone(v),
      );
      digit.setFontSize(this.notes ? Math.min(18, Math.round(bw * .55)) : 24);
      if (this.notes) {
        digit.setPosition(
          bx + bw / 2 + ((v - 1) % 3 - 1) * (bw - 16) / 2,
          y + h / 2 + (Math.floor((v - 1) / 3) - 1) * (h - 20) / 2,
        );
      }
    }
    this.iconButton(
      x + 9 * (bw + gap),
      y,
      bw,
      h,
      "Erase",
      () => this.enterNumber(0),
      false,
      this.progress?.completed,
    );
  }
  setsCardRect(i: number) {
    const { x, y, cell: s } = this.board;
    return { x: x + i % 4 * s + 3, y: y + Math.floor(i / 4) * s * 1.45 + 3, w: s - 6, h: s * 1.45 - 6 };
  }
  drawSetSymbol(x: number, y: number, width: number, height: number, shape: number, fill: number, color: number) {
    const points = shape === 1
      ? [{ x, y: y - height / 2 }, { x: x + width / 2, y }, { x, y: y + height / 2 }, { x: x - width / 2, y }]
      : Array.from({ length: 48 }, (_, i) => {
        const angle = i * Math.PI * 2 / 48;
        return { x: x + Math.cos(angle) * width / 2, y: y + Math.sin(angle) * height / 2 + (shape === 2 ? Math.sin(Math.PI * Math.cos(angle)) * height * .25 : 0) };
      });
    const g = this.add.graphics().lineStyle(Math.max(1.4, width * .055), color);
    if (fill === 2) g.fillStyle(color).fillPoints(points, true);
    if (fill === 1) {
      // Clip vertical hatching mathematically to the geometric outline; no bitmap assets.
      for (let xx = x - width / 2 + 3; xx < x + width / 2; xx += Math.max(3, width / 7)) {
        const crossings: number[] = [];
        points.forEach((a, i) => {
          const b = points[(i + 1) % points.length];
          if ((a.x <= xx && b.x > xx) || (b.x <= xx && a.x > xx)) crossings.push(a.y + (xx - a.x) * (b.y - a.y) / (b.x - a.x));
        });
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) g.lineBetween(xx, crossings[i], xx, crossings[i + 1]);
      }
    }
    g.strokePoints(points, true);
  }
  drawSets() {
    const p = this.puzzle!, a = this.progress!.values, c = this.C, { x, y, cell: s } = this.board;
    const triples = findSets(p.clues);
    const review = this.modal ? [] : triples[this.reviewSet] || [];
    const colors = this.night ? [0x9bad8c, 0xc09a84, 0xaaa0b8] : [0x5b7153, 0x9b6952, 0x81708f];
    p.clues.forEach((card, i) => {
      const r = this.setsCardRect(i), chosen = !this.modal && (this.selectedCells.has(i) || review.includes(i));
      this.box(r.x, r.y, r.w, r.h, chosen ? c.soft : c.panel, chosen ? c.accent : c.line, 5);
      if (chosen || (!this.modal && this.selected === i)) {
        this.add.graphics().lineStyle(chosen ? 2.5 : 1, c.accent).strokeRoundedRect(r.x, r.y, r.w, r.h, 5);
      }
      this.text(r.x + 6, r.y + 4, String(i + 1), Math.max(10, s * .14), c.muted);
      const [count, shape, color, fill] = cardAttributes(card);
      for (let k = 0; k <= count; k++) {
        this.drawSetSymbol(r.x + r.w / 2, r.y + r.h * .56 + (k - count / 2) * s * .31, s * .56, s * .23, shape, fill, colors[color]);
      }
    });
    this.text(x + s * 2, y + s * 3.02, `${a.filter(Boolean).length} / 3 sets found`, Math.max(12, s * .18), c.ink).setOrigin(.5, 0);
    triples.forEach((cells, i) => {
      const bx = x + i * s * 4 / 3 + 3, by = y + s * 3.43, w = s * 4 / 3 - 6, h = s * .47;
      this.box(bx, by, w, h, a[i] ? c.soft : c.panel, c.line, 4);
      this.text(bx + w / 2, by + h / 2, a[i] ? cells.map((j) => j + 1).join(" · ") : "—", Math.max(12, s * .18), a[i] ? c.accent : c.muted).setOrigin(.5);
      if (a[i] && !this.modal) this.hit(bx, by, w, h, `Review set: cards ${cells.map((j) => j + 1).join(", ")}`, () => {
        this.reviewSet = this.reviewSet === i ? -1 : i;
        this.selectedCells.clear(); this.draw();
        this.announce(`Found set: cards ${cells.map((j) => j + 1).join(", ")}`);
      });
    });
  }
  selectSetCard(i: number) {
    if (i < 0 || i >= 8) return;
    this.reviewSet = -1;
    this.notice = "";
    if (this.selectedCells.has(i)) this.selectedCells.delete(i);
    else {
      if (this.selectedCells.size === 3) this.selectedCells.clear();
      this.selectedCells.add(i);
    }
    if (this.selectedCells.size === 3) {
      const cells = [...this.selectedCells].sort((a, b) => a - b);
      const triples = findSets(this.puzzle!.clues);
      const index = triples.findIndex((set) => set.every((cell, j) => cell === cells[j]));
      if (index >= 0 && !this.progress!.values[index]) {
        this.snapshot();
        this.progress!.values[index] = 1;
        this.selectedCells.clear(); this.reviewSet = index;
        this.changed();
        if (!this.progress!.completed) this.announce(`Set found. ${this.progress!.values.filter(Boolean).length} of 3. Cards remain available.`);
        return;
      }
      if (index >= 0) this.notice = "You already found this set. Choose a different trio.";
      else {
        const attributes = cells.map((cell) => cardAttributes(this.puzzle!.clues[cell]));
        const failures = SET_ATTRIBUTES.filter((_, axis) => new Set(attributes.map((card) => card[axis])).size === 2);
        this.notice = `Not a set: ${failures.join(" and ")} must be all the same or all different. Tap a card to change your selection.`;
      }
      this.announce(this.notice);
    } else this.announce(`Card ${i + 1}: ${cardDescription(this.puzzle!.clues[i])}. ${this.selectedCells.size} of 3 selected.`);
    this.draw();
  }
  akariBulb(x: number, y: number, s: number, color: number) {
    const g = this.add.graphics().lineStyle(Math.max(1.5, s * .035), color);
    g.fillStyle(color, .18).fillCircle(x, y - s * .045, s * .19);
    g.strokeCircle(x, y - s * .045, s * .19);
    g.lineBetween(x - s * .09, y + s * .15, x - s * .09, y + s * .24);
    g.lineBetween(x + s * .09, y + s * .15, x + s * .09, y + s * .24);
    g.lineBetween(x - s * .09, y + s * .24, x + s * .09, y + s * .24);
    g.lineBetween(x - s * .055, y + s * .3, x + s * .055, y + s * .3);
    for (const [dx, dy] of [[0, -1], [-1, -.5], [1, -.5]]) {
      g.lineBetween(x + dx * s * .28, y + dy * s * .28 - s * .045,
        x + dx * s * .36, y + dy * s * .36 - s * .045);
    }
  }
  drawAkari() {
    const p = this.puzzle!, a = this.progress!.values, c = this.C;
    const { x, y, cell: s } = this.board, n = p.size;
    const { lit, conflicts } = akariLights(p.clues, a, n);
    for (let i = 0; i < n * n; i++) {
      const xx = x + i % n * s, yy = y + Math.floor(i / n) * s;
      const white = p.clues[i] === AKARI_WHITE;
      const fill = white ? lit[i] ? this.night ? 0x49432b : 0xf3e8bd : c.panel : this.night ? 0x101815 : 0x343b34;
      this.box(xx, yy, s, s, fill, c.line, 0);
      if (!white && p.clues[i] >= 0) {
        this.text(xx + s / 2, yy + s / 2, String(p.clues[i]), s * .42,
          conflicts.has(i) ? this.night ? 0xffb5a0 : 0xffb49e : 0xf5f0dc).setOrigin(.5);
      } else if (white && a[i] === 1) {
        this.akariBulb(xx + s / 2, yy + s / 2, s, conflicts.has(i) ? c.error : this.tint("akari"));
      } else if (white && a[i] === 2) {
        const g = this.add.graphics().lineStyle(Math.max(1.5, s * .035), c.muted);
        g.lineBetween(xx + s * .37, yy + s * .37, xx + s * .63, yy + s * .63);
        g.lineBetween(xx + s * .63, yy + s * .37, xx + s * .37, yy + s * .63);
      }
      if (this.selected === i) this.add.graphics().lineStyle(2, c.accent).strokeRect(xx + 2, yy + 2, s - 4, s - 4);
    }
  }
  drawBoard() {
    const p = this.puzzle!,
      state = this.progress!,
      a = state.values,
      n = p.size,
      c = this.C,
      { x, y, cell: s } = this.board,
      size = s * n;
    if (p.kind === "sets") {
      this.drawSets();
      return;
    }
    if (p.kind === "atoms") {
      this.drawAtoms();
      this.add.graphics().setName("atoms-border").lineStyle(1, c.line).strokeRect(x, y, size, size);
      return;
    }
    if (p.kind === "akari") {
      this.drawAkari();
      return;
    }
    const regions = this.night
      ? [0x4c3d55, 0x334e3c, 0x514931, 0x314b52, 0x553d34, 0x3b415b, 0x464f2f, 0x553b49]
      : [0xe9dfed, 0xdbe7dc, 0xede5cd, 0xd8e6e8, 0xeedcd5, 0xdfe1ee, 0xdfe5bd, 0xeddce5];
    const activeRegion = p.kind === "shikaku" && this.selected >= 0
      ? rectangle(this.pointerStart >= 0 ? this.pointerStart : this.selected, this.selected, n)
      : [];
    const partitions = p.kind === "fivecells" ? fiveRegions(p.edges, a, n) : [];
    const partitionSizes = new Map<number, number>();
    partitions.forEach((r) => partitionSizes.set(r, (partitionSizes.get(r) || 0) + 1));
    for (let i = 0; i < n * n; i++) {
      const xx = x + (i % n) * s, yy = y + (i / n | 0) * s;
      let fill = c.panel;
      if (p.kind === "queens" || (p.kind === "dosun" && p.regions[i] >= 0)) {
        fill = regions[p.regions[i] % regions.length];
      }
      if (p.kind === "fivecells" && partitionSizes.get(partitions[i]) === 5) {
        fill = regions[partitions[i] % regions.length];
      }
      if (p.kind === "shikaku" && a[i]) fill = regions[(a[i] - 1) % regions.length];
      if (p.kind === "sudoku" || p.kind === "killer") {
        if (
          this.selected >= 0 &&
          ((i / n | 0) === (this.selected / n | 0) || i % n === this.selected % n)
        ) fill = blend(c.panel, c.soft, .65);
        if (this.selected >= 0 && a[this.selected] > 0 && a[i] === a[this.selected]) fill = c.soft;
      }
      if (
        (this.selected === i && p.kind !== "snap") || activeRegion.includes(i) ||
        ((p.kind === "sudoku" || p.kind === "killer") && this.selectedCells.has(i))
      ) {
        fill = blend(fill, c.accent, .17);
      }
      this.add.graphics().fillStyle(fill).fillRect(xx, yy, s, s);
      if (p.kind === "mosaic") {
        if (a[i] === 1) this.box(xx + 3, yy + 3, s - 6, s - 6, this.tint("mosaic"), undefined, 3);
        if (a[i] === 2) {
          const g = this.add.graphics().lineStyle(1, c.muted);
          g.lineBetween(xx + s * .65, yy + s * .65, xx + s * .78, yy + s * .78).lineBetween(
            xx + s * .78,
            yy + s * .65,
            xx + s * .65,
            yy + s * .78,
          );
        }
        if (p.clues[i] >= 0) {
          const conflict = mosaicClueConflict(p.clues[i], a, i, n);
          // Keep the red numeral legible when the clue's own square is shaded.
          if (conflict && a[i] === 1) this.circle(xx + s / 2, yy + s / 2, s * .25, c.panel);
          this.text(
            xx + s / 2,
            yy + s / 2,
            String(p.clues[i]),
            s * .37,
            conflict ? c.error : a[i] === 1 ? c.bg : c.ink,
          ).setOrigin(.5);
        }
      } else if (p.kind === "dosun") {
        if (p.regions[i] < 0) {
          this.box(xx + 1, yy + 1, s - 2, s - 2, this.night ? c.bg : c.ink, undefined, 2);
          this.add.graphics().lineStyle(1, this.night ? c.muted : c.panel, .6)
            .lineBetween(xx + s * .2, yy + s * .8, xx + s * .8, yy + s * .2);
        } else {
          if (a[i] === 1 || a[i] === 2) this.dosunPiece(xx + s / 2, yy + s / 2, s, a[i]);
          if (a[i] === 3) this.text(xx + s / 2, yy + s / 2, "×", s * .4, c.muted).setOrigin(.5);
          this.text(
            xx + 4,
            yy + 3,
            String.fromCharCode(65 + p.regions[i]),
            Math.max(8, s * .13),
            blend(fill, c.ink, .45),
          );
        }
      } else if (p.kind === "nurikabe") {
        if (a[i] === 1) this.box(xx + 2, yy + 2, s - 4, s - 4, this.tint("nurikabe"), undefined, 2);
        if (p.clues[i] > 0) {
          this.text(xx + s / 2, yy + s / 2, String(p.clues[i]), s * .4, c.ink).setOrigin(.5);
        } else if (a[i] === 2) this.circle(xx + s / 2, yy + s / 2, s * .065, c.accent);
      } else if (p.kind === "fivecells") {
        if (p.clues[i] >= 0) {
          this.text(xx + s / 2, yy + s / 2, String(p.clues[i]), s * .38, c.ink).setOrigin(.5);
        }
      } else if (p.kind === "sudoku" || p.kind === "killer") {
        if (a[i]) {
          const fixed = p.initial[i] > 0, conflict = this.numberConflict(i);
          this.text(
            xx + s * .5,
            yy + s * .5,
            String(a[i]),
            s * .66,
            conflict ? c.error : fixed ? c.ink : c.accent,
          ).setOrigin(.5);
        } else {
          const notePad = p.kind === "killer" ? 4 : 2;
          // Reserve the sum-clue corner in every Killer cell so all note grids align.
          const noteTop = p.kind === "killer" ? 1 + s * .26 : notePad;
          const noteHeight = s - noteTop - notePad;
          const slotWidth = (s - notePad * 2) / 3, slotHeight = noteHeight / 3;
          for (const v of state.notes[i] || []) {
            const note = this.text(
              xx + notePad + ((v - 1) % 3 + .5) * slotWidth,
              yy + noteTop + (Math.floor((v - 1) / 3) + .5) * slotHeight,
              String(v),
              s * .5,
              blend(c.muted, c.ink, .35),
            ).setOrigin(.5);
            // Measure digit ink instead of reserving unused ascender/descender space.
            // Fit all nine candidates tightly into their slots, including below cage totals.
            if (note.style.testString !== "0123456789") {
              note.setStyle({ testString: "0123456789", lineSpacing: 0 });
            }
            // Leave a little more air between Killer candidates and the cage dashes.
            const fit = Math.min(1, (slotWidth - .75) / note.width, (slotHeight - .75) / note.height);
            note.setScale(fit * (p.kind === "killer" ? .9 : 1));
          }
        }
      } else if (p.kind === "queens") {
        if (a[i] === 1) this.queen(xx + s / 2, yy + s / 2, s * .6, c.ink);
        else if (a[i] === 2) {
          const g = this.add.graphics().lineStyle(Math.max(2.5, s * .055), c.muted);
          g.lineBetween(xx + s * .29, yy + s * .29, xx + s * .71, yy + s * .71).lineBetween(
            xx + s * .71,
            yy + s * .29,
            xx + s * .29,
            yy + s * .71,
          );
        }
        // Tiny region IDs make regions distinguishable without color alone.
        this.text(
          xx + 5,
          yy + 4,
          String.fromCharCode(65 + p.regions[i]),
          Math.max(8, s * .13),
          blend(fill, c.ink, .45),
        );
      } else if (p.kind === "shikaku" && p.clues[i]) {
        this.text(xx + s / 2, yy + s / 2, String(p.clues[i]), s * .37, c.ink).setOrigin(.5);
      } else if (p.kind === "mambo") {
        const fixed = p.initial[i] > 0,
          color = a[i] === 1 ? this.tint("shikaku") : this.tint("pipes");
        if (a[i] === 1) this.circle(xx + s / 2, yy + s / 2, s * .19, color);
        else if (a[i] === 2) this.diamond(xx + s / 2, yy + s / 2, s * .22, color);
        if (fixed) this.circle(xx + s - 8, yy + s - 8, 2.2, c.muted);
      }
    }
    const sudokuGrid = p.kind === "sudoku" || p.kind === "killer";
    const grid = this.add.graphics().lineStyle(1, sudokuGrid ? blend(c.line, c.ink, .2) : c.line);
    for (let i = 0; i <= n; i++) {
      // Individual Sudoku cells use spacing; only the 3 × 3 boxes have borders.
      if (sudokuGrid) continue;
      grid.lineBetween(x + i * s, y, x + i * s, y + size);
      grid.lineBetween(x, y + i * s, x + size, y + i * s);
    }
    if (sudokuGrid) {
      const gaps = this.add.graphics().fillStyle(c.bg);
      // Center the same spacing on the perimeter as on each internal box boundary.
      for (let i = 0; i <= n; i++) {
        const gap = i % 3 === 0 ? 4 : 2;
        gaps.fillRect(x + i * s - gap / 2, y, gap, size);
        gaps.fillRect(x, y + i * s - gap / 2, size, gap);
      }
      const boxBorders = this.add.graphics().lineStyle(2, 0x000000);
      boxBorders.strokeRect(x, y, size, size);
      boxBorders.lineStyle(p.kind === "killer" ? 3 : 2, 0x000000);
      for (let i = 3; i < n; i += 3) {
        boxBorders.lineBetween(x + i * s, y, x + i * s, y + size);
        boxBorders.lineBetween(x, y + i * s, x + size, y + i * s);
      }
      // Cages may span boxes; keep their dashed outlines continuous across the spacing.
      if (p.kind === "killer") this.drawCages();
    }
    if (p.kind === "queens" || p.kind === "dosun" || p.kind === "shikaku") {
      const data = p.kind === "shikaku" ? a : p.regions;
      grid.lineStyle(2, blend(c.ink, c.line, .45));
      for (let i = 0; i < n * n; i++) {
        const xx = x + i % n * s, yy = y + (i / n | 0) * s;
        if (i % n < n - 1 && data[i] !== data[i + 1]) grid.lineBetween(xx + s, yy, xx + s, yy + s);
        if (i < n * (n - 1) && data[i] !== data[i + n]) {
          grid.lineBetween(xx, yy + s, xx + s, yy + s);
        }
      }
      if (this.rectStart >= 0) {
        const xx = x + this.rectStart % n * s, yy = y + (this.rectStart / n | 0) * s;
        grid.lineStyle(3, c.accent).strokeRect(xx + 2, yy + 2, s - 4, s - 4);
      }
    }
    if (p.kind === "fivecells") {
      const walls = this.add.graphics().lineStyle(3, c.accent);
      walls.strokeRect(x, y, size, size);
      p.edges.forEach((_, e) => {
        if (a[e] !== 1) return;
        const edge = this.fiveEdgeSegment(e);
        walls.lineBetween(edge.x1, edge.y1, edge.x2, edge.y2);
      });
    }
    if (p.kind === "pipes") this.drawPipes();
    if (p.kind === "snap") this.drawNumberPath();
    if (p.kind === "mambo") {
      for (const link of p.links) {
        const ax = x + (link.a % n + .5) * s,
          ay = y + ((link.a / n | 0) + .5) * s,
          bx = x + (link.b % n + .5) * s,
          by = y + ((link.b / n | 0) + .5) * s;
        this.circle((ax + bx) / 2, (ay + by) / 2, s * .12, c.panel, c.line);
        this.text((ax + bx) / 2, (ay + by) / 2, link.same ? "=" : "×", s * .22, c.ink).setOrigin(
          .5,
        );
      }
    }
    if (this.selected >= 0 && p.kind !== "fivecells") {
      const selection = (p.kind === "sudoku" || p.kind === "killer") && this.selectedCells.size
        ? this.selectedCells
        : [this.selected];
      const outline = this.add.graphics().lineStyle(2, c.accent);
      for (const i of selection) {
        const xx = x + i % n * s, yy = y + (i / n | 0) * s;
        outline.strokeRect(xx + 1, yy + 1, s - 2, s - 2);
      }
    }
  }
  numberConflict(i: number) {
    const p = this.puzzle!, a = this.progress!.values, v = a[i];
    if (!v) return false;
    const r = i / 9 | 0, c = i % 9;
    return a.some((n, j) =>
      i !== j && n === v &&
      ((j / 9 | 0) === r || j % 9 === c ||
        ((j / 27 | 0) === (r / 3 | 0) && (j % 9 / 3 | 0) === (c / 3 | 0)))
    ) || p.cages.some((g) =>
      g.cells.includes(i) && (g.cells.some((j) =>
        j !== i && a[j] === v
      ) || g.cells.reduce((sum, j) =>
            sum + a[j], 0) > g.sum ||
        (g.cells.every((j) => a[j] > 0) && g.cells.reduce((sum, j) => sum + a[j], 0) !== g.sum))
    );
  }
  drawCages() {
    const { x, y, cell: s, n } = this.board,
      p = this.puzzle!,
      color = blend(this.C.muted, this.C.ink, .45),
      g = this.add.graphics().lineStyle(1.25, color);
    const dashed = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = 0; d < len; d += 5) {
        const e = Math.min(d + 3, len);
        g.lineBetween(
          x1 + (x2 - x1) * d / len,
          y1 + (y2 - y1) * d / len,
          x1 + (x2 - x1) * e / len,
          y1 + (y2 - y1) * e / len,
        );
      }
    };
    for (const cage of p.cages) {
      const set = new Set(cage.cells);
      const first = cage.cells[0], cx = x + first % n * s, cy = y + (first / n | 0) * s;
      const inset = Math.min(2.5, s * .05);
      const label = this.text(cx + inset, cy + inset, String(cage.sum), s * .26, this.C.ink);
      if (label.style.testString !== "0123456789") {
        label.setStyle({ testString: "0123456789", lineSpacing: 0 });
      }
      // Digit-only metrics can leave no descent; reserve texture space for the
      // antialiased lower edge at fractional font sizes and high display resolutions.
      if (label.padding.bottom !== 2) label.setPadding(0, 0, 1, 2);
      for (const i of cage.cells) {
        const xx = x + i % n * s, yy = y + (i / n | 0) * s, pad = 3;
        const top = !set.has(i - n), bottom = !set.has(i + n);
        const left = i % n === 0 || !set.has(i - 1);
        const right = i % n === n - 1 || !set.has(i + 1);
        // Continue straight cage sides across cell joins instead of leaving a gap at each gridline.
        const x1 = xx + (left ? pad : 0), x2 = xx + s - (right ? pad : 0);
        const y1 = yy + (top ? pad : 0), y2 = yy + s - (bottom ? pad : 0);
        // The total sits on the cage boundary. Leave a gap in the dashes for its ink,
        // without painting a background over the cell or its selection highlight.
        if (top) dashed(i === first ? Math.max(x1, label.x + label.width + 1) : x1, yy + pad, x2, yy + pad);
        if (right) dashed(xx + s - pad, y1, xx + s - pad, y2);
        if (bottom) dashed(x1, yy + s - pad, x2, yy + s - pad);
        if (left) dashed(xx + pad, i === first ? Math.max(y1, label.y + label.height + 1) : y1, xx + pad, y2);
      }
    }
  }
  drawPipes() {
    const { x, y, cell: s, n } = this.board,
      a = this.progress!.values,
      connected = waterCells(this.puzzle!, a);
    for (let i = 0; i < n * n; i++) {
      const cx = x + (i % n + .5) * s,
        cy = y + ((i / n | 0) + .5) * s,
        color = connected.has(i) ? this.tint("pipes") : blend(this.C.muted, this.C.line, .4),
        g = this.add.graphics().lineStyle(s * .15, color);
      [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]].forEach(([bit, dx, dy]) => {
        if (a[i] & bit) g.lineBetween(cx, cy, cx + dx * s * .5, cy + dy * s * .5);
      });
      g.fillStyle(color).fillCircle(cx, cy, s * .075);
      if (i === 0) {
        this.circle(cx, cy, s * .19, color);
        this.circle(cx, cy, s * .08, this.C.panel);
      } else if ([1, 2, 4, 8].includes(a[i])) this.circle(cx, cy, s * .14, this.C.panel, color);
    }
  }
  drawAtoms() {
    const { x, y, cell: s, n } = this.board,
      p = this.puzzle!,
      a = this.progress!.values,
      c = this.C,
      degree = Array(n * n).fill(0),
      g = this.add.graphics();
    p.edges.forEach(([i, j], e) => {
      const ax = x + (i % n + .5) * s,
        ay = y + ((i / n | 0) + .5) * s,
        bx = x + (j % n + .5) * s,
        by = y + ((j / n | 0) + .5) * s;
      degree[i] += a[e];
      degree[j] += a[e];
      if (!a[e]) {
        g.lineStyle(1, c.line);
        const len = Math.hypot(bx - ax, by - ay);
        for (let d = 0; d < len; d += 8) {
          g.lineBetween(
            ax + (bx - ax) * d / len,
            ay + (by - ay) * d / len,
            ax + (bx - ax) * Math.min(d + 3, len) / len,
            ay + (by - ay) * Math.min(d + 3, len) / len,
          );
        }
      } else {
        g.lineStyle(3, this.tint("atoms"));
        const offset = a[e] === 2 ? 4 : 0;
        for (const o of offset ? [-offset, offset] : [0]) {
          g.lineBetween(
            ax + (ay === by ? 0 : o),
            ay + (ax === bx ? 0 : o),
            bx + (ay === by ? 0 : o),
            by + (ax === bx ? 0 : o),
          );
        }
      }
    });
    for (let i = 0; i < n * n; i++) {
      const cx = x + (i % n + .5) * s,
        cy = y + ((i / n | 0) + .5) * s,
        ok = degree[i] === p.clues[i],
        over = degree[i] > p.clues[i];
      this.circle(
        cx,
        cy,
        s * .26,
        ok ? this.pale("atoms") : c.panel,
        over ? c.error : ok ? this.tint("atoms") : c.line,
      );
      this.text(cx, cy, String(p.clues[i]), s * .3, over ? c.error : c.ink).setOrigin(.5);
      if (this.selected === i) {
        this.add.graphics().lineStyle(2, c.accent).strokeCircle(cx, cy, s * .34);
      }
    }
  }
  drawNumberPath() {
    const { x, y, cell: s, n } = this.board,
      p = this.puzzle!,
      a = this.progress!.values,
      color = this.tint("snap"),
      g = this.add.graphics().lineStyle(s * .3, color),
      point = (i: number) => ({ x: x + (i % n + .5) * s, y: y + ((i / n | 0) + .5) * s });
    if (a.length) {
      g.beginPath();
      a.forEach((i, k) => {
        const pos = point(i);
        if (!k) g.moveTo(pos.x, pos.y);
        else g.lineTo(pos.x, pos.y);
      });
      g.strokePath();
      a.forEach((i) => {
        const pos = point(i);
        g.fillStyle(color).fillCircle(pos.x, pos.y, s * .15);
      });
    }
    const walls = this.add.graphics().lineStyle(Math.max(3, s * .075), this.C.ink);
    p.edges.forEach((_, edge) => {
      const line = this.fiveEdgeSegment(edge);
      walls.lineBetween(line.x1, line.y1, line.x2, line.y2);
    });
    p.clues.forEach((v, i) => {
      if (v) {
        const pos = point(i);
        this.circle(
          pos.x,
          pos.y,
          s * .23,
          a.includes(i) ? color : this.C.panel,
          a.includes(i) ? undefined : this.C.line,
        );
        this.text(pos.x, pos.y, String(v), s * .32, a.includes(i) ? this.C.bg : this.C.ink)
          .setOrigin(.5);
      }
    });
  }
  fiveEdgeSegment(edge: number) {
    const [a, b] = this.puzzle!.edges[edge], { x, y, cell: s, n } = this.board;
    const cx = x + ((a % n + b % n) / 2 + .5) * s;
    const cy = y + ((Math.floor(a / n) + Math.floor(b / n)) / 2 + .5) * s;
    return a % n === b % n
      ? { x1: cx - s / 2, x2: cx + s / 2, y1: cy, y2: cy }
      : { x1: cx, x2: cx, y1: cy - s / 2, y2: cy + s / 2 };
  }
  paintFiveBorders(x: number, y: number) {
    const previous = this.borderLastPoint || { x, y }, painted: number[] = [];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(x - previous.x, y - previous.y) / (this.board.cell * .2)),
    );
    for (let step = 1; step <= steps; step++) {
      const px = previous.x + (x - previous.x) * step / steps;
      const py = previous.y + (y - previous.y) * step / steps;
      const b = this.board;
      if (px < b.x || py < b.y || px > b.x + b.n * b.cell || py > b.y + b.n * b.cell) continue;
      let best = -1, distance = b.cell * .2;
      this.puzzle!.edges.forEach((_, edge) => {
        const line = this.fiveEdgeSegment(edge);
        const dx = px - Phaser.Math.Clamp(px, line.x1, line.x2);
        const dy = py - Phaser.Math.Clamp(py, line.y1, line.y2);
        const moving = Math.hypot(x - previous.x, y - previous.y) > 4;
        const horizontal = Math.abs(x - previous.x) > Math.abs(y - previous.y);
        const d = Math.hypot(dx, dy) +
          (moving && horizontal !== (line.y1 === line.y2) ? b.cell * .05 : 0);
        if (d < distance) {
          best = edge;
          distance = d;
        }
      });
      if (best < 0 || this.borderVisited.has(best)) continue;
      if (!this.borderVisited.size) {
        this.borderPaintValue = 1 - this.progress!.values[best];
        this.snapshot();
      }
      this.borderVisited.add(best);
      if (this.progress!.values[best] !== this.borderPaintValue) {
        this.progress!.values[best] = this.borderPaintValue;
        painted.push(best);
      }
    }
    this.borderLastPoint = { x, y };
    if (painted.length) {
      this.changed();
      for (const e of painted) {
        const s = this.fiveEdgeSegment(e);
        this.touchFeedback((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, this.board.cell * .2);
      }
    }
  }
  cellAt(pointer: Phaser.Input.Pointer) {
    if (this.puzzle?.kind === "sets") {
      return Array.from({ length: 8 }, (_, i) => i).find((i) => {
        const r = this.setsCardRect(i);
        return (pointer.x / RENDER_SCALE) >= r.x && (pointer.x / RENDER_SCALE) < r.x + r.w && (pointer.y / RENDER_SCALE) >= r.y && (pointer.y / RENDER_SCALE) < r.y + r.h;
      }) ?? -1;
    }
    const { x, y, cell: s, n } = this.board;
    if ((pointer.x / RENDER_SCALE) < x || (pointer.y / RENDER_SCALE) < y || (pointer.x / RENDER_SCALE) >= x + s * n || (pointer.y / RENDER_SCALE) >= y + s * n) {
      return -1;
    }
    return Math.floor(((pointer.y / RENDER_SCALE) - y) / s) * n + Math.floor(((pointer.x / RENDER_SCALE) - x) / s);
  }
  snapshot() {
    if (!this.progress) return;
    this.history.push({
      values: [...this.progress.values],
      notes: structuredClone(this.progress.notes),
    });
    if (this.history.length > 200) this.history.shift();
    this.redoHistory = [];
  }
  changed() {
    this.notice = "";
    const solved = isSolved(this.puzzle!, this.progress!.values);
    if (solved && !this.progress!.completed) {
      this.progress!.completed = true;
      this.progress!.completedAt = new Date().toISOString();
      this.modal = null;
      this.selected = -1;
      this.selectedCells.clear();
      this.announce(
        `${META[this.puzzle!.kind].name} complete. Time ${formatTime(this.progress!.elapsed)}.`,
      );
    }
    this.persist();
    this.draw();
  }
  paintNurikabe(index: number) {
    const p = this.puzzle!, values = this.progress!.values;
    const first = !this.nurikabeVisited.size;
    const marks = cyclePaintCells(this.pointerLast, index, p.size, values, p.clues, this.nurikabeVisited);
    this.pointerLast = index;
    if (!marks.length) return;
    // One undo per stroke; crossing a cell again never changes it twice.
    if (first) this.snapshot();
    marks.forEach(({ index, value }) => values[index] = value);
    this.selected = index;
    this.changed();
    marks.forEach(({ index }) => this.cellFeedback(index));
  }
  actCell(i: number, pointer?: Phaser.Input.Pointer) {
    if (!this.puzzle || !this.progress || this.progress.completed || this.modal) return;
    const p = this.puzzle, a = this.progress.values;
    this.selected = i;
    if (p.kind === "sets") {
      this.selectSetCard(i);
      return;
    }
    if (
      p.kind === "fivecells" || (p.kind === "dosun" && p.regions[i] < 0) ||
      (p.kind === "nurikabe" && p.clues[i] > 0) ||
      (p.kind === "mosaic" && p.initial[i] > 0) ||
      (p.kind === "akari" && p.clues[i] !== AKARI_WHITE)
    ) {
      this.draw();
      return;
    }
    if (p.kind === "sudoku" || p.kind === "killer") {
      this.selectedCells = new Set([i]);
      this.draw();
      this.announce(
        `Row ${1 + (i / 9 | 0)}, column ${i % 9 + 1}, ${a[i] || "empty"}${
          p.initial[i] ? ", fixed" : ""
        }`,
      );
      return;
    }
    if (p.kind === "shikaku") {
      if (a[i]) {
        this.snapshot();
        const id = a[i];
        this.progress.values = a.map((v) => v === id ? 0 : v);
        this.rectStart = -1;
        this.changed();
        return;
      }
      if (this.rectStart < 0) {
        this.rectStart = i;
        this.draw();
        return;
      }
      this.placeRectangle(this.rectStart, i);
      return;
    }
    if (p.kind === "atoms") {
      if (!pointer) {
        this.draw();
        return;
      }
      const { x, y, cell: s, n } = this.board;
      let edge = -1, dist = Infinity;
      p.edges.forEach(([j, k], e) => {
        const ax = x + (j % n + .5) * s,
          ay = y + ((j / n | 0) + .5) * s,
          bx = x + (k % n + .5) * s,
          by = y + ((k / n | 0) + .5) * s;
        const d = Math.hypot((pointer.x / RENDER_SCALE) - (ax + bx) / 2, (pointer.y / RENDER_SCALE) - (ay + by) / 2);
        if (d < dist) {
          dist = d;
          edge = e;
        }
      });
      if (dist < s * .34) {
        this.snapshot();
        a[edge] = (a[edge] + 1) % 3;
        this.changed();
      }
      return;
    }
    if (p.kind === "snap") {
      const index = a.indexOf(i);
      if (index >= 0) {
        if (index < a.length - 1) {
          this.snapshot();
          this.progress.values = a.slice(0, index + 1);
          this.changed();
        }
        return;
      }
      if (!canStepNumberPath(p, a[a.length - 1], i)) return;
      const next = a.filter((j) => p.clues[j] > 0).length + 1;
      if (
        (p.clues[i] && p.clues[i] !== next) ||
        (p.clues[i] === Math.max(...p.clues) && a.length !== p.size ** 2 - 1)
      ) {
        this.notice = "Visit the numbered dots in order; finish after filling the grid.";
        this.draw();
        return;
      }
      this.snapshot();
      a.push(i);
      this.changed();
      return;
    }
    if (p.kind === "mambo" && p.initial[i]) {
      this.draw();
      return;
    }
    this.snapshot();
    a[i] = p.kind === "pipes" ? rotate(a[i]) : (a[i] + 1) % (p.kind === "dosun" ? 4 : 3);
    this.changed();
  }
  placeRectangle(a: number, b: number) {
    const p = this.puzzle!,
      values = this.progress!.values,
      cells = rectangle(a, b, p.size),
      clues = cells.filter((i) => p.clues[i] > 0);
    this.rectStart = -1;
    this.selected = -1;
    if (cells.some((i) => values[i]) || clues.length !== 1 || p.clues[clues[0]] !== cells.length) {
      this.notice = "Choose an empty rectangle with one clue matching its area.";
      this.draw();
      return;
    }
    this.snapshot();
    const id = Math.max(0, ...values) + 1;
    cells.forEach((i) => values[i] = id);
    this.changed();
  }
  extendSudokuSelection(i: number) {
    const added = gridLine(this.pointerLast, i, this.puzzle!.size)
      .filter((cell) => !this.selectedCells.has(cell));
    added.forEach((cell) => this.selectedCells.add(cell));
    this.pointerLast = this.selected = i;
    if (this.selectedCells.size > 1) this.notes = true;
    this.draw();
    added.forEach((cell) => this.cellFeedback(cell));
    this.announce(`${this.selectedCells.size} squares selected. Notes on.`);
  }
  toggleNotes() {
    this.notes = !this.notes;
    if (!this.notes) {
      this.selectedCells = new Set(this.selected >= 0 ? [this.selected] : []);
    }
  }
  sudokuDigitDone(v: number) {
    return v > 0 && (this.progress?.values.filter((value) => value === v).length ?? 0) >= 9;
  }
  enterNumber(v: number, asAnswer = false) {
    if (
      this.selected < 0 || !this.progress || this.progress.completed || this.modal || !this.puzzle
    ) return;
    if (this.puzzle.kind !== "sudoku" && this.puzzle.kind !== "killer") return;
    if (this.sudokuDigitDone(v)) return;
    const bulkNotes = this.notes && !asAnswer && v !== 0 && this.selectedCells.size > 1;
    const cells = [...(this.selectedCells.size ? this.selectedCells : [this.selected])]
      .filter((i) => !this.puzzle!.initial[i] && (!bulkNotes || !this.progress!.values[i]));
    if (!cells.length) return;
    this.snapshot();
    if (this.notes && v && !asAnswer) {
      const remove = cells.every((i) => this.progress!.notes[i]?.includes(v));
      for (const i of cells) {
        this.progress.values[i] = 0;
        const notes = this.progress.notes[i] || [];
        this.progress.notes[i] = remove
          ? notes.filter((n) => n !== v)
          : [...new Set([...notes, v])].sort();
      }
    } else {
      for (const i of cells) {
        this.progress.values[i] = v;
        delete this.progress.notes[i];
      }
      if (v) {
        this.progress.notes = pruneSudokuNotes(
          this.progress.values,
          this.progress.notes,
          this.puzzle.kind === "killer" ? this.puzzle.cages : [],
        );
      }
    }
    this.changed();
  }
  undo() {
    if (!this.progress || this.progress.completed || !this.history.length) return;
    this.redoHistory.push({
      values: [...this.progress.values],
      notes: structuredClone(this.progress.notes),
    });
    Object.assign(this.progress, this.history.pop()!);
    this.rectStart = -1;
    if (this.puzzle?.kind === "sets") { this.selectedCells.clear(); this.reviewSet = -1; }
    this.notice = "";
    this.persist();
    this.draw();
  }
  redo() {
    if (!this.progress || this.progress.completed || !this.redoHistory.length) return;
    this.history.push({
      values: [...this.progress.values],
      notes: structuredClone(this.progress.notes),
    });
    Object.assign(this.progress, this.redoHistory.pop()!);
    this.changed();
  }
  key(e: KeyboardEvent) {
    this.scrollMomentum.stop();
    // Phaser can replay queued DOM events before the next frame clears its queue.
    if (this.handledKeys.has(e)) return;
    this.handledKeys.add(e);
    this.queensInput.reset();
    this.sudokuTap = undefined;
    if (e.key === "Tab") {
      e.preventDefault();
      this.focused = (this.focused + (e.shiftKey ? -1 : 1) + this.controls.length) %
        this.controls.length;
      this.drawFocus();
      this.announce(this.controls[this.focused]?.label || "");
      return;
    }
    if (e.key === "Enter" && this.focused >= 0) {
      e.preventDefault();
      const action = this.controls[this.focused]?.action;
      this.focused = -1;
      action?.();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.modal === "tutorial") this.finishTutorial();
      else if (this.modal === "settings") this.closeSettings();
      else if (this.modal) {
        this.modal = null;
        this.draw();
      } else if (this.page === "game" && !this.progress?.completed) {
        this.modal = "pause";
        this.draw();
      }
      return;
    }
    if (this.modal === "tutorial") {
      if (["ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        this.advanceTutorial(e.key === "ArrowLeft" ? -1 : 1);
      }
      return;
    }
    if (this.modal || this.page !== "game" || !this.puzzle || this.progress?.completed) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      }
      return;
    }
    if (e.key.toLowerCase() === "u") {
      this.undo();
      return;
    }
    if (e.key.toLowerCase() === "n") {
      this.toggleNotes();
      this.draw();
      return;
    }
    if (this.puzzle.kind === "sets") {
      if (/^[1-8]$/.test(e.key)) { this.actCell(Number(e.key) - 1); return; }
      if (["Backspace", "Delete"].includes(e.key)) {
        e.preventDefault(); this.selectedCells.clear(); this.reviewSet = -1; this.notice = ""; this.draw(); return;
      }
      const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
      if (e.key in directions) {
        e.preventDefault();
        const old = this.selected, next = old + directions[e.key];
        this.selected = old < 0 ? 0 : next >= 0 && next < 8 && (Math.abs(directions[e.key]) === 4 || Math.floor(old / 4) === Math.floor(next / 4)) ? next : old;
        this.draw(); this.announce(`Card ${this.selected + 1}: ${cardDescription(this.puzzle.clues[this.selected])}`); return;
      }
    }
    if (/^[1-9]$/.test(e.key)) {
      this.enterNumber(Number(e.key));
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      this.enterNumber(0);
      return;
    }
    const n = this.puzzle.size,
      arrows: Record<string, number> = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in arrows) {
      e.preventDefault();
      this.focused = -1;
      const old = this.selected < 0 ? 0 : this.selected, target = old + arrows[e.key];
      if ((this.puzzle.kind === "atoms" || this.puzzle.kind === "fivecells") && e.shiftKey) {
        const edge = this.puzzle.edges.findIndex(([a, b]) =>
          (a === old && b === target) || (b === old && a === target)
        );
        if (edge >= 0) {
          this.selected = old;
          this.snapshot();
          this.progress!.values[edge] = (this.progress!.values[edge] + 1) %
            (this.puzzle.kind === "atoms" ? 3 : 2);
          this.changed();
        }
        return;
      }
      this.selected = this.selected < 0 ? 0 : adjacent(old, n).includes(target) ? target : old;
      this.selectedCells = new Set([this.selected]);
      this.draw();
      this.announce(`Row ${1 + (this.selected / n | 0)}, column ${1 + this.selected % n}`);
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this.actCell(Math.max(0, this.selected));
    }
  }
  drawCompletion(x: number, y: number, w: number) {
    const p = this.puzzle!, c = this.C, pad = 20;
    const practice = p.seed.startsWith("practice:");
    const remaining = kindsForDate(p.seed).find((kind) => !store.dailyProgress(p.seed, kind)?.completed);
    const background = this.box(x, y, w, 1, c.panel, c.line, 0);
    const title = this.text(
      x + pad,
      y + pad,
      `${META[p.kind].name} completed`,
      26,
      c.ink,
      "Georgia",
      w - pad * 2,
    );
    const body = this.text(
      x + pad,
      title.y + title.height + 12,
      `${formatTime(this.progress!.elapsed)} of quiet thinking time.`,
      14,
      c.muted,
      undefined,
      w - pad * 2,
    );
    const actionsY = body.y + body.height + 24;
    this.button(
      x + pad,
      actionsY,
      w - pad * 2,
      42,
      practice
        ? "Another of these"
        : remaining
        ? `Next: ${META[remaining].name}`
        : "The day is complete",
      () => {
        if (practice) this.openGame(p.kind, `practice:${crypto.randomUUID()}`, p.difficulty);
        else if (remaining) this.openGame(remaining, p.seed);
        else this.go("today");
      },
      true, false, 0,
    );
    this.button(
      x + pad,
      actionsY + 52,
      w - pad * 2,
      38,
      "Back to the collection",
      () => this.go(practice ? "practice" : "today"),
      false, false, 0,
    );
    const height = actionsY + 90 + pad - y;
    background.clear().fillStyle(c.panel).fillRect(x, y, w, height)
      .lineStyle(1, c.line).strokeRect(x, y, w, height);
    return height;
  }
  ruleText(x: number, y: number, w: number, rule: string, first: boolean, size = 14) {
    return this.text(x, y, rule, size, first ? this.C.ink : this.C.muted, undefined, w)
      .setFontStyle(first ? "bold" : "normal");
  }
  drawRules(x: number, y: number, w: number, rules: string[], start = 0, size = 14, gap = 10) {
    let top = y;
    rules.forEach((rule, i) => {
      this.circle(x + 3, top + 8, 2.5, this.C.accent);
      const text = this.ruleText(x + 18, top, w - 18, rule, start + i === 0, size);
      top += text.height + gap;
    });
    return top - y - gap;
  }
  drawHelp() {
    const c = this.C, w = Math.min(this.W - 32, 460), pad = 24;
    const title = `How to play ${META[this.puzzle!.kind].name}`;
    const measure = this.text(0, 0, title, 24, c.ink, "Georgia", w - pad * 2);
    const header = 24 + measure.height + 20;
    measure.destroy();
    const space = Math.max(40, this.H - 32 - header - 100);
    const pages: { rules: string[]; start: number; height: number }[] = [];
    let current = { rules: [] as string[], start: 0, height: 0 };
    META[this.puzzle!.kind].rules.forEach((rule, i) => {
      const text = this.ruleText(0, 0, w - pad * 2 - 18, rule, i === 0);
      const height = text.height;
      text.destroy();
      if (current.rules.length && current.height + 10 + height > space) {
        pages.push(current);
        current = { rules: [], start: i, height: 0 };
      }
      current.height += (current.rules.length ? 10 : 0) + height;
      current.rules.push(rule);
    });
    pages.push(current);
    this.helpPage = Phaser.Math.Clamp(this.helpPage, 0, pages.length - 1);
    const page = pages[this.helpPage], h = header + page.height + 100;
    const x = (this.W - w) / 2, y = (this.H - h) / 2;
    this.controls = [];
    this.focused = -1;
    this.add.rectangle(0, 0, this.W, this.H, c.bg, .96).setOrigin(0).setInteractive();
    this.box(x, y, w, h, c.panel, c.line, 16);
    this.text(x + pad, y + 24, title, 24, c.ink, "Georgia", w - pad * 2);
    this.drawRules(x + pad, y + header, w - pad * 2, page.rules, page.start);
    const close = () => {
      this.modal = null;
      this.draw();
    };
    if (pages.length === 1) {
      this.button(x + pad, y + h - 64, w - pad * 2, 42, "Got it", close, true);
    } else {
      this.text(x + pad, y + h - 91, `${this.helpPage + 1} of ${pages.length}`, 12, c.muted);
      const bw = (w - pad * 2 - 16) / 3;
      this.button(x + pad, y + h - 64, bw, 42, "Previous", () => {
        this.helpPage--;
        this.draw();
      }, false, this.helpPage === 0);
      this.button(x + pad + bw + 8, y + h - 64, bw, 42, "Next", () => {
        this.helpPage++;
        this.draw();
      }, false, this.helpPage === pages.length - 1);
      this.button(x + pad + (bw + 8) * 2, y + h - 64, bw, 42, "Got it", close, true);
    }
  }
  drawInstall() {
    const c = this.C, w = Math.min(this.W - 32, 460), pad = 24;
    const fontSize = this.H < 400 ? 12 : 14;
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const instructions = pwa.prompt
      ? "Tap Install below to add Daybook to your home screen."
      : apple
      ? "In Safari, open Share, then Add to Home Screen. Keep Open as Web App on if shown."
      : "Open your browser menu and choose Install app or Add to Home screen.";
    const body = instructions + "\n\n" + (pwa.ready
      ? "Ready for offline play. Your puzzles and progress stay on this device."
      : "Open Daybook online once and wait for Available offline before going offline.");
    const measured = this.text(0, 0, body, fontSize, c.muted, undefined, w - pad * 2);
    const h = 86 + measured.height + 82;
    measured.destroy();
    const x = (this.W - w) / 2, y = (this.H - h) / 2;
    this.controls = [];
    this.focused = -1;
    this.add.rectangle(0, 0, this.W, this.H, c.bg, .96).setOrigin(0).setInteractive();
    this.box(x, y, w, h, c.panel, c.line, 16);
    this.text(x + pad, y + 26, "Install Daybook", 25, c.ink, "Georgia");
    this.text(x + pad, y + 86, body, fontSize, c.muted, undefined, w - pad * 2);
    const close = () => {
      this.modal = null;
      this.draw();
    };
    if (pwa.prompt) {
      const bw = (w - pad * 2 - 10) / 2;
      this.button(x + pad, y + h - 60, bw, 40, "Back", close);
      this.button(x + pad + bw + 10, y + h - 60, bw, 40, "Install", () => {
        close();
        void installDaybook().catch(() => {
          this.modal = "install";
          this.draw();
        });
      }, true);
    } else this.button(x + pad, y + h - 60, w - pad * 2, 40, "Got it", close, true);
  }
  drawDifficulty() {
    const target = this.difficultyTarget!;
    const practice = target.seed.startsWith("practice:"), short = this.H < 480;
    const original = !practice && (!dailyDifficulty(target.kind, target.seed) || !!store.get(target.seed, target.kind));
    const c = this.C, w = Math.min(this.W - 24, 460), pad = short ? 16 : 24;
    const h = short ? original ? 296 : 252 : original ? 410 : 354;
    const x = (this.W - w) / 2, y = (this.H - h) / 2, inner = w - pad * 2;
    const pick = dailyDifficulty(target.kind, target.seed) ?? "classic";
    const level = target.choice, difficulty = level === "classic" ? undefined : level;
    const saved = store.get(target.seed, target.kind, difficulty);
    this.controls = [];
    this.focused = -1;
    this.add.rectangle(0, 0, this.W, this.H, c.bg, .96).setOrigin(0).setInteractive();
    this.box(x, y, w, h, c.panel, c.line, 0);
    this.text(x + pad, y + (short ? 14 : 24), "Choose difficulty", short ? 23 : 27, c.ink, "Georgia", inner);
    this.text(x + pad, y + (short ? 50 : 70), practice ? `${META[target.kind].name} · practice` :
      `Daily: ${DIFFICULTY_LABELS[pick]} · ${target.seed}`, short ? 13 : 14, c.muted, undefined, inner);
    const optionsY = y + (short ? 82 : 112), bw = (inner - 12) / 3;
    DIFFICULTIES.forEach((choice, i) => {
      this.button(x + pad + i * (bw + 6), optionsY, bw, 44, DIFFICULTY_LABELS[choice], () => {
        target.choice = choice; this.draw();
      }, level === choice, false, 0).setFontSize(16);
    });
    if (!short) {
      const description = difficultyDescription(target.kind, level);
      this.text(x + pad, optionsY + 58, description, 14, c.muted, undefined, inner);
    }
    const status = saved?.completed ? "Completed at this level." : saved && saved.elapsed > 0 ?
      `In progress · ${formatTime(saved.elapsed)}` : practice ? "A fresh puzzle at your chosen level." : "Not started at this level.";
    this.text(x + pad, y + (short ? 140 : 226), status, 14, c.accent, undefined, inner);
    if (!practice) this.text(x + pad, y + (short ? 161 : 251),
      "Any level counts toward today's achievement.", 12, c.muted, undefined, inner);
    if (original) {
      this.button(x + pad, y + (short ? 184 : 266), inner, 40, "Original daily board", () => {
        target.choice = "classic"; this.draw();
      }, level === "classic", false, 0).setFontSize(14);
    }
    const buttonY = y + h - 60, buttonW = (inner - 10) / 2;
    this.button(x + pad, buttonY, buttonW, 44, "Back", () => {
      this.modal = null; this.draw();
    }, false, false, 0);
    this.button(x + pad + buttonW + 10, buttonY, buttonW, 44,
      saved?.completed ? "View puzzle" : saved && saved.elapsed > 0 ? "Continue" : "Play", () => {
        if (this.page === "game" && this.puzzle?.kind === target.kind && this.puzzle.seed === target.seed &&
          this.puzzle.difficulty === difficulty) {
          this.modal = null; this.draw();
        } else this.openGame(target.kind, target.seed, level);
      }, true, false, 0);
  }
  drawModal() {
    if (this.modal === "difficulty") {
      this.drawDifficulty();
      return;
    }
    if (this.modal === "install") {
      this.drawInstall();
      return;
    }
    if (this.modal === "help") {
      this.drawHelp();
      return;
    }
    const c = this.C,
      type = this.modal!,
      isSettings = type === "settings",
      w = Math.min(this.W - 32, 460),
      h = isSettings ? 410 : 280,
      x = (this.W - w) / 2,
      y = (this.H - h) / 2;
    this.controls = [];
    this.focused = -1;
    this.add.rectangle(0, 0, this.W, this.H, c.bg, .96).setOrigin(0).setInteractive();
    this.box(x, y, w, h, c.panel, c.line, 16);
    const pad = 28;
    if (isSettings) {
      this.text(x + pad, y + 30, "Make yourself comfortable.", 25, c.ink, "Georgia", w - pad * 2);
      this.text(x + pad, y + 95, "A quieter space to think.", 14, c.muted);
      this.button(
        x + pad,
        y + 139,
        w - pad * 2,
        44,
        this.night ? "Night theme  ·  on" : "Paper theme  ·  on",
        () => {
          this.night = !this.night;
          this.settings();
          this.draw();
        },
      );
      this.button(
        x + pad,
        y + 195,
        w - pad * 2,
        44,
        this.showTimer ? "Hide timer" : "Show timer",
        () => {
          this.showTimer = !this.showTimer;
          this.settings();
          this.draw();
        },
      );
      this.text(x + pad, y + 254, "Solving time is recorded even when hidden.", 12, c.muted);
      this.button(x + pad, y + 284, w - pad * 2, 40, "Reset this puzzle", () => {
        this.modal = "reset";
        this.draw();
      });
      this.button(x + pad, y + h - 58, w - pad * 2, 36,
        this.settingsReturn ? `Back to the ${this.settingsReturn}` : "Back to the puzzle",
        () => this.closeSettings(), true);
      return;
    }
    this.text(
      x + pad,
      y + 28,
      type === "reset" ? "A fresh start?" : "Take a breath.",
      28,
      c.ink,
      "Georgia",
      w - pad * 2,
    );
    const body = type === "reset"
      ? "Clear your entries and notes for this puzzle. Your solving time will continue."
      : "Your puzzle is waiting right here.\nThe timer is paused.";
    this.text(x + pad, y + 90, body, 15, c.muted, undefined, w - pad * 2);
    if (type === "reset") {
      this.button(x + pad, y + h - 62, (w - pad * 2 - 10) / 2, 40, "Keep going", () => {
        this.modal = null;
        this.draw();
      });
      this.button(x + w / 2 + 5, y + h - 62, (w - pad * 2 - 10) / 2, 40, "Clear entries", () => {
        this.snapshot();
        this.progress!.values = [...this.puzzle!.initial];
        this.progress!.notes = {};
        this.selectedCells.clear();
        this.reviewSet = -1;
        this.progress!.completed = false;
        delete this.progress!.completedAt;
        this.rectStart = -1;
        this.modal = null;
        this.changed();
      }, true);
    } else {this.button(
        x + pad,
        y + h - 64,
        w - pad * 2,
        42,
        "Whenever you’re ready",
        () => {
          this.modal = null;
          this.draw();
        },
        true,
      );}
  }
}
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: LIGHT.bg,
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / RENDER_SCALE,
    width: Math.round(document.getElementById("game")!.clientWidth * RENDER_SCALE),
    height: Math.round(document.getElementById("game")!.clientHeight * RENDER_SCALE),
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 2 },
  scene: [Daybook],
  audio: { noAudio: true },
});
