import "../editor.css";
import {
  AXIAL_DIRECTIONS,
  HEX_SIZE,
  addHex,
  hexDistance,
  hexKey,
  hexToPixel,
  hexesInRange,
  parseHexKey,
} from "../game/hex";
import type { HexCoord } from "../game/hex";
import { hexSide, hexSideCentre } from "../game/hexagon";
import { TERRAIN_TEXTURE, tileIcons } from "../game/terrain";
import {
  COST_BY_CHAR,
  FEATURE_BY_CHAR,
  SNIPER_CHAR,
  SNIPER_RADIUS,
  TERRAIN_BY_CHAR,
  localCoord,
  validateTemplate,
} from "../game/map";
import tiles from "../game/tiles.json";
import type { SectionTemplate, SpawnPoint } from "../game/map";
import { setChildren } from "./dom";
import { iconSlotElements } from "./tile-icons";

type Point = { x: number; y: number };

/**
 * What the next hex click paints. The brush carries its own layer, so there is
 * no separate "active layer" to track or highlight.
 */
type Brush =
  | { type: "terrain"; value: string }
  | { type: "cost"; value: string }
  | { type: "overlay"; value: string }
  | { type: "spawn"; value: "clear" | number };

const TERRAIN_CHARS = Object.keys(TERRAIN_BY_CHAR);
const COST_CHARS = Object.keys(COST_BY_CHAR);
const OVERLAY_CHARS = Object.keys(FEATURE_BY_CHAR);
const ALL_EDGES: readonly number[] = [0, 1, 2, 3, 4, 5];

const SQRT3 = Math.sqrt(3);
const HEX_WIDTH = SQRT3 * HEX_SIZE;
const HEX_HEIGHT = 2 * HEX_SIZE;

/** Midpoint of each hex side, relative to the hex centre. */
const SIDE_MIDPOINT: readonly Point[] = [
  { x: (SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
  { x: (SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
];

const TERRAIN_LABEL: Record<string, string> = {
  ".": "grass",
  f: "forest",
  w: "water",
  m: "mountain",
  d: "dirt",
  "#": "impassible",
};

const COST_LABEL: Record<string, string> = {
  "1": "1 point",
  "2": "2 points",
  "3": "3 points",
  "4": "4 points",
};

const OVERLAY_LABEL: Record<string, string> = {
  ".": "none",
  S: "shop",
  T: "smith",
  R: "remove",
  G: "gain",
  c: "coin",
  x: "sniper",
  "1": "random common",
  "2": "random uncommon",
  "3": "random rare",
};

export class Editor {
  private readonly root: HTMLElement;
  private readonly onExit: () => void;
  private templates: SectionTemplate[];
  private selected: number;
  private brush: Brush;
  /** Delay shown in the spawn input and placed by the spawn brush. */
  private spawnDelay: number;

  constructor(root: HTMLElement, onExit: () => void) {
    this.root = root;
    this.onExit = onExit;
    this.templates = tiles.map(cloneTemplate);
    this.selected = 0;
    this.brush = { type: "terrain", value: "." };
    this.spawnDelay = 3;
  }

  mount(): void {
    this.render();
  }

  private render(): void {
    this.sortTemplates();
    const shell = el("div", "editor");
    setChildren(shell, [this.header(), this.body()]);
    setChildren(this.root, [shell]);
  }

  /** Keep templates grouped by difficulty; the selection follows its template. */
  private sortTemplates(): void {
    const selected = this.templates[this.selected];
    this.templates.sort((a, b) => a.difficulty - b.difficulty);
    const index = selected === undefined ? 0 : this.templates.indexOf(selected);
    this.selected = index < 0 ? 0 : index;
  }

  private header(): HTMLElement {
    const title = el("span", "editor-title");
    title.textContent = "Section editor";
    const header = el("div", "editor-header");
    setChildren(header, [
      title,
      button("New template", () => this.addTemplate()),
      button("Reset all", () => this.reset()),
      button("Copy JSON", () => this.copyJson()),
      button("Back to menu", () => this.onExit()),
    ]);
    return header;
  }

  private body(): HTMLElement {
    const body = el("div", "editor-body");
    setChildren(body, [this.sidebar(), this.main()]);
    return body;
  }

  private sidebar(): HTMLElement {
    const list = el("div", "editor-list");
    let difficulty: number | undefined;
    this.templates.forEach((template, index) => {
      if (template.difficulty !== difficulty) {
        difficulty = template.difficulty;
        const header = el("div", "editor-list-group");
        header.textContent = `Difficulty ${template.difficulty}`;
        list.append(header);
      }
      const item = button(template.id, () => this.select(index));
      item.classList.add("editor-list-item");
      if (index === this.selected) {
        item.classList.add("active");
      }
      list.append(item);
    });
    const sidebar = el("div", "editor-sidebar");
    setChildren(sidebar, [list]);
    return sidebar;
  }

  private main(): HTMLElement {
    const main = el("div", "editor-main");
    const template = this.templates[this.selected];
    if (template === undefined) {
      const empty = el("div", "editor-empty");
      empty.textContent = "No template selected.";
      setChildren(main, [empty]);
      return main;
    }
    const left = el("div", "editor-left");
    setChildren(left, [this.grid(template), this.palette()]);
    const right = el("div", "editor-right");
    setChildren(right, [
      this.fields(template),
      this.edges(template),
      this.jsonPanel(),
    ]);
    setChildren(main, [left, right]);
    return main;
  }

  private grid(template: SectionTemplate): HTMLElement {
    const radius = template.radius;
    const pixels: Point[] = [];
    for (let r = -radius; r <= radius; r += 1) {
      const length = radius * 2 + 1 - Math.abs(r);
      for (let column = 0; column < length; column += 1) {
        pixels.push(hexToPixel(localCoord(radius, r, column)));
      }
    }
    for (let side = 0; side < 6; side += 1) {
      pixels.push(hexToPixel(hexSideCentre(side, radius)));
    }

    const minX = Math.min(...pixels.map((p) => p.x));
    const maxX = Math.max(...pixels.map((p) => p.x));
    const minY = Math.min(...pixels.map((p) => p.y));
    const maxY = Math.max(...pixels.map((p) => p.y));
    const offset: Point = {
      x: -minX + HEX_WIDTH / 2 + 24,
      y: -minY + HEX_HEIGHT / 2 + 24,
    };

    const container = el("div", "editor-grid");
    container.style.width = `${maxX - minX + HEX_WIDTH + 48}px`;
    container.style.height = `${maxY - minY + HEX_HEIGHT + 48}px`;

    const snipers = sniperHexes(template);
    const range = sniperRange(snipers);
    const spawns = template.spawns;
    const templateKeys = new Set<string>();
    template.terrain.forEach((row, index) => {
      const r = index - radius;
      for (let column = 0; column < row.length; column += 1) {
        templateKeys.add(hexKey(localCoord(radius, r, column)));
      }
    });

    template.terrain.forEach((row, index) => {
      const r = index - radius;
      const overlayRow = template.overlays[index];
      const costRow = template.cost[index];
      for (let column = 0; column < row.length; column += 1) {
        const local = localCoord(radius, r, column);
        const pixel = hexToPixel(local);
        const hex = this.hexElement(
          row[column],
          costRow[column],
          overlayRow[column],
          {
            x: pixel.x + offset.x,
            y: pixel.y + offset.y,
          },
        );
        hex.addEventListener("click", () => this.paint(index, column));
        container.append(hex);
      }
    });

    for (const edge of this.rangeEdges(range, templateKeys, offset)) {
      container.append(edge);
    }

    for (const segment of this.edgeSegments(template, offset)) {
      container.append(segment);
    }

    for (const sniper of snipers) {
      const pixel = hexToPixel(sniper);
      const node = el("div", "enemy");
      node.classList.add("enemy-sniper");
      place(node, { x: pixel.x + offset.x, y: pixel.y + offset.y });
      container.append(node);
    }

    for (const spawn of spawns) {
      const pixel = hexToPixel({ q: spawn.q, r: spawn.r });
      const node = el("div", "hex-spawn");
      node.textContent = String(spawn.delay);
      place(node, { x: pixel.x + offset.x, y: pixel.y + offset.y - 26 });
      container.append(node);
    }

    return container;
  }

  private hexElement(
    terrainChar: string,
    costChar: string,
    overlayChar: string,
    pixel: Point,
  ): HTMLElement {
    const terrain = TERRAIN_BY_CHAR[terrainChar];
    const hex = el("div", "hex");
    hex.classList.add(`terrain-${terrain}`);
    hex.style.backgroundImage = `url("${TERRAIN_TEXTURE[terrain]}")`;
    place(hex, pixel);
    for (const icon of iconSlotElements(
      tileIcons(terrain, COST_BY_CHAR[costChar], FEATURE_BY_CHAR[overlayChar]),
    )) {
      hex.append(icon);
    }
    return hex;
  }

  /**
   * The outline of the sniper range, drawn the same way the game draws its
   * danger zone: for every in-template hex in range, only the sides whose
   * neighbour is out of range, so the whole zone gets one red border.
   */
  private rangeEdges(
    range: ReadonlySet<string>,
    templateKeys: ReadonlySet<string>,
    offset: Point,
  ): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const key of range) {
      if (!templateKeys.has(key)) {
        continue;
      }
      const coord = parseHexKey(key);
      const pixel = hexToPixel(coord);
      for (
        let direction = 0;
        direction < AXIAL_DIRECTIONS.length;
        direction += 1
      ) {
        const neighbour = addHex(coord, AXIAL_DIRECTIONS[direction]);
        if (range.has(hexKey(neighbour))) {
          continue;
        }
        const side = (1 - direction + 6) % 6;
        const mid = SIDE_MIDPOINT[side];
        const angle = 30 + 60 * side;
        const edge = el("div", "editor-range-edge");
        edge.style.transform =
          `translate(${pixel.x + offset.x + mid.x}px, ${pixel.y + offset.y + mid.y}px) ` +
          `translate(-50%, -50%) rotate(${angle}deg)`;
        nodes.push(edge);
      }
    }
    return nodes;
  }

  /** One segment per hex edge along each marked side, so the outline zig-zags. */
  private edgeSegments(
    template: SectionTemplate,
    offset: Point,
  ): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (let side = 0; side < 6; side += 1) {
      const isEntry = template.entryEdges.includes(side);
      const isExit = template.exitEdges.includes(side);
      if (!isEntry && !isExit) {
        continue;
      }
      const kind = isEntry && isExit ? "both" : isEntry ? "entry" : "exit";
      for (const edge of sideEdges(side, template.radius)) {
        const centre = hexToPixel(edge.hex);
        const mid = SIDE_MIDPOINT[(1 - edge.dir + 6) % 6];
        const angle = 90 - 60 * edge.dir;
        const segment = el("div", "editor-edge");
        segment.classList.add(`editor-edge-${kind}`);
        segment.style.transform =
          `translate(${centre.x + offset.x + mid.x}px, ${centre.y + offset.y + mid.y}px) ` +
          `translate(-50%, -50%) rotate(${angle}deg)`;
        nodes.push(segment);
      }
    }
    return nodes;
  }

  private palette(): HTMLElement {
    const palette = el("div", "editor-palette");
    setChildren(palette, [
      this.terrainGroup(),
      this.brushGroup("Overlay", OVERLAY_CHARS, OVERLAY_LABEL, (value) => ({
        type: "overlay",
        value,
      })),
      this.spawnGroup(),
    ]);
    return palette;
  }

  /** Terrain and its cost are one layer, so they share a group. */
  private terrainGroup(): HTMLElement {
    const terrain = TERRAIN_CHARS.map((char) =>
      this.brushButton(TERRAIN_LABEL[char], { type: "terrain", value: char }),
    );
    const cost = COST_CHARS.map((char) =>
      this.brushButton(COST_LABEL[char], { type: "cost", value: char }),
    );
    return this.group("Terrain", [terrain, cost]);
  }

  /** One layer's brushes; clicking a brush makes it the active brush. */
  private brushGroup(
    label: string,
    chars: readonly string[],
    labels: Record<string, string>,
    make: (char: string) => Brush,
  ): HTMLElement {
    const brushes = chars.map((char) =>
      this.brushButton(labels[char], make(char)),
    );
    return this.group(label, [brushes]);
  }

  /** A brush button, highlighted while it is the active brush. */
  private brushButton(label: string, brush: Brush): HTMLButtonElement {
    const node = button(label, () => this.setBrush(brush));
    if (this.isActive(brush)) {
      node.classList.add("active");
    }
    return node;
  }

  private isActive(brush: Brush): boolean {
    const current = this.brush;
    return current.type === brush.type && current.value === brush.value;
  }

  private spawnGroup(): HTMLElement {
    return this.group("Spawn", [
      [this.spawnDelayInput(), this.spawnClearButton()],
    ]);
  }

  /** A labelled palette group of one or more brush rows. */
  private group(
    label: string,
    rows: readonly (readonly HTMLElement[])[],
  ): HTMLElement {
    const header = el("div", "editor-group-header");
    header.textContent = label;
    const nodes: Node[] = [header];
    for (const row of rows) {
      const rowEl = el("div", "editor-row");
      setChildren(rowEl, row);
      nodes.push(rowEl);
    }
    const group = el("div", "editor-group");
    setChildren(group, nodes);
    return group;
  }

  /**
   * The delay the spawn brush places, in turns after the player enters. Focusing
   * or editing it selects the spawn brush; it never re-renders, so the hex click
   * that follows still lands on the hex under the cursor.
   */
  private spawnDelayInput(): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = String(this.spawnDelay);
    input.classList.add("editor-number");
    input.addEventListener("focus", () => {
      this.brush = { type: "spawn", value: this.spawnDelay };
    });
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        this.spawnDelay = Math.max(0, Math.round(parsed));
      }
      this.brush = { type: "spawn", value: this.spawnDelay };
    });
    return input;
  }

  /** Select the spawn brush in its clearing mode. */
  private spawnClearButton(): HTMLButtonElement {
    const node = button("Clear", () =>
      this.setBrush({ type: "spawn", value: "clear" }),
    );
    if (this.isActive({ type: "spawn", value: "clear" })) {
      node.classList.add("active");
    }
    return node;
  }

  private fields(template: SectionTemplate): HTMLElement {
    const panel = el("div", "editor-fields");
    panel.append(
      this.textField("id", template.id, (value) => {
        template.id = value;
        this.render();
      }),
      this.numberField("difficulty", template.difficulty, (value) => {
        template.difficulty = value;
        this.render();
      }),
      this.numberField("radius", template.radius, (value) =>
        this.setRadius(value),
      ),
      button("Clone template", () => this.cloneSelected()),
      button("Delete template", () => this.deleteTemplate()),
    );
    const status = el("div", "editor-status");
    status.textContent = validation(template);
    panel.append(status);
    return panel;
  }

  private textField(
    label: string,
    value: string,
    onChange: (value: string) => void,
  ): HTMLElement {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
    return this.field(label, input);
  }

  private numberField(
    label: string,
    value: number,
    onChange: (value: number) => void,
  ): HTMLElement {
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
    });
    return this.field(label, input);
  }

  private field(label: string, input: HTMLElement): HTMLElement {
    const text = el("span", "editor-field-label");
    text.textContent = label;
    const field = el("label", "editor-field");
    setChildren(field, [text, input]);
    return field;
  }

  private edges(template: SectionTemplate): HTMLElement {
    const panel = el("div", "editor-edges");
    panel.append(
      this.edgeRow("Entry edges", template.entryEdges, (edges) => {
        template.entryEdges = edges;
        this.render();
      }),
      this.edgeRow("Exit edges", template.exitEdges, (edges) => {
        template.exitEdges = edges;
        this.render();
      }),
    );
    return panel;
  }

  private edgeRow(
    label: string,
    edges: readonly number[],
    onChange: (edges: number[]) => void,
  ): HTMLElement {
    const text = el("span", "editor-field-label");
    text.textContent = label;
    const buttons = el("div", "editor-edge-buttons");
    for (const side of ALL_EDGES) {
      const active = edges.includes(side);
      const toggle = button(String(side), () => {
        const next = active
          ? edges.filter((edge) => edge !== side)
          : [...edges, side].sort((a, b) => a - b);
        onChange(next);
      });
      if (active) {
        toggle.classList.add("active");
      }
      buttons.append(toggle);
    }
    const row = el("div", "editor-edge-row");
    setChildren(row, [text, buttons]);
    return row;
  }

  private jsonPanel(): HTMLElement {
    const label = el("span", "editor-field-label");
    label.textContent = "JSON";
    const area = document.createElement("textarea");
    area.classList.add("editor-json-area");
    area.readOnly = true;
    area.value = JSON.stringify(this.templates, null, 2);
    const panel = el("div", "editor-json");
    setChildren(panel, [label, area]);
    return panel;
  }

  private select(index: number): void {
    this.selected = index;
    this.render();
  }

  private setBrush(brush: Brush): void {
    this.brush = brush;
    this.render();
  }

  private paint(rowIndex: number, column: number): void {
    const template = this.templates[this.selected];
    if (template === undefined) {
      return;
    }
    const brush = this.brush;
    if (brush.type === "spawn") {
      this.paintSpawn(template, rowIndex, column, brush.value);
      return;
    }
    const rows =
      brush.type === "terrain"
        ? template.terrain
        : brush.type === "overlay"
          ? template.overlays
          : template.cost;
    const row = rows[rowIndex];
    if (row === undefined) {
      return;
    }
    const chars = row.split("");
    chars[column] = brush.value;
    const next = [...rows];
    next[rowIndex] = chars.join("");
    if (brush.type === "terrain") {
      template.terrain = next;
    } else if (brush.type === "overlay") {
      template.overlays = next;
    } else {
      template.cost = next;
    }
    this.render();
  }

  /** Place or clear a spawn point on one hex, keeping the list sorted. */
  private paintSpawn(
    template: SectionTemplate,
    rowIndex: number,
    column: number,
    value: "clear" | number,
  ): void {
    const local = localCoord(
      template.radius,
      rowIndex - template.radius,
      column,
    );
    const others: SpawnPoint[] = template.spawns.filter(
      (spawn) => spawn.q !== local.q || spawn.r !== local.r,
    );
    if (value !== "clear") {
      others.push({ q: local.q, r: local.r, delay: value });
    }
    others.sort((a, b) => a.r - b.r || a.q - b.q);
    template.spawns = others;
    this.render();
  }

  private setRadius(radius: number): void {
    const template = this.templates[this.selected];
    if (template === undefined) {
      return;
    }
    const clamped = Math.max(1, Math.min(6, Math.round(radius)));
    if (clamped === template.radius) {
      return;
    }
    template.terrain = resizeRows(
      template.terrain,
      template.radius,
      clamped,
      ".",
    );
    template.cost = resizeRows(template.cost, template.radius, clamped, "1");
    template.overlays = resizeRows(
      template.overlays,
      template.radius,
      clamped,
      ".",
    );
    template.spawns = template.spawns.filter(
      (spawn) =>
        hexDistance({ q: spawn.q, r: spawn.r }, { q: 0, r: 0 }) <= clamped,
    );
    template.radius = clamped;
    this.render();
  }

  private cloneSelected(): void {
    const template = this.templates[this.selected];
    if (template === undefined) {
      return;
    }
    const copy = cloneTemplate(template);
    copy.id = this.uniqueId(template.id);
    this.templates.splice(this.selected + 1, 0, copy);
    this.selected += 1;
    this.render();
  }

  private uniqueId(base: string): string {
    const taken = new Set(this.templates.map((template) => template.id));
    if (!taken.has(base)) {
      return base;
    }
    const position = base.search(/\d+$/g);
    let [stem, digit]: [string, number] =
      position >= 0
        ? [base.substring(0, position), +base.substring(position)]
        : [base + "-", 1];

    while (taken.has(`${stem}${digit}`)) {
      digit += 1;
    }
    return `${stem}${digit}`;
  }

  private addTemplate(): void {
    const radius = 3;
    this.templates.push({
      id: this.uniqueId("template"),
      difficulty: 0,
      radius,
      terrain: emptyRows(radius, "."),
      cost: emptyRows(radius, "1"),
      overlays: emptyRows(radius, "."),
      spawns: [],
      entryEdges: [...ALL_EDGES],
      exitEdges: [...ALL_EDGES],
    });
    this.selected = this.templates.length - 1;
    this.render();
  }

  private deleteTemplate(): void {
    if (this.templates.length <= 1) {
      return;
    }
    this.templates.splice(this.selected, 1);
    this.selected = Math.max(0, this.selected - 1);
    this.render();
  }

  private reset(): void {
    const confirmed = window.confirm(
      "Reset all templates to the originals from map.ts? Your edits will be lost.",
    );
    if (!confirmed) {
      return;
    }
    this.templates = tiles.map(cloneTemplate);
    this.selected = 0;
    this.render();
  }

  private copyJson(): void {
    this.templates.sort((a, b) => a.difficulty - b.difficulty);
    const json = JSON.stringify(this.templates, null, 2);
    if (navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(json);
    }
  }
}

/**
 * The hex edges making up one side of the hexagon's outline. Each side is a
 * staircase: the outward edges of every side hex, plus the connecting edges of
 * all but the hex shared with the next side (that edge belongs to the next side).
 */
function sideEdges(
  side: number,
  radius: number,
): { hex: HexCoord; dir: number }[] {
  const outward = (1 - side + 6) % 6;
  const next = (outward + 5) % 6;
  const nextHexes = new Set(hexSide((side + 1) % 6, radius).map(hexKey));
  const edges: { hex: HexCoord; dir: number }[] = [];
  for (const hex of hexSide(side, radius)) {
    edges.push({ hex, dir: outward });
    if (!nextHexes.has(hexKey(hex))) {
      edges.push({ hex, dir: next });
    }
  }
  return edges;
}

function sniperHexes(template: SectionTemplate): HexCoord[] {
  const snipers: HexCoord[] = [];
  template.overlays.forEach((row, index) => {
    const r = index - template.radius;
    for (let column = 0; column < row.length; column += 1) {
      if (row[column] === SNIPER_CHAR) {
        snipers.push(localCoord(template.radius, r, column));
      }
    }
  });
  return snipers;
}

function sniperRange(snipers: readonly HexCoord[]): ReadonlySet<string> {
  const range = new Set<string>();
  for (const sniper of snipers) {
    for (const coord of hexesInRange(sniper, SNIPER_RADIUS)) {
      range.add(hexKey(coord));
    }
  }
  return range;
}

function cloneTemplate(template: SectionTemplate): SectionTemplate {
  return {
    id: template.id,
    difficulty: template.difficulty,
    radius: template.radius,
    terrain: [...template.terrain],
    cost: [...template.cost],
    overlays: [...template.overlays],
    spawns: template.spawns.map((spawn) => ({ ...spawn })),
    entryEdges: [...template.entryEdges],
    exitEdges: [...template.exitEdges],
  };
}

function emptyRows(radius: number, char: string): string[] {
  const rows: string[] = [];
  for (let r = -radius; r <= radius; r += 1) {
    rows.push(char.repeat(radius * 2 + 1 - Math.abs(r)));
  }
  return rows;
}

/** Rebuild a layer's rows for a new radius, keeping the overlapping cells. */
function resizeRows(
  rows: readonly string[],
  oldRadius: number,
  newRadius: number,
  empty: string,
): string[] {
  const result: string[] = [];
  for (let r = -newRadius; r <= newRadius; r += 1) {
    const length = newRadius * 2 + 1 - Math.abs(r);
    const row: string[] = [];
    for (let column = 0; column < length; column += 1) {
      const q = column - newRadius - Math.min(0, r);
      const oldColumn = q + oldRadius + Math.min(0, r);
      const oldRow = rows[r + oldRadius];
      const char =
        oldRow !== undefined && oldColumn >= 0 && oldColumn < oldRow.length
          ? oldRow[oldColumn]
          : empty;
      row.push(char);
    }
    result.push(row.join(""));
  }
  return result;
}

function validation(template: SectionTemplate): string {
  try {
    validateTemplate(template);
    return "valid";
  } catch (error) {
    return error instanceof Error ? error.message : "invalid";
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.classList.add(className);
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function place(element: HTMLElement, pixel: Point): void {
  element.style.transform = `translate(${pixel.x}px, ${pixel.y}px) translate(-50%, -50%)`;
}
