/**
 * Controller diagram (roadmap F26): an SVG of the standard Gamepad-API
 * mapping (w3c standard layout — Xbox / Stadia / DS4 in BT mode all land
 * here). Controls carrying assignments are highlighted; clicking one hands
 * a canonical control suffix ("button0", "axis0", …) back to the caller so
 * it can highlight the binding rows.
 *
 * Keys are index-agnostic suffixes: "gamepad2.button6" matches "button6" —
 * the drawing is the same physical pad whichever slot it enumerated into.
 */

export interface DiagramHooks {
  /** Does any binding reference this control suffix? */
  isAssigned(suffix: string): boolean;
  /** Tooltip lines for this control ("" if unassigned). */
  titleFor(suffix: string): string;
  onClick(suffix: string): void;
}

interface Ctl {
  /** Suffixes this visual represents (sticks carry two axes + click). */
  keys: string[];
  label: string;
  shape: "circle" | "rect";
  x: number;
  y: number;
  /** circle: r; rect: w/h. */
  r?: number;
  w?: number;
  h?: number;
}

const CTLS: Ctl[] = [
  { keys: ["button6"], label: "LT", shape: "rect", x: 60, y: 6, w: 64, h: 14 },
  { keys: ["button7"], label: "RT", shape: "rect", x: 296, y: 6, w: 64, h: 14 },
  { keys: ["button4"], label: "LB", shape: "rect", x: 60, y: 26, w: 64, h: 12 },
  { keys: ["button5"], label: "RB", shape: "rect", x: 296, y: 26, w: 64, h: 12 },
  { keys: ["button12"], label: "▲", shape: "rect", x: 88, y: 78, w: 22, h: 22 },
  { keys: ["button13"], label: "▼", shape: "rect", x: 88, y: 126, w: 22, h: 22 },
  { keys: ["button14"], label: "◀", shape: "rect", x: 62, y: 102, w: 22, h: 22 },
  { keys: ["button15"], label: "▶", shape: "rect", x: 114, y: 102, w: 22, h: 22 },
  { keys: ["button3"], label: "Y", shape: "circle", x: 321, y: 86, r: 11 },
  { keys: ["button0"], label: "A", shape: "circle", x: 321, y: 140, r: 11 },
  { keys: ["button2"], label: "X", shape: "circle", x: 294, y: 113, r: 11 },
  { keys: ["button1"], label: "B", shape: "circle", x: 348, y: 113, r: 11 },
  { keys: ["button8"], label: "sel", shape: "rect", x: 168, y: 88, w: 26, h: 13 },
  { keys: ["button9"], label: "start", shape: "rect", x: 226, y: 88, w: 26, h: 13 },
  { keys: ["button16"], label: "⌂", shape: "circle", x: 210, y: 118, r: 9 },
  { keys: ["axis0", "axis1", "button10"], label: "L", shape: "circle", x: 160, y: 152, r: 17 },
  { keys: ["axis2", "axis3", "button11"], label: "R", shape: "circle", x: 260, y: 152, r: 17 },
];

const NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

export function gamepadDiagram(hooks: DiagramHooks): SVGSVGElement {
  const svg = svgEl("svg");
  svg.setAttribute("viewBox", "0 0 420 200");
  svg.classList.add("gp-diagram");

  const body = svgEl("path");
  body.setAttribute(
    "d",
    "M 90 50 H 330 C 385 50 405 100 398 145 C 393 178 360 190 335 172 L 300 148 H 120 L 85 172 C 60 190 27 178 22 145 C 15 100 35 50 90 50 Z",
  );
  body.classList.add("gp-body");
  svg.append(body);

  for (const ctl of CTLS) {
    const g = svgEl("g");
    g.classList.add("gp-ctl");
    const assigned = ctl.keys.some((k) => hooks.isAssigned(k));
    if (assigned) g.classList.add("assigned");

    let shape: SVGElement;
    let cx: number;
    let cy: number;
    if (ctl.shape === "circle") {
      shape = svgEl("circle");
      shape.setAttribute("cx", String(ctl.x));
      shape.setAttribute("cy", String(ctl.y));
      shape.setAttribute("r", String(ctl.r ?? 10));
      cx = ctl.x;
      cy = ctl.y;
    } else {
      shape = svgEl("rect");
      shape.setAttribute("x", String(ctl.x));
      shape.setAttribute("y", String(ctl.y));
      shape.setAttribute("width", String(ctl.w ?? 20));
      shape.setAttribute("height", String(ctl.h ?? 20));
      shape.setAttribute("rx", "4");
      cx = ctl.x + (ctl.w ?? 20) / 2;
      cy = ctl.y + (ctl.h ?? 20) / 2;
    }
    g.append(shape);

    const text = svgEl("text");
    text.setAttribute("x", String(cx));
    text.setAttribute("y", String(cy + 3.5));
    text.setAttribute("text-anchor", "middle");
    text.textContent = ctl.label;
    g.append(text);

    const titleText = ctl.keys
      .map((k) => hooks.titleFor(k))
      .filter((t) => t.length > 0)
      .join("\n");
    const title = svgEl("title");
    title.textContent = titleText || `${ctl.keys.join(" / ")} — unassigned`;
    g.append(title);

    g.addEventListener("click", () => hooks.onClick(ctl.keys.find((k) => hooks.isAssigned(k)) ?? ctl.keys[0]!));
    svg.append(g);
  }
  return svg;
}
