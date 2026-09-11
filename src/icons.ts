import type Phaser from "phaser";

export const ACTION_ICONS: Record<string, string> = {
  Settings: "gear",
  "Back to collection": "back",
  "Previous month": "back",
  "Next month": "forward",
  Undo: "undo",
  Redo: "redo",
  Notes: "pencil",
  "Notes on": "pencil",
  Rules: "book",
  Pause: "pause",
  Hint: "bulb",
  Reset: "reset",
  "Reset puzzle": "reset",
  Erase: "eraser",
};

/** Small geometric controls, drawn in the engine with the current theme's ink. */
export function drawActionIcon(
  g: Phaser.GameObjects.Graphics,
  icon: string,
  x: number,
  y: number,
  size: number,
  color: number,
  background: number,
) {
  const r = size / 2;
  const line = (a: number, b: number, c: number, d: number) =>
    g.lineBetween(x + a * r, y + b * r, x + c * r, y + d * r);
  const points = (coords: number[][]) => coords.map(([a, b]) => ({ x: x + a * r, y: y + b * r }));
  g.lineStyle(Math.max(2.2, size * .085), color).fillStyle(color);
  switch (icon) {
    case "gear": {
      const teeth = Array.from({ length: 32 }, (_, i) => {
        const a = i * Math.PI / 16, radius = r * (i % 4 < 2 ? 1 : .76);
        return { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius };
      });
      g.fillPoints(teeth, true).fillStyle(background).fillCircle(x, y, r * .34);
      break;
    }
    case "back":
      line(.35, -.7, -.35, 0);
      line(-.35, 0, .35, .7);
      break;
    case "forward":
      line(-.35, -.7, .35, 0);
      line(.35, 0, -.35, .7);
      break;
    case "undo":
    case "redo": {
      const direction = icon === "undo" ? 1 : -1;
      g.beginPath().moveTo(x - direction * r * .75, y - r * .35)
        .lineTo(x + direction * r * .15, y - r * .35)
        .arc(x + direction * r * .15, y + r * .15, r * .5, -Math.PI / 2, Math.PI / 2, direction < 0)
        .strokePath();
      line(direction * -.35, -.75, direction * -.75, -.35);
      line(direction * -.75, -.35, direction * -.35, .05);
      break;
    }
    case "pencil":
      g.strokePoints(
        points([[-.75, .75], [-.55, .08], [.4, -.87], [.86, -.4], [-.08, .55], [-.75, .75]]),
      );
      line(.19, -.66, .66, -.19);
      line(-.55, .08, -.08, .55);
      break;
    case "book":
      g.strokePoints(
        points([
          [-.8, -.7],
          [-.2, -.7],
          [0, -.5],
          [.2, -.7],
          [.8, -.7],
          [.8, .65],
          [.2, .65],
          [0, .85],
          [-.2, .65],
          [-.8, .65],
          [-.8, -.7],
        ]),
      );
      line(0, -.5, 0, .85);
      line(-.55, -.3, -.25, -.3);
      line(.25, -.3, .55, -.3);
      break;
    case "pause":
      g.fillRect(x - r * .6, y - r * .8, r * .4, r * 1.6);
      g.fillRect(x + r * .2, y - r * .8, r * .4, r * 1.6);
      break;
    case "bulb":
      g.strokeCircle(x, y - r * .2, r * .55);
      line(-.3, .25, -.3, .7);
      line(.3, .25, .3, .7);
      line(-.3, .7, .3, .7);
      line(-.15, .95, .15, .95);
      line(-.8, -.2, -1, -.2);
      line(.8, -.2, 1, -.2);
      line(0, -.98, 0, -1.15);
      break;
    case "reset":
      g.beginPath().arc(x, y, r * .72, -Math.PI * .65, Math.PI * .95).strokePath();
      g.fillPoints(points([[-.7, -.8], [.1, -.8], [-.3, -.2]]), true);
      break;
    case "eraser":
      g.strokePoints(
        points([[-.85, .12], [.08, -.8], [.85, -.03], [.05, .77], [-.2, .77], [-.85, .12]]),
      );
      line(-.4, -.33, .37, .44);
      line(-.2, .8, .9, .8);
      break;
  }
}
