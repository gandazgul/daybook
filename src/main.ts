import Phaser from "phaser";
import "./style.css";
import { type Hint, revealHint, smartHint } from "./hints.ts";
import { fiveRegions } from "./extra-puzzles.ts";
import { gridLine, pruneSudokuNotes, QueensInput } from "./input.ts";
import { installDaybook, pwa, startPwa } from "./pwa.ts";
import { type TutorialStep, tutorialSteps, TutorialStore } from "./tutorials.ts";
import {
  adjacent,
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
type Modal = "help" | "pause" | "reset" | "settings" | "install" | "tutorial" | "hint" | null;
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
  helpPage = 0;
  tutorialPage = 0;
  hint?: Hint;
  puzzle?: Puzzle;
  progress?: Progress;
  selected = -1;
  selectedCells = new Set<number>();
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
  pointerDragged = false;
  boardPointerId = -1;
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
  notice = "";
  saveClock = 0;
  today = dateKey();
  get C() {
    return this.night ? DARK : LIGHT;
  }
  get W() {
    return this.scale.width;
  }
  get H() {
    return this.scale.height;
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
        }));
      } catch {
        // Do not discard a running puzzle if this device cannot save its reload snapshot.
        event.preventDefault();
      }
    });
    startPwa();
    this.scale.on("resize", () => {
      this.scrollY = 0;
      this.draw();
    });
    // Respond to the safe-area container itself, including rotation while the game is paused.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && (this.W !== width || this.H !== height)) {
        this.scale.getParentBounds();
        this.scale.refresh();
      }
    });
    resize.observe(document.getElementById("game")!);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => resize.disconnect());
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _x: number, dy: number) => {
      if ((!this.modal || this.modal === "tutorial" || this.modal === "hint") && this.contentHeight > this.H) {
        this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, this.contentHeight - this.H + 20);
        this.draw();
      }
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.boardPointerId >= 0 && p.id !== this.boardPointerId) return;
      this.pointerY = p.y;
      this.pointerDragged = false;
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
        this.paintFiveBorders(p.x, p.y);
      } else if (this.puzzle!.kind === "queens") {
        const edit = this.queensInput.begin(i, this.progress!.values, performance.now());
        if (!edit.mergeUndo) this.snapshot();
        this.selected = i;
        edit.marks.forEach(({ index, value }) => this.progress!.values[index] = value);
        this.changed();
      } else if (this.puzzle!.kind !== "shikaku") this.actCell(i, p);
      this.touchFeedback(p.x, p.y, Math.min(24, this.board.cell * .32));
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || (this.modal && this.modal !== "tutorial" && this.modal !== "hint") || (this.boardPointerId >= 0 && p.id !== this.boardPointerId)) {
        return;
      }
      if (this.page !== "game" || this.pointerStart < 0) {
        const dy = this.pointerY - p.y;
        if (Math.abs(dy) > 4 || this.pointerDragged) {
          this.pointerDragged = true;
          this.scrollY = Phaser.Math.Clamp(
            this.scrollY + dy,
            0,
            Math.max(0, this.contentHeight - this.H + 20),
          );
          this.pointerY = p.y;
          this.touchPulses = [];
          this.draw();
        }
        return;
      }
      if (this.puzzle?.kind === "fivecells" && !this.progress?.completed) {
        this.pointerDragged = true;
        this.paintFiveBorders(p.x, p.y);
        return;
      }
      const i = this.cellAt(p);
      if (i >= 0 && i !== this.pointerLast && !this.progress?.completed) {
        this.pointerDragged = true;
        if (this.puzzle?.kind === "sudoku" || this.puzzle?.kind === "killer") {
          this.extendSudokuSelection(i);
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
        if (this.puzzle?.kind === "queens") this.queensInput.end(i, performance.now());
        if (this.puzzle?.kind === "shikaku" && i >= 0 && this.pointerStart >= 0) {
          if (i !== this.pointerStart) this.placeRectangle(this.pointerStart, i);
          else this.actCell(i, p);
          this.touchFeedback(p.x, p.y, Math.min(24, this.board.cell * .32));
        }
      }
      this.pointerStart = this.boardPointerId = -1;
    });
    const cancelGesture = () => {
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
      // ProgressStore validates entries and reapplies any new fixed clues before rendering.
      if (saved.progress && (saved.seed.startsWith("practice:") || !store.available)) {
        const temporary = new ProgressStore({
          getItem: () => JSON.stringify({ [`${saved.seed}/${saved.kind}`]: saved.progress }),
          setItem: () => {},
        });
        const progress = temporary.get(saved.seed, saved.kind);
        if (progress) store.save(saved.seed, saved.kind, progress);
      }
      this.openGame(saved.kind, saved.seed);
    } catch { /* A damaged or unavailable snapshot should not prevent the app from opening. */ }
  }
  override update(_time: number, delta: number) {
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
    if (this.puzzle && this.progress) store.save(this.puzzle.seed, this.puzzle.kind, this.progress);
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
    return this.add.text(x, y, text, {
      fontFamily: font,
      fontSize: `${size}px`,
      color: css(color),
      lineSpacing: 6,
      ...(width ? { wordWrap: { width, useAdvancedWrap: true } } : {}),
    }).setResolution(Math.min(devicePixelRatio || 1, 2));
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
  controls: { x: number; y: number; w: number; h: number; label: string; action: () => void }[] =
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
        this.touchFeedback(pointer.x, pointer.y);
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
  ) {
    const bg = this.box(
      x,
      y,
      w,
      h,
      primary ? this.C.accent : this.C.panel,
      primary ? undefined : this.C.line,
      8,
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
    this.modal = null;
    this.scrollY = 0;
    this.focused = -1;
    this.notice = "";
    this.draw();
  }
  header() {
    const m = this.margin, y = 32 - this.scrollY, c = this.C;
    const g = this.add.graphics().fillStyle(c.accent);
    g.fillRoundedRect(m, y + 3, 9, 9, 2);
    g.fillRoundedRect(m + 13, y + 3, 9, 9, 2);
    g.fillRoundedRect(m, y + 16, 9, 9, 2);
    g.fillCircle(m + 17.5, y + 20.5, 4.5);
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
  draw() {
    // DisplayList.removeAll only detaches objects; destroy also unregisters their input areas.
    this.children.getAll().forEach((object) => object.destroy());
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
      );
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
    this.text(m, top, practice ? "A LITTLE MORE ROOM TO EXPLORE" : date, 11, c.accent)
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
    this.text(m, gridY, practice ? "THE PRACTICE ROOM" : "YOUR DAILY COLLECTION", 11, c.muted)
      .setLetterSpacing(1.6);
    const pick = featured(this.selectedDate);
    if (!this.mobile) {
      this.text(
        m + w,
        gridY,
        practice ? "A different puzzle on every visit" : `Today’s pick  /  ${META[pick].name}`,
        12,
        c.muted,
      ).setOrigin(1, 0);
    }
    gridY += 34;
    const cols = this.W < 550 ? 2 : 3,
      gap = this.mobile ? 12 : 18,
      cw = (w - gap * (cols - 1)) / cols,
      ch = this.mobile ? 240 : 234;
    kinds.forEach((kind, i) => {
      const x = m + (i % cols) * (cw + gap),
        y = gridY + Math.floor(i / cols) * (ch + gap),
        meta = META[kind],
        saved = practice ? undefined : store.get(this.selectedDate, kind),
        done = saved?.completed;
      const card = this.box(
        x,
        y,
        cw,
        ch,
        c.panel,
        !practice && kind === pick ? blend(c.accent, c.line, .5) : c.line,
        12,
      );
      this.box(x + 14, y + 14, cw - 28, 80, this.pale(kind), undefined, 7);
      this.miniature(kind, x + cw / 2, y + 53, 64);
      if (!practice && kind === pick) this.circle(x + cw - 24, y + 24, 4, this.tint(kind));
      const fs = this.mobile ? 18 : 22;
      this.text(
        x + 16,
        y + 108,
        meta.name,
        kind === "killer" && this.mobile ? 16 : fs,
        c.ink,
        "Georgia",
        cw - 32,
      );
      if (!this.mobile) {
        this.text(x + 16, y + 140, meta.description, 14, c.muted, undefined, cw - 32);
      }
      const by = y + ch - (this.mobile ? 72 : 50);
      this.text(
        x + 16,
        by,
        done
          ? `Complete · ${formatTime(saved.elapsed)}`
          : saved && saved.elapsed > 0
          ? "Continue puzzle"
          : practice
          ? "Generate & play"
          : "Ready when you are",
        14,
        done ? c.accent : c.muted,
        undefined,
        cw - 52,
      );
      this.text(x + cw - 23, by - 2, done ? "✓" : "↗", 16, this.tint(kind)).setOrigin(.5, 0);
      this.hit(
        x,
        y,
        cw,
        ch,
        `${meta.name}${done ? ", completed" : ""}`,
        () => this.openGame(kind, practice ? `practice:${crypto.randomUUID()}` : this.selectedDate),
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
    if (kind === "sudoku" || kind === "killer") {
      g.strokeRoundedRect(x + 5, y + 2, s - 10, s - 3, 3);
      for (let k = 1; k < 3; k++) {
        g.lineBetween(x + 5 + k * (s - 10) / 3, y + 2, x + 5 + k * (s - 10) / 3, y + s - 1);
        g.lineBetween(x + 5, y + 2 + k * (s - 3) / 3, x + s - 5, y + 2 + k * (s - 3) / 3);
      }
      if (kind === "killer") {
        this.text(x + 9, y + 6, "12", 9, color);
        this.text(x + 37, y + 32, "7", 18, color, "Georgia");
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
      this.text(x + cw * (i + .5), y, d, small ? 9 : 12, c.muted).setOrigin(.5, 0)
    );
    for (let day = 1; day <= days; day++) {
      const slot = first + day - 1,
        dx = x + (slot % 7 + .5) * cw,
        dy = y + 22 + Math.floor(slot / 7) * rowH,
        key = dateKey(new Date(year, month, day, 12)),
        done = store.count(key),
        future = key > this.today,
        selected = key === this.selectedDate;
      if (selected) this.circle(dx, dy + 8, small ? 11 : 21, c.accent);
      else if (done === kindsForDate(key).length) this.circle(dx, dy + 8, small ? 11 : 21, c.soft);
      this.text(
        dx,
        dy + 8,
        String(day),
        small ? 11 : 16,
        selected ? c.bg : future ? blend(c.bg, c.muted, .45) : c.ink,
      ).setOrigin(.5);
      if (!selected && (done > 0 || store.started(key))) {
        this.circle(
          dx,
          dy + (small ? 17 : 29),
          small ? 1.5 : 2.5,
          done === kindsForDate(key).length ? c.accent : done > 0 ? this.tint("shikaku") : c.muted,
        );
      }
      if (!future) {
        this.hit(
          dx - cw / 2,
          dy - (small ? 2 : 8),
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
    const c = this.C, m = this.margin, w = this.width, y = (this.mobile ? 177 : 140) - this.scrollY;
    this.text(m, y, "YOUR PUZZLE JOURNAL", 11, c.accent).setLetterSpacing(1.5);
    this.text(m, y + 33, "One day at a time.", this.mobile ? 34 : 44, c.ink, "Georgia");
    this.text(
      m,
      y + 93,
      "Revisit a day, finish a thought, or start something new.",
      14,
      c.muted,
      undefined,
      w,
    );
    const cw = Math.min(w, 590), cx = m + (w - cw) / 2, cy = y + 153;
    this.box(cx, cy, cw, 415, c.panel, c.line);
    this.text(
      cx + cw / 2,
      cy + 29,
      this.month.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      24,
      c.ink,
      "Georgia",
    ).setOrigin(.5, 0);
    this.button(cx + 16, cy + 18, 40, 40, "‹", () => {
      this.month.setMonth(this.month.getMonth() - 1);
      this.draw();
    });
    const canNext = this.month.getFullYear() < new Date().getFullYear() ||
      (this.month.getFullYear() === new Date().getFullYear() &&
        this.month.getMonth() < new Date().getMonth());
    this.button(
      cx + cw - 56,
      cy + 18,
      40,
      40,
      "›",
      () => {
        this.month.setMonth(this.month.getMonth() + 1);
        this.draw();
      },
      false,
      !canNext,
    );
    this.calendarGrid(
      cx + 18,
      cy + 90,
      cw - 36,
      this.month.getFullYear(),
      this.month.getMonth(),
      45,
    );
    const ly = cy + 438;
    this.circle(cx + 6, ly + 6, 4, c.accent);
    this.text(cx + 18, ly, "Complete", 11, c.muted);
    this.circle(cx + cw / 3 + 6, ly + 6, 4, this.tint("shikaku"));
    this.text(cx + cw / 3 + 18, ly, "In progress", 11, c.muted);
    this.circle(cx + cw * 2 / 3 + 6, ly + 6, 4, c.line);
    this.text(cx + cw * 2 / 3 + 18, ly, "Unplayed", 11, c.muted);
    this.text(
      cx,
      ly + 48,
      "An unfinished day is just an invitation. Your puzzles will be here.",
      14,
      c.muted,
      "Georgia",
      cw,
    );
    this.button(cx, ly + 103, 160, 42, "Return to today", () => {
      this.selectedDate = this.today;
      this.go("today");
    });
    this.contentHeight = ly + 175 + this.scrollY;
  }
  openGame(kind: Kind, seed: string) {
    this.queensInput.reset();
    this.sudokuTap = undefined;
    this.pointerStart = this.boardPointerId = -1;
    this.persist();
    this.notice = "";
    try {
      this.puzzle = generate(kind, seed);
      this.progress = store.load(this.puzzle);
    } catch (error) {
      console.error(error);
      this.notice = "This puzzle could not load. Please choose another day.";
      this.announce(this.notice);
      return;
    }
    this.page = "game";
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
    this.announce(`${META[kind].name}. ${META[kind].rules.join(" ")}`);
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
      this.finishTutorial();
      return;
    }
    this.tutorialPage = Math.max(0, this.tutorialPage + delta);
    this.scrollY = 0;
    this.focused = -1;
    this.draw();
    this.announceTutorial();
  }
  finishTutorial() {
    tutorials.markSeen(this.puzzle!.kind);
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
    const margin = 16, top = 80, gap = 24;
    const wide = this.W >= 760 || this.W > this.H;
    const width = Math.min(1080, this.W - margin * 2), left = (this.W - width) / 2;
    const boardSpace = wide ? (width - gap) * .43 : width;
    const cardWidth = wide ? width - boardSpace - gap : Math.min(width, 480);
    const pad = 16, textWidth = cardWidth - pad * 2;
    const short = wide && this.H < 400;
    const title = this.text(0, 0, step.title, short ? 21 : 23, c.ink, "Georgia", textWidth);
    const body = this.text(0, 0, step.text, short ? 14 : 16, c.ink, undefined, textWidth);
    if (short) body.setLineSpacing(4);
    // Keep the board and navigation still between steps, even when a rule takes more lines.
    const height = Math.max(...steps.map((item) => {
      title.setText(item.title);
      body.setText(item.text);
      return pad * 2 + title.height + 12 + body.height + 20 + 42;
    }));
    title.setText(step.title);
    body.setText(step.text);
    const size = Math.max(120, Math.min(480, boardSpace, wide ? this.H - top - margin - legendHeight : this.H - top - height - gap - margin - legendHeight));
    const bx = wide ? left + (boardSpace - size) / 2 : (this.W - size) / 2;
    const by = top;
    const cardX = wide ? left + boardSpace + gap : (this.W - cardWidth) / 2;
    const cardY = wide ? top : by + size + gap + legendHeight;
    this.text(left, 19, META[p.kind].name, 20, c.ink, "Georgia", width - 88);
    this.text(left, 51, inHint ? (this.hint?.values ? "HINT · PROPOSED MOVE" : "HINT") : `${step.finished ? "FINISHED EXAMPLE" : step.example ? "RULE EXAMPLE" : "TUTORIAL"} · ${this.tutorialPage + 1} OF ${steps.length}`, 12, c.accent).setLetterSpacing(1);
    this.button(left + width - 72, 18, 72, 40, inHint ? "Close" : "Skip", () => inHint ? this.closeHint() : this.finishTutorial()).setFontSize(16);

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
    this.box(cardX, cardY, cardWidth, height, c.panel, c.line, 12);
    title.setPosition(cardX + pad, cardY + pad);
    body.setPosition(cardX + pad, cardY + pad + title.height + 12);
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
  }
  drawNurikabeExample(rows: string[]) {
    const { x, y, cell: s, n } = this.board, c = this.C;
    this.box(x - 7, y - 7, n * s + 14, n * s + 14, c.panel, c.line, 9);
    rows.forEach((row, r) => [...row].forEach((value, col) => {
      const xx = x + col * s, yy = y + r * s;
      this.box(xx, yy, s, s, c.panel, c.line, 0);
      if (value === "#") this.box(xx + 2, yy + 2, s - 4, s - 4, this.tint("nurikabe"), undefined, 2);
      else if (value === "o") this.circle(xx + s / 2, yy + s / 2, s * .065, c.accent);
      else if (value !== "?") this.text(xx + s / 2, yy + s / 2, value, s * .4, c.ink).setOrigin(.5);
    }));
  }
  drawGame() {
    if (!this.puzzle || !this.progress) return;
    const compact = this.W < 1050 || this.H < 720;
    const p = this.puzzle,
      c = this.C,
      m = this.margin,
      w = this.width,
      meta = META[p.kind],
      practice = p.seed.startsWith("practice:"),
      top = 26;
    const backY = top + 19;
    this.add.graphics().lineStyle(2, c.ink).beginPath()
      .moveTo(m + 7, backY - 5).lineTo(m + 2, backY).lineTo(m + 7, backY + 5).strokePath();
    this.text(m + 26, backY, compact ? "Back" : "The collection", 14, c.muted).setOrigin(0, .5);
    this.hit(
      m - 5,
      top - 4,
      compact ? 85 : 165,
      46,
      "Back to collection",
      () => this.go(practice ? "practice" : "today"),
    );
    this.text(this.W / 2, top + 10, "daybook", 25, c.ink, "Georgia").setOrigin(.5, 0);
    this.button(this.W - m - 44, top + 1, 44, 40, "☼", () => {
      this.modal = "settings";
      this.draw();
    });
    this.line(m, 86, this.W - m, 86);
    const titleY = 112;
    this.text(
      m,
      titleY,
      practice ? "THE PRACTICE ROOM" : parseDate(p.seed).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).toUpperCase(),
      11,
      c.accent,
    ).setLetterSpacing(1.5);
    const headingSize = compact ? 34 : 42;
    const heading = this.text(m, titleY + 27, meta.name, headingSize, c.ink, "Georgia");
    if (heading.width > w) heading.setFontSize(Math.floor(headingSize * w / heading.width));
    if (!compact) this.text(m, titleY + 84, meta.description, 15, c.muted);
    const size = Math.min(compact ? w : 492, Math.max(225, this.H - (compact ? 344 : 370)));
    const bx = compact ? m + (w - size) / 2 : m + (Math.min(w, 690) - size) / 2,
      by = compact ? 205 : 246;
    this.board = { x: bx, y: by, cell: size / p.size, n: p.size };
    this.drawBoard();
    const bottom = by + size;
    if (this.progress.completed) {
      const sx = compact ? bx : m + Math.min(w, 690) + 32;
      const sy = compact ? bottom + 22 : by;
      const sw = compact ? size : w - (sx - m);
      const height = this.drawCompletion(sx, sy, sw);
      this.button(sx, sy + height + 12, sw, 40, "Tutorial", () => this.startTutorial());
      this.contentHeight = Math.max(this.H, bottom + 30, sy + height + 76);
    } else if (compact) {
      if (this.showTimer) {
        this.clockText = this.text(
          this.W - m,
          titleY + 3,
          formatTime(this.progress.elapsed),
          12,
          c.muted,
        ).setOrigin(1, 0);
        this.hit(this.W - m - 100, titleY - 7, 110, 38, "Hide timer", () => {
          this.showTimer = false;
          this.settings();
          this.draw();
        });
      }
      if (p.kind === "sudoku" || p.kind === "killer") this.keypad(bx, bottom + 18, size, 40);
      const ty = bottom + ((p.kind === "sudoku" || p.kind === "killer") ? 72 : 22);
      const bw = (size - 24) / 4;
      this.button(
        bx,
        ty,
        bw,
        40,
        "Undo",
        () => this.undo(),
        false,
        !this.history.length || this.progress.completed,
      );
      this.button(
        bx + bw + 8,
        ty,
        bw,
        40,
        p.kind === "sudoku" || p.kind === "killer" ? (this.notes ? "Notes on" : "Notes") : "Reset",
        () => {
          if (p.kind === "sudoku" || p.kind === "killer") {
            this.toggleNotes();
            this.draw();
          } else {
            this.modal = "reset";
            this.draw();
          }
        },
        false,
        this.progress.completed,
      );
      this.button(bx + (bw + 8) * 2, ty, bw, 40, "Rules", () => {
        this.helpPage = 0;
        this.modal = "help";
        this.draw();
      });
      this.button(bx + (bw + 8) * 3, ty, bw, 40, "Pause", () => {
        this.modal = "pause";
        this.draw();
      });
      const tutorialY = ty + 52;
      this.button(bx, tutorialY, (size - 10) / 2, 40, "Tutorial", () => this.startTutorial());
      this.button(bx + (size + 10) / 2, tutorialY, (size - 10) / 2, 40, "Hint", () => this.openHint());
      const helpY = tutorialY + 53;
      const help = this.text(
        bx,
        helpY,
        this.progress.completed
          ? "Beautifully done. Take a breath."
          : this.notice || this.shortHelp(p.kind),
        11,
        this.notice ? c.error : c.muted,
        undefined,
        size,
      );
      this.contentHeight = Math.max(this.H, helpY + help.height + 24);
    } else {
      const sx = m + Math.min(w, 690) + 32, sw = w - (sx - m);
      if (this.showTimer) {
        this.text(sx, by - 5, "A MOMENT TO FOCUS", 11, c.muted).setLetterSpacing(1.4);
        this.clockText = this.text(
          sx,
          by + 28,
          formatTime(this.progress.elapsed),
          27,
          c.ink,
          "Georgia",
        );
        this.hit(sx, by + 23, 170, 42, "Hide timer", () => {
          this.showTimer = false;
          this.settings();
          this.draw();
        });
        this.line(sx, by + 82, sx + sw, by + 82);
      }
      const helpY = this.showTimer ? by + 108 : by - 5;
      this.text(sx, helpY, "HOW TO PLAY", 10, c.accent).setLetterSpacing(1.5);
      this.button(sx, helpY + 24, (sw - 10) / 2, 40, "Tutorial", () => this.startTutorial());
      this.button(sx + (sw + 10) / 2, helpY + 24, (sw - 10) / 2, 40, "Hint", () => this.openHint());
      const rulesHeight = this.drawRules(sx, helpY + 82, sw, META[p.kind].rules);
      const controlsY = Math.max(helpY + 249, helpY + 82 + rulesHeight + 24);
      if (p.kind === "sudoku" || p.kind === "killer") {
        this.keypad(bx, bottom + 20, size, 42);
      }
      this.button(
        sx,
        controlsY,
        (sw - 10) / 2,
        42,
        "Undo",
        () => this.undo(),
        false,
        !this.history.length || this.progress.completed,
      );
      this.button(
        sx + (sw + 10) / 2,
        controlsY,
        (sw - 10) / 2,
        42,
        "Redo",
        () => this.redo(),
        false,
        !this.redoHistory.length || this.progress.completed,
      );
      const notePuzzle = p.kind === "sudoku" || p.kind === "killer";
      this.button(
        sx,
        controlsY + 53,
        (sw - 10) / 2,
        42,
        notePuzzle ? (this.notes ? "Notes on" : "Notes") : "Reset",
        () => {
          if (notePuzzle) {
            this.toggleNotes();
            this.draw();
          } else {
            this.modal = "reset";
            this.draw();
          }
        },
        false,
        this.progress.completed,
      );
      this.button(
        sx + (sw + 10) / 2,
        controlsY + 53,
        (sw - 10) / 2,
        42,
        "Pause",
        () => {
          this.modal = "pause";
          this.draw();
        },
        true,
      );
      if (notePuzzle) {
        this.text(sx, controlsY + 121, "Reset puzzle", 12, c.muted);
        this.hit(sx, controlsY + 105, 110, 40, "Reset puzzle", () => {
          this.modal = "reset";
          this.draw();
        });
      }
      this.contentHeight = Math.max(this.H, controlsY + 165, bottom + 125);
      if (this.notice) this.text(bx, bottom + 79, this.notice, 12, c.error, undefined, size);
      else {this.text(
          bx,
          bottom + (notePuzzle ? 82 : 25),
          this.progress.completed ? "Beautifully done. Take a breath." : this.shortHelp(p.kind),
          12,
          c.muted,
          undefined,
          size,
        );}
    }
    if (this.scrollY) {
      this.children.getAll().forEach((object) => {
        const item = object as Phaser.GameObjects.Graphics;
        item.y -= this.scrollY;
      });
      this.controls.forEach((control) => control.y -= this.scrollY);
      this.board.y -= this.scrollY;
    }
  }
  shortHelp(kind: Kind) {
    switch (kind) {
      case "sudoku":
      case "killer":
        return "Drag across squares for notes · 1–9 to fill · N for notes · Backspace to clear";
      case "pipes":
        return "Tap to rotate. Bring every pipe into the flow.";
      case "atoms":
        return "Tap between atoms: one line, two lines, then clear.";
      case "queens":
        return "Tap or drag to mark X · Double-tap for a queen · Tap a mark to clear";
      case "shikaku":
        return "Drag a rectangle, or tap two opposite corners.";
      case "snap":
        return "Start at 1. Follow the numbers. Fill every square.";
      case "mambo":
        return "Tap for a circle, a diamond, or an empty square.";
      case "mosaic":
        return "Numbered squares are fixed. Tap other squares to shade; empty marks are optional.";
      case "dosun":
        return "Tap: balloon → weight → X → clear. X marks are optional.";
      case "nurikabe":
        return "Tap: sea → island dot → clear. Keep one connected sea, without 2 × 2 pools.";
      case "fivecells":
        return "Tap or drag grid edges. Make groups of five; clues count bordering sides.";
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
    this.button(
      x + 9 * (bw + gap),
      y,
      bw,
      h,
      "×",
      () => this.enterNumber(0),
      false,
      this.progress?.completed,
    );
  }
  drawBoard() {
    const p = this.puzzle!,
      state = this.progress!,
      a = state.values,
      n = p.size,
      c = this.C,
      { x, y, cell: s } = this.board,
      size = s * n;
    this.box(x - 7, y - 7, size + 14, size + 14, c.panel, c.line, 9);
    if (p.kind === "atoms") {
      this.drawAtoms();
      return;
    }
    const regions = this.night
      ? [0x4c3d55, 0x334e3c, 0x514931, 0x314b52, 0x553d34, 0x3b415b, 0x464f2f]
      : [0xe9dfed, 0xdbe7dc, 0xede5cd, 0xd8e6e8, 0xeedcd5, 0xdfe1ee, 0xdfe5bd];
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
            xx + s / 2,
            yy + s / 2 + (p.kind === "killer" ? 3 : 0),
            String(a[i]),
            s * .49,
            conflict ? c.error : fixed ? c.ink : c.accent,
          ).setOrigin(.5);
        } else {
          const noteTop = p.kind === "killer" && p.cages.some((cage) => cage.cells[0] === i)
            ? 3 + Math.max(12, s * .24)
            : 0;
          const noteHeight = s - noteTop;
          for (const v of state.notes[i] || []) {
            this.text(
              xx + ((v - 1) % 3 + .5) * s / 3,
              yy + noteTop + (Math.floor((v - 1) / 3) + .5) * noteHeight / 3,
              String(v),
              Math.min(s * .28, noteHeight * .4),
              c.muted,
            ).setOrigin(.5);
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
    const grid = this.add.graphics().lineStyle(1, c.line);
    for (let i = 0; i <= n; i++) {
      grid.lineBetween(x + i * s, y, x + i * s, y + size);
      grid.lineBetween(x, y + i * s, x + size, y + i * s);
    }
    if (p.kind === "sudoku" || p.kind === "killer") {
      grid.lineStyle(2, blend(c.ink, c.line, .45));
      for (let i = 0; i <= 9; i += 3) {
        grid.lineBetween(x + i * s, y, x + i * s, y + size);
        grid.lineBetween(x, y + i * s, x + size, y + i * s);
      }
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
      color = blend(this.C.muted, this.C.ink, .25),
      g = this.add.graphics().lineStyle(1, color);
    const dashed = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = 0; d < len; d += 6) {
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
      for (const i of cage.cells) {
        const xx = x + i % n * s, yy = y + (i / n | 0) * s, pad = 3;
        if (!set.has(i - n)) dashed(xx + pad, yy + pad, xx + s - pad, yy + pad);
        if (i % n === n - 1 || !set.has(i + 1)) {
          dashed(xx + s - pad, yy + pad, xx + s - pad, yy + s - pad);
        }
        if (!set.has(i + n)) dashed(xx + pad, yy + s - pad, xx + s - pad, yy + s - pad);
        if (i % n === 0 || !set.has(i - 1)) dashed(xx + pad, yy + pad, xx + pad, yy + s - pad);
      }
      const i = cage.cells[0], xx = x + i % n * s, yy = y + (i / n | 0) * s;
      this.box(
        xx + 4,
        yy + 3,
        Math.max(15, s * .32),
        Math.max(12, s * .24),
        this.C.panel,
        undefined,
        0,
      );
      this.text(xx + 5, yy + 3, String(cage.sum), Math.max(9, s * .2), this.C.ink);
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
    const { x, y, cell: s, n } = this.board;
    if (pointer.x < x || pointer.y < y || pointer.x >= x + s * n || pointer.y >= y + s * n) {
      return -1;
    }
    return Math.floor((pointer.y - y) / s) * n + Math.floor((pointer.x - x) / s);
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
  actCell(i: number, pointer?: Phaser.Input.Pointer) {
    if (!this.puzzle || !this.progress || this.progress.completed || this.modal) return;
    const p = this.puzzle, a = this.progress.values;
    this.selected = i;
    if (
      p.kind === "fivecells" || (p.kind === "dosun" && p.regions[i] < 0) ||
      (p.kind === "nurikabe" && p.clues[i] > 0) ||
      (p.kind === "mosaic" && p.initial[i] > 0)
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
        const d = Math.hypot(pointer.x - (ax + bx) / 2, pointer.y - (ay + by) / 2);
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
      if (!adjacent(a[a.length - 1], p.size).includes(i)) return;
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
    const remaining = kindsForDate(p.seed).find((kind) => !store.get(p.seed, kind)?.completed);
    const background = this.box(x, y, w, 1, c.panel, c.line, 12);
    const title = this.text(
      x + pad,
      y + pad,
      "A little clarity.",
      26,
      c.ink,
      "Georgia",
      w - pad * 2,
    );
    const body = this.text(
      x + pad,
      title.y + title.height + 12,
      `${META[p.kind].name}, completed.\n${
        formatTime(this.progress!.elapsed)
      } of quiet thinking time.`,
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
        if (practice) this.openGame(p.kind, `practice:${crypto.randomUUID()}`);
        else if (remaining) this.openGame(remaining, p.seed);
        else this.go("today");
      },
      true,
    );
    this.button(
      x + pad,
      actionsY + 52,
      w - pad * 2,
      38,
      "Back to the collection",
      () => this.go(practice ? "practice" : "today"),
    );
    const height = actionsY + 90 + pad - y;
    background.clear().fillStyle(c.panel).fillRoundedRect(x, y, w, height, 12)
      .lineStyle(1, c.line).strokeRoundedRect(x, y, w, height, 12);
    return height;
  }
  ruleText(x: number, y: number, w: number, rule: string, first: boolean) {
    return this.text(x, y, rule, 14, first ? this.C.ink : this.C.muted, undefined, w)
      .setFontStyle(first ? "bold" : "normal");
  }
  drawRules(x: number, y: number, w: number, rules: string[], start = 0) {
    let top = y;
    rules.forEach((rule, i) => {
      this.circle(x + 3, top + 8, 2.5, this.C.accent);
      const text = this.ruleText(x + 18, top, w - 18, rule, start + i === 0);
      top += text.height + 10;
    });
    return top - y - 10;
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
  drawModal() {
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
      this.button(x + pad, y + h - 58, w - pad * 2, 36, "Back to the puzzle", () => {
        this.modal = null;
        this.draw();
      }, true);
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
    mode: Phaser.Scale.RESIZE,
    width: document.getElementById("game")!.clientWidth,
    height: document.getElementById("game")!.clientHeight,
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 2 },
  scene: [Daybook],
  audio: { noAudio: true },
});
