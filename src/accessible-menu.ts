export interface MenuControl {
  label: string;
  action: () => void;
  semantics?: {
    group?: "navigation" | "puzzles" | "calendar";
    description?: string;
    current?: boolean;
    date?: string;
  };
}

/** Native menu structure with visual focus supplied by the canvas renderer. */
export class AccessibleMenu {
  private root: HTMLElement;
  private signature = "";
  private view = "";
  private controls: MenuControl[] = [];
  private onFocus: (index: number) => void = () => {};

  constructor(host: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "sr-only";
    this.root.setAttribute("aria-label", "Daybook menus");
    this.root.hidden = true;
    // Native Enter, Space and Tab behavior must not also activate Phaser controls.
    this.root.addEventListener("keydown", (event) => event.stopPropagation());
    this.root.addEventListener("keyup", (event) => event.stopPropagation());
    this.root.addEventListener("focusout", (event) => {
      if (!this.root.contains(event.relatedTarget as Node | null)) this.onFocus(-1);
    });
    host.append(this.root);
  }

  hide(): boolean {
    const hadFocus = this.root.contains(document.activeElement);
    this.root.hidden = true;
    return hadFocus;
  }

  focusHeading() {
    this.root.querySelector("h1")?.focus({ preventScroll: true });
  }

  update(view: string, title: string, summary: string, controls: MenuControl[], onFocus: (index: number) => void) {
    this.controls = controls;
    this.onFocus = onFocus;
    const signature = JSON.stringify([view, title, summary, controls.map(({ label, semantics }) => [label, semantics])]);
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = this.root.contains(active);
    const previousIndex = active?.dataset.menuIndex;
    const previousLabel = active?.textContent;
    const sameView = this.view === view;
    this.root.hidden = false;
    if (signature === this.signature) return;
    this.signature = signature;
    this.view = view;
    this.root.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = title;
    heading.tabIndex = -1;
    const description = document.createElement("p");
    description.textContent = summary;
    this.root.append(heading, description);
    const buttons = new Map<number, HTMLButtonElement>();
    // Keep the whole month out of the route from navigation to the puzzle collection.
    for (const group of ["navigation", "puzzles", "calendar", "actions"] as const) {
      const entries = controls.map((control, index) => ({ control, index }))
        .filter(({ control }) => (control.semantics?.group ?? "actions") === group);
      if (!entries.length) continue;
      const section = document.createElement(group === "navigation" ? "nav" : "section");
      section.setAttribute("aria-label", { navigation: "Main navigation", puzzles: "Puzzles", calendar: "Calendar", actions: "Other actions" }[group]);
      const list = document.createElement("ul");
      section.append(list);
      this.root.append(section);
      const dates = entries.filter(({ control }) => control.semantics?.date);
      const selected = dates.find(({ control }) => control.semantics?.current) ?? dates.at(-1);
      for (const { control, index } of entries) {
        const item = document.createElement("li"), button = document.createElement("button");
        button.type = "button";
        button.textContent = control.label;
        button.dataset.menuIndex = String(index);
        if (control.semantics?.current) button.setAttribute("aria-current", control.semantics.date ? "date" : "page");
        if (control.semantics?.date) {
          button.tabIndex = selected?.index === index ? 0 : -1;
          button.setAttribute("aria-describedby", "calendar-keyboard-help");
          button.addEventListener("keydown", (event) => {
            const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
            if (offset === undefined && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const position = dates.findIndex((entry) => entry.index === index);
            const next = event.key === "Home" ? 0 : event.key === "End" ? dates.length - 1
              : Math.max(0, Math.min(dates.length - 1, position + offset!));
            buttons.get(dates[next].index)?.focus({ preventScroll: true });
          });
        }
        button.addEventListener("focus", () => {
          if (control.semantics?.date) {
            for (const entry of dates) buttons.get(entry.index)!.tabIndex = entry.index === index ? 0 : -1;
          }
          this.onFocus(index);
        });
        button.addEventListener("click", () => this.controls[index]?.action());
        item.append(button);
        if (control.semantics?.description) {
          const detail = document.createElement("p");
          detail.id = `menu-description-${index}`;
          detail.textContent = control.semantics.description;
          button.setAttribute("aria-describedby", detail.id);
          item.append(detail);
        }
        list.append(item);
        buttons.set(index, button);
      }
      if (dates.length) {
        const help = document.createElement("p");
        help.id = "calendar-keyboard-help";
        help.textContent = "Use arrow keys to move by day or week, Home or End for the first or last available day, and Enter to open a day.";
        section.append(help);
      }
    }
    if (hadFocus) {
      const matching = sameView ? [...buttons.values()].find((button) => button.textContent === previousLabel)
        ?? buttons.get(Number(previousIndex)) : undefined;
      (matching ?? heading).focus({ preventScroll: true });
    }
  }
}
