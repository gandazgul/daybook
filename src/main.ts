import Phaser from "phaser";
import "./style.css";
import {
  adjacent,
  generate,
  isSolved,
  type Kind,
  KINDS,
  META,
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
type Modal = "help" | "pause" | "reset" | "settings" | null;
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
let savedSettings: { night?: boolean; timer?: boolean } = {};
try {
  savedSettings = JSON.parse(browserStorage.getItem("daybook:settings") || "{}");
} catch { /* Safe defaults for private browsing. */ }

class Daybook extends Phaser.Scene {
  page: Page = "today";
  selectedDate = dateKey();
  month = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  night = savedSettings?.night ?? (new Date().getHours() >= 19 || new Date().getHours() < 7);
  showTimer = savedSettings?.timer ?? false;
  modal: Modal = null;
  puzzle?: Puzzle;
  progress?: Progress;
  selected = -1;
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
    this.scale.on("resize", () => {
      this.scrollY = 0;
      this.draw();
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _x: number, dy: number) => {
      if (!this.modal && this.contentHeight > this.H) {
        this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, this.contentHeight - this.H + 20);
        this.draw();
      }
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pointerY = p.y;
      this.pointerDragged = false;
      this.pointerStart = -1;
      if (this.page !== "game" || this.modal || this.progress?.completed) return;
      const i = this.cellAt(p);
      this.pointerStart = i;
      this.pointerLast = i;
      if (i >= 0) {
        if (this.puzzle!.kind === "shikaku") { /* Finish rectangle on release. */ }
        else this.actCell(i, p);
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || this.modal) return;
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
          this.draw();
        }
        return;
      }
      const i = this.cellAt(p);
      if (i >= 0 && i !== this.pointerLast && !this.progress?.completed) {
        this.pointerDragged = true;
        this.pointerLast = i;
        if (this.puzzle?.kind === "snap") this.actCell(i, p);
        else if (this.puzzle?.kind === "shikaku") {
          this.selected = i;
          this.draw();
        }
      }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (
        this.page === "game" && !this.modal && !this.progress?.completed &&
        this.puzzle?.kind === "shikaku"
      ) {
        const i = this.cellAt(p);
        if (i >= 0 && this.pointerStart >= 0) {
          if (i !== this.pointerStart) this.placeRectangle(this.pointerStart, i);
          else this.actCell(i, p);
        }
      }
      this.pointerStart = -1;
    });
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
    this.draw();
  }
  override update(_time: number, delta: number) {
    if (this.active) {
      this.progress!.elapsed += Math.min(delta, 1000) / 1000;
      this.saveClock += delta;
      if (this.clockText?.active) {
        this.clockText.setText(
          this.showTimer ? formatTime(this.progress!.elapsed) : "Timer hidden",
        );
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
    zone.on("pointerup", () => {
      if (!this.pointerDragged) {
        this.focused = -1;
        action();
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
    this.text(
      x + w / 2,
      y + h / 2,
      label,
      14,
      disabled ? this.C.muted : primary ? this.C.bg : this.C.ink,
    ).setOrigin(.5);
    if (!disabled) this.hit(x, y, w, h, label, action, bg);
  }
  tint(kind: Kind) {
    return this.night ? blend(META[kind].color, DARK.ink, .42) : META[kind].color;
  }
  pale(kind: Kind) {
    return this.night ? blend(DARK.panel, META[kind].color, .19) : META[kind].pale;
  }
  go(page: Page) {
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
      for (let i = 0; i < KINDS.length; i++) {
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
    this.contentHeight = this.H;
    if (this.page === "game") this.drawGame();
    else {
      this.header();
      if (this.page === "calendar") this.drawCalendarPage();
      else this.drawCollection();
    }
    if (this.modal) this.drawModal();
    this.drawFocus();
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
        : "Nine little challenges. Take your time.",
      this.mobile ? 14 : 16,
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
      for (let i = 0; i < KINDS.length; i++) {
        this.circle(
          m + 5 + i * (this.mobile ? 16 : 20),
          py + 5,
          4,
          i < completed ? c.accent : c.line,
        );
      }
      this.text(
        m + (this.mobile ? 158 : 194),
        py - 2,
        `${completed} of ${KINDS.length} completed`,
        12,
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
      ch = this.mobile ? 194 : 214;
    KINDS.forEach((kind, i) => {
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
        this.text(x + 16, y + 140, meta.description, 12, c.muted, undefined, cw - 32);
      }
      const by = y + ch - 30;
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
        11,
        done ? c.accent : c.muted,
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
    const end = gridY + Math.ceil(KINDS.length / cols) * (ch + gap) + 19;
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
    this.contentHeight = end + 110 + this.scrollY;
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
    } else {
      this.circle(x + 14, y + 15, 10, color);
      this.diamond(x + 48, y + 15, 12, color);
      this.diamond(x + 14, y + 49, 12, color);
      this.circle(x + 48, y + 49, 10, color);
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
      else if (done === KINDS.length) this.circle(dx, dy + 8, small ? 11 : 21, c.soft);
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
          done === KINDS.length ? c.accent : done > 0 ? this.tint("shikaku") : c.muted,
        );
      }
      if (!future) {
        this.hit(
          dx - cw / 2,
          dy - (small ? 2 : 8),
          cw,
          rowH,
          `${key}, ${done} of ${KINDS.length} completed`,
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
    this.rectStart = -1;
    this.history = [];
    this.redoHistory = [];
    this.notes = false;
    this.scrollY = 0;
    this.draw();
    this.announce(`${META[kind].name}. ${META[kind].rules}`);
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
    this.text(m, top + 7, "‹", 28, c.ink);
    this.text(m + 26, top + 14, compact ? "Back" : "The collection", 14, c.muted);
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
      this.contentHeight = Math.max(this.H, bottom + 30, sy + height + 30);
    } else if (compact) {
      this.clockText = this.text(
        this.W - m,
        titleY + 3,
        this.progress.completed
          ? formatTime(this.progress.elapsed)
          : this.showTimer
          ? formatTime(this.progress.elapsed)
          : "Timer hidden",
        12,
        c.muted,
      ).setOrigin(1, 0);
      this.hit(this.W - m - 100, titleY - 7, 110, 38, "Toggle timer display", () => {
        this.showTimer = !this.showTimer;
        this.settings();
        this.draw();
      });
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
            this.notes = !this.notes;
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
        this.modal = "help";
        this.draw();
      });
      this.button(bx + (bw + 8) * 3, ty, bw, 40, "Pause", () => {
        this.modal = "pause";
        this.draw();
      });
      this.contentHeight = Math.max(this.H, ty + 100);
      this.text(
        bx,
        ty + 53,
        this.progress.completed
          ? "Beautifully done. Take a breath."
          : this.notice || this.shortHelp(p.kind),
        11,
        this.notice ? c.error : c.muted,
        undefined,
        size,
      );
    } else {
      const sx = m + Math.min(w, 690) + 32, sw = w - (sx - m);
      this.text(sx, by - 5, "A MOMENT TO FOCUS", 11, c.muted).setLetterSpacing(1.4);
      this.clockText = this.text(
        sx,
        by + 28,
        this.progress.completed
          ? formatTime(this.progress.elapsed)
          : this.showTimer
          ? formatTime(this.progress.elapsed)
          : "Timer hidden",
        27,
        c.ink,
        "Georgia",
      );
      this.hit(sx, by + 23, 170, 42, "Toggle timer display", () => {
        this.showTimer = !this.showTimer;
        this.settings();
        this.draw();
      });
      this.text(
        sx,
        by + 75,
        this.progress.completed ? "Completed. Nicely done." : "There’s no hurry.",
        13,
        c.muted,
      );
      this.line(sx, by + 113, sx + sw, by + 113);
      this.text(sx, by + 137, "HOW TO PLAY", 10, c.accent).setLetterSpacing(1.5);
      const rules = this.text(sx, by + 163, META[p.kind].rules, 14, c.muted, undefined, sw);
      const controlsY = Math.max(by + 330, rules.y + rules.height + 24);
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
            this.notes = !this.notes;
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
        return "Select a square · 1–9 to fill · N for notes · Backspace to clear";
      case "pipes":
        return "Tap to rotate. Bring every pipe into the flow.";
      case "atoms":
        return "Tap between atoms: one line, two lines, then clear.";
      case "queens":
        return "Tap to place a queen, mark a cross, or clear.";
      case "shikaku":
        return "Drag a rectangle, or tap two opposite corners.";
      case "snap":
        return "Start at 1. Follow the numbers. Fill every square.";
      case "mambo":
        return "Tap for a circle, a diamond, or an empty square.";
      case "mosaic":
        return "Tap to shade, mark empty, or clear. Count each 3 × 3 neighborhood.";
    }
  }
  keypad(x: number, y: number, w: number, h: number) {
    const gap = 5, bw = (w - gap * 9) / 10;
    for (let v = 1; v <= 9; v++) {
      this.button(
        x + (v - 1) * (bw + gap),
        y,
        bw,
        h,
        String(v),
        () => this.enterNumber(v),
        false,
        this.progress?.completed,
      );
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
    for (let i = 0; i < n * n; i++) {
      const xx = x + (i % n) * s, yy = y + (i / n | 0) * s;
      let fill = c.panel;
      if (p.kind === "queens") fill = regions[p.regions[i] % regions.length];
      if (p.kind === "shikaku" && a[i]) fill = regions[(a[i] - 1) % regions.length];
      if (p.kind === "sudoku" || p.kind === "killer") {
        if (
          this.selected >= 0 &&
          ((i / n | 0) === (this.selected / n | 0) || i % n === this.selected % n)
        ) fill = blend(c.panel, c.soft, .65);
        if (this.selected >= 0 && a[this.selected] > 0 && a[i] === a[this.selected]) fill = c.soft;
      }
      if ((this.selected === i && p.kind !== "snap") || activeRegion.includes(i)) {
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
          this.text(xx + s / 2, yy + s / 2, String(p.clues[i]), s * .37, a[i] === 1 ? c.bg : c.ink)
            .setOrigin(.5);
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
        } else {for (const v of state.notes[i] || []) {
            this.text(
              xx + ((v - 1) % 3 + .5) * s / 3,
              yy + ((v - 1) / 3 | 0) * s / 3 + s / 6,
              String(v),
              s * .23,
              c.muted,
            ).setOrigin(.5);
          }}
      } else if (p.kind === "queens") {
        if (a[i] === 1) this.queen(xx + s / 2, yy + s / 2, s * .6, c.ink);
        else if (a[i] === 2) {
          const g = this.add.graphics().lineStyle(1.5, c.muted);
          g.lineBetween(xx + s * .42, yy + s * .42, xx + s * .58, yy + s * .58).lineBetween(
            xx + s * .58,
            yy + s * .42,
            xx + s * .42,
            yy + s * .58,
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
    if (p.kind === "queens" || p.kind === "shikaku") {
      const data = p.kind === "queens" ? p.regions : a;
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
    if (this.selected >= 0) {
      const xx = x + this.selected % n * s, yy = y + (this.selected / n | 0) * s;
      this.add.graphics().lineStyle(2, c.accent).strokeRect(xx + 1, yy + 1, s - 2, s - 2);
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
    if (p.kind === "sudoku" || p.kind === "killer") {
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
    a[i] = p.kind === "pipes" ? rotate(a[i]) : (a[i] + 1) % 3;
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
  enterNumber(v: number) {
    if (
      this.selected < 0 || !this.progress || this.progress.completed || this.modal || !this.puzzle
    ) return;
    if (this.puzzle.kind !== "sudoku" && this.puzzle.kind !== "killer") return;
    const i = this.selected;
    if (this.puzzle.initial[i]) return;
    this.snapshot();
    if (this.notes && v) {
      if (this.progress.values[i]) this.progress.values[i] = 0;
      const notes = this.progress.notes[i] || [];
      this.progress.notes[i] = notes.includes(v)
        ? notes.filter((n) => n !== v)
        : [...notes, v].sort();
    } else {
      this.progress.values[i] = v;
      delete this.progress.notes[i];
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
      if (this.modal) {
        this.modal = null;
        this.draw();
      } else if (this.page === "game" && !this.progress?.completed) {
        this.modal = "pause";
        this.draw();
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
      this.notes = !this.notes;
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
      if (this.puzzle.kind === "atoms" && e.shiftKey) {
        const edge = this.puzzle.edges.findIndex(([a, b]) =>
          (a === old && b === target) || (b === old && a === target)
        );
        if (edge >= 0) {
          this.snapshot();
          this.progress!.values[edge] = (this.progress!.values[edge] + 1) % 3;
          this.changed();
        }
        return;
      }
      this.selected = this.selected < 0 ? 0 : adjacent(old, n).includes(target) ? target : old;
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
    const remaining = KINDS.find((kind) => !store.get(p.seed, kind)?.completed);
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
  drawModal() {
    const c = this.C,
      type = this.modal!,
      isSettings = type === "settings",
      isHelp = type === "help",
      w = Math.min(this.W - 32, 460),
      h = isHelp ? 400 : isSettings ? 410 : 280,
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
        this.showTimer ? "Timer visible  ·  tap to hide" : "Timer hidden  ·  tap to show",
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
    const name = this.puzzle ? META[this.puzzle.kind].name : "";
    this.text(
      x + pad,
      y + 28,
      isHelp ? `How to play ${name}` : type === "reset" ? "A fresh start?" : "Take a breath.",
      28,
      c.ink,
      "Georgia",
      w - pad * 2,
    );
    let body = isHelp
      ? META[this.puzzle!.kind].rules
      : type === "reset"
      ? "Clear your entries and notes for this puzzle. Your solving time will continue."
      : "Your puzzle is waiting right here.\nThe timer is paused.";
    if (isHelp && this.puzzle!.kind === "atoms") {
      body += " Keyboard: select an atom with arrows; hold Shift + an arrow to cycle that bond.";
    }
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
        isHelp ? "Got it" : "Whenever you’re ready",
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
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 2 },
  scene: [Daybook],
  audio: { noAudio: true },
});
