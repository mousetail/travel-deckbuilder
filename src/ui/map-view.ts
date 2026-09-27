import {
  AXIAL_DIRECTIONS,
  HEX_SIZE,
  addHex,
  hexKey,
  hexToPixel,
  parseHexKey,
  pixelToHex,
} from "../game/hex";
import type { HexCoord } from "../game/hex";
import { TERRAIN_TEXTURE, tileIcons } from "../game/terrain";
import type { Tile } from "../game/terrain";
import { enemyName } from "../game/enemies";
import type { Enemy } from "../game/enemies";
import type { FogLevel } from "../game/fog";
import type { HoverPath } from "../game/reach";
import type { Mover } from "../game/transition";
import targetUrl from "../images/terrain-icons/target.png";
import { setChildren } from "./dom";
import { iconSlotElements } from "./tile-icons";

/**
 * One pre-computed highlight state: the reachable outline and the attackable
 * enemies for a given card (or the union across the hand). The outline is a
 * single SVG, so switching highlights is one show/hide per group.
 */
export type HighlightGroup = {
  key: string;
  reachable: ReadonlySet<string>;
  targets: ReadonlySet<string>;
};

export type MapViewState = {
  tiles: ReadonlyMap<string, Tile>;
  fog: ReadonlyMap<string, FogLevel>;
  player: HexCoord;
  enemies: readonly Enemy[];
  /** Hexes an enemy could strike at the end of this turn. */
  danger: ReadonlySet<string>;
  /** Every hex each enemy could strike, keyed by enemy id. */
  enemyDanger: ReadonlyMap<string, ReadonlySet<string>>;
  turn: number;
  /** Every possible highlight, pre-computed so hover can just show/hide. */
  highlights: readonly HighlightGroup[];
  /** Which highlight is visible right now, or null for none. */
  activeHighlight: string | null;
};

export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);
const SVG_NS = "http://www.w3.org/2000/svg";
/** The stroke is centred on each side, so it spills past the corners. */
const OUTLINE_PAD = 2;
/** How far the pointer must travel before a press counts as a drag, in pixels. */
const DRAG_THRESHOLD = 4;
/** Zoom bounds and how fast the wheel changes it. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_RATE = 0.0015;

/** A pointer press that may become a pan. */
type DragState = {
  pointerId: number;
  button: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

/** The six corners of a pointy-top hex centred at `pixel`, radius HEX_SIZE. */
function hexCorners(pixel: Point): Point[] {
  return [
    { x: pixel.x, y: pixel.y - HEX_SIZE },
    { x: pixel.x + (SQRT3 / 2) * HEX_SIZE, y: pixel.y - HEX_SIZE / 2 },
    { x: pixel.x + (SQRT3 / 2) * HEX_SIZE, y: pixel.y + HEX_SIZE / 2 },
    { x: pixel.x, y: pixel.y + HEX_SIZE },
    { x: pixel.x - (SQRT3 / 2) * HEX_SIZE, y: pixel.y + HEX_SIZE / 2 },
    { x: pixel.x - (SQRT3 / 2) * HEX_SIZE, y: pixel.y - HEX_SIZE / 2 },
  ];
}

type Segment = { a: Point; b: Point };

/**
 * The outline of a set of hexes: for every hex, the sides whose neighbour is not
 * in the set, as world-pixel segments. Side `s` of a hex runs from corner `s` to
 * corner `s + 1`, so the whole region gets one continuous border.
 */
function outlineSegments(hexes: ReadonlySet<string>): Segment[] {
  const segments: Segment[] = [];
  for (const key of hexes) {
    const coord = parseHexKey(key);
    const corners = hexCorners(hexToPixel(coord));
    for (
      let direction = 0;
      direction < AXIAL_DIRECTIONS.length;
      direction += 1
    ) {
      const neighbour = addHex(coord, AXIAL_DIRECTIONS[direction]);
      if (hexes.has(hexKey(neighbour))) {
        continue;
      }
      const side = (1 - direction + 6) % 6;
      segments.push({ a: corners[side], b: corners[(side + 1) % 6] });
    }
  }
  return segments;
}

/** An SVG positioned at `(minX, minY)` in world pixels, sized to its content. */
function positionedSvg(
  minX: number,
  minY: number,
  width: number,
  height: number,
  classes: readonly string[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add(...classes);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);
  svg.style.transform = `translate(${minX}px, ${minY}px)`;
  return svg;
}

/** The outline of `hexes` as one SVG, or null when there is nothing to draw. */
function outlineSvg(
  hexes: ReadonlySet<string>,
  className: string,
): SVGSVGElement | null {
  const segments = outlineSegments(hexes);
  if (segments.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minX = Math.min(minX, segment.a.x, segment.b.x);
    maxX = Math.max(maxX, segment.a.x, segment.b.x);
    minY = Math.min(minY, segment.a.y, segment.b.y);
    maxY = Math.max(maxY, segment.a.y, segment.b.y);
  }
  minX -= OUTLINE_PAD;
  minY -= OUTLINE_PAD;
  maxX += OUTLINE_PAD;
  maxY += OUTLINE_PAD;

  const svg = positionedSvg(
    minX,
    minY,
    maxX - minX,
    maxY - minY,
    ["map-outline", className],
  );
  for (const segment of segments) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", `${segment.a.x - minX}`);
    line.setAttribute("y1", `${segment.a.y - minY}`);
    line.setAttribute("x2", `${segment.b.x - minX}`);
    line.setAttribute("y2", `${segment.b.y - minY}`);
    svg.append(line);
  }
  return svg;
}

/** The hover paths as one SVG of polylines through the hex centres, or null. */
function pathsSvg(paths: readonly HoverPath[]): SVGSVGElement | null {
  const drawable = paths.filter((path) => path.path.length >= 2);
  if (drawable.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of drawable) {
    for (const coord of path.path) {
      const pixel = hexToPixel(coord);
      minX = Math.min(minX, pixel.x);
      maxX = Math.max(maxX, pixel.x);
      minY = Math.min(minY, pixel.y);
      maxY = Math.max(maxY, pixel.y);
    }
  }
  minX -= OUTLINE_PAD;
  minY -= OUTLINE_PAD;
  maxX += OUTLINE_PAD;
  maxY += OUTLINE_PAD;

  const svg = positionedSvg(minX, minY, maxX - minX, maxY - minY, ["map-path"]);
  for (const path of drawable) {
    const polyline = document.createElementNS(SVG_NS, "polyline");
    polyline.setAttribute(
      "points",
      path.path
        .map((coord) => {
          const pixel = hexToPixel(coord);
          return `${pixel.x - minX},${pixel.y - minY}`;
        })
        .join(" "),
    );
    polyline.classList.add(
      path.kind === "player" ? "path-player" : "path-enemy",
    );
    svg.append(polyline);
  }
  return svg;
}

/**
 * Draws the visible window. Every node lives in a single `world` layer at
 * world-pixel coordinates, so moving the camera is one transform on that layer
 * rather than a rewrite of every node — which is what lets the camera pan
 * smoothly while an actor walks.
 */
export class MapView {
  private readonly layer: HTMLElement;
  private readonly world: HTMLElement;
  private readonly pathLayer: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly onHexClick: (coord: HexCoord) => void;
  private readonly onHexHover: (coord: HexCoord | null) => void;
  private readonly onCancel: () => void;
  private camera: Point = { x: 0, y: 0 };
  private zoom = 1;
  private drag: DragState | null = null;
  /** Set when a drag ends, so the click it would otherwise fire is ignored. */
  private suppressClick = false;
  private hoveredKey: string | null = null;
  private playerNode: HTMLElement | null = null;
  private readonly enemyNodes = new Map<string, HTMLElement>();
  private readonly enemyHex = new Map<string, string>();
  private readonly enemyById = new Map<string, Enemy>();
  private enemyDanger = new Map<string, ReadonlySet<string>>();
  private dangerOutline: SVGSVGElement | null = null;
  private readonly enemyOutlines = new Map<string, SVGSVGElement>();
  private readonly highlightGroups = new Map<string, HighlightNodes>();
  private activeHighlight: string | null = null;
  private hoverPaths: readonly HoverPath[] = [];

  constructor(
    layer: HTMLElement,
    onHexClick: (coord: HexCoord) => void,
    onHexHover: (coord: HexCoord | null) => void,
    onCancel: () => void,
  ) {
    this.layer = layer;
    this.onHexClick = onHexClick;
    this.onHexHover = onHexHover;
    this.onCancel = onCancel;

    this.world = document.createElement("div");
    this.world.classList.add("world");
    this.pathLayer = document.createElement("div");
    this.pathLayer.classList.add("path-layer");
    this.tooltip = document.createElement("div");
    this.tooltip.classList.add("enemy-tooltip", "hidden");
    setChildren(layer, [this.world]);

    layer.addEventListener("click", (event) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      const rect = layer.getBoundingClientRect();
      this.onHexClick(
        pixelToHex(
          this.screenToWorld({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        ),
      );
    });
    layer.addEventListener("mousemove", (event) => {
      if (this.drag !== null) {
        return;
      }
      const rect = layer.getBoundingClientRect();
      const coord = pixelToHex(
        this.screenToWorld({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }),
      );
      const key = hexKey(coord);
      if (key !== this.hoveredKey) {
        this.hoveredKey = key;
        this.onHexHover(coord);
        this.updateHoverCursor();
        this.applyHover();
      }
    });
    layer.addEventListener("mouseleave", () => {
      if (this.drag !== null) {
        return;
      }
      if (this.hoveredKey !== null) {
        this.hoveredKey = null;
        this.onHexHover(null);
        this.updateHoverCursor();
        this.applyHover();
      }
    });
    layer.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onCancel();
    });
    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      this.suppressClick = false;
      // Cancelling the middle press stops the browser's autoscroll; the left
      // press must not be cancelled or its click would never fire.
      if (event.button === 1) {
        event.preventDefault();
      }
      this.drag = {
        pointerId: event.pointerId,
        button: event.button,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      layer.setPointerCapture(event.pointerId);
    });
    layer.addEventListener("pointermove", (event) => {
      const drag = this.drag;
      if (drag === null || event.pointerId !== drag.pointerId) {
        return;
      }
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (!drag.moved) {
        if (
          Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
          DRAG_THRESHOLD
        ) {
          return;
        }
        drag.moved = true;
        layer.style.cursor = "grabbing";
      }
      this.panBy(dx, dy);
    });
    layer.addEventListener("pointerup", (event) => {
      const drag = this.drag;
      if (drag === null || event.pointerId !== drag.pointerId) {
        return;
      }
      this.drag = null;
      // A left drag would otherwise also fire a click on the hex it ended over.
      this.suppressClick = drag.moved && drag.button === 0;
      this.releasePointer(layer, event.pointerId);
      this.updateHoverCursor();
    });
    layer.addEventListener("pointercancel", (event) => {
      const drag = this.drag;
      if (drag === null || event.pointerId !== drag.pointerId) {
        return;
      }
      this.drag = null;
      this.releasePointer(layer, event.pointerId);
      this.updateHoverCursor();
    });
    layer.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = layer.getBoundingClientRect();
        this.zoomAt(Math.exp(-event.deltaY * ZOOM_RATE), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      { passive: false },
    );
  }

  private releasePointer(layer: HTMLElement, pointerId: number): void {
    if (layer.hasPointerCapture(pointerId)) {
      layer.releasePointerCapture(pointerId);
    }
  }

  render(view: MapViewState): void {
    const nodes: Node[] = [];
    for (const [key, tile] of view.tiles) {
      nodes.push(this.hexElement(key, tile, view.fog.get(key)));
    }

    this.dangerOutline = outlineSvg(
      this.visibleHexes(view.danger, view.tiles),
      "outline-danger",
    );
    if (this.dangerOutline !== null) {
      nodes.push(this.dangerOutline);
    }

    this.enemyOutlines.clear();
    for (const [id, zone] of view.enemyDanger) {
      const outline = outlineSvg(
        this.visibleHexes(zone, view.tiles),
        "outline-enemy",
      );
      if (outline !== null) {
        this.enemyOutlines.set(id, outline);
        nodes.push(outline);
      }
    }

    for (const [key, tile] of view.tiles) {
      const badge = this.spawnBadge(key, tile, view.turn);
      if (badge !== null) {
        nodes.push(badge);
      }
    }

    this.enemyNodes.clear();
    this.enemyHex.clear();
    this.enemyById.clear();
    for (const enemy of view.enemies) {
      const node = this.enemyElement(enemy);
      this.enemyNodes.set(enemy.id, node);
      this.enemyHex.set(enemy.id, hexKey(enemy.position));
      this.enemyById.set(enemy.id, enemy);
      nodes.push(node);
    }
    this.enemyDanger = new Map(view.enemyDanger);
    this.playerNode = this.markerElement(view.player);
    nodes.push(this.playerNode);

    this.highlightGroups.clear();
    for (const group of view.highlights) {
      const outline = outlineSvg(group.reachable, "outline-reachable");
      this.highlightGroups.set(group.key, { outline, targets: group.targets });
      if (outline !== null) {
        nodes.push(outline);
      }
    }

    nodes.push(this.pathLayer);
    nodes.push(this.tooltip);

    this.activeHighlight = view.activeHighlight;
    this.applyHighlight();
    this.applyHover();
    this.updatePaths();

    setChildren(this.world, nodes);
  }

  /** Switch the visible highlight without rebuilding the map. */
  setHighlight(key: string | null): void {
    if (key === this.activeHighlight) {
      return;
    }
    this.activeHighlight = key;
    this.applyHighlight();
  }

  /** Show the paths a hovered tile would be reached by, or none. */
  setHoverPaths(paths: readonly HoverPath[]): void {
    this.hoverPaths = paths;
    this.updatePaths();
  }

  /** World pixel at the top-left of the viewport; the camera's position. */
  setCamera(topLeft: Point): void {
    this.camera = topLeft;
    this.applyTransform();
  }

  getCamera(): Point {
    return this.camera;
  }

  zoomLevel(): number {
    return this.zoom;
  }

  viewportSize(): { width: number; height: number } {
    return { width: this.layer.clientWidth, height: this.layer.clientHeight };
  }

  private applyTransform(): void {
    this.world.style.transform = `scale(${this.zoom}) translate(${-this.camera.x}px, ${-this.camera.y}px)`;
  }

  /** The world pixel under a point measured from the layer's top-left corner. */
  private screenToWorld(screen: Point): Point {
    return {
      x: screen.x / this.zoom + this.camera.x,
      y: screen.y / this.zoom + this.camera.y,
    };
  }

  /** Move the camera by a screen-space drag, so the map follows the pointer. */
  private panBy(screenDx: number, screenDy: number): void {
    this.camera = {
      x: this.camera.x - screenDx / this.zoom,
      y: this.camera.y - screenDy / this.zoom,
    };
    this.applyTransform();
  }

  /** Zoom about a screen point, keeping the world under it fixed. */
  private zoomAt(factor: number, anchor: Point): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) {
      return;
    }
    const world = this.screenToWorld(anchor);
    this.zoom = next;
    this.camera = {
      x: world.x - anchor.x / next,
      y: world.y - anchor.y / next,
    };
    this.applyTransform();
  }

  /** Move an actor's marker to a world pixel, mid-animation. */
  placeActor(mover: Mover, pixel: Point): void {
    const node = this.actorNode(mover);
    if (node !== null) {
      this.place(node, pixel);
    }
  }

  /** Lift the actor being animated above the rest of the map. */
  setMoving(mover: Mover, moving: boolean): void {
    const node = this.actorNode(mover);
    if (node !== null) {
      node.classList.toggle("moving", moving);
    }
  }

  private actorNode(mover: Mover): HTMLElement | null {
    if (mover.kind === "player") {
      return this.playerNode;
    }
    return this.enemyNodes.get(mover.id) ?? null;
  }

  /** The subset of `hexes` that is actually on screen, so nothing spills off. */
  private visibleHexes(
    hexes: ReadonlySet<string>,
    tiles: ReadonlyMap<string, Tile>,
  ): Set<string> {
    const visible = new Set<string>();
    for (const key of hexes) {
      if (tiles.has(key)) {
        visible.add(key);
      }
    }
    return visible;
  }

  private hexElement(
    key: string,
    tile: Tile,
    fog: FogLevel | undefined,
  ): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("hex", `terrain-${tile.terrain}`);
    if (fog !== undefined) {
      element.classList.add(`fog-${fog}`);
    }
    element.style.backgroundImage = `url("${TERRAIN_TEXTURE[tile.terrain]}")`;
    element.dataset["hexKey"] = key;
    this.place(element, hexToPixel(parseHexKey(key)));
    setChildren(
      element,
      iconSlotElements(tileIcons(tile.terrain, tile.cost, tile.feature)),
    );
    return element;
  }

  /** Turns until an assassin appears here, or null if none is due. */
  private spawnBadge(
    key: string,
    tile: Tile,
    turn: number,
  ): HTMLElement | null {
    // The assassin is present from the start of turn `spawnTurn`, so the badge
    // counts down to 1 and never shows 0.
    if (tile.spawnTurn < 0 || tile.spawnTurn <= turn) {
      return null;
    }
    const element = document.createElement("div");
    element.classList.add("spawn-badge");
    element.textContent = `${tile.spawnTurn - turn}`;
    const pixel = hexToPixel(parseHexKey(key));
    this.place(element, { x: pixel.x, y: pixel.y - 26 });
    return element;
  }

  private enemyElement(enemy: Enemy): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("enemy", `enemy-${enemy.kind}`);
    element.dataset["enemyId"] = enemy.id;
    this.place(element, hexToPixel(enemy.position));
    return element;
  }

  private markerElement(player: HexCoord): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("player-marker");
    this.place(element, hexToPixel(player));
    return element;
  }

  private place(element: HTMLElement, pixel: Point): void {
    element.style.transform = `translate(${pixel.x}px, ${pixel.y}px) translate(-50%, -50%)`;
  }

  private updatePaths(): void {
    const svg = pathsSvg(this.hoverPaths);
    setChildren(this.pathLayer, svg === null ? [] : [svg]);
  }

  /** The enemy standing on the hovered hex, or null. */
  private hoveredEnemyId(): string | null {
    if (this.hoveredKey === null) {
      return null;
    }
    for (const [id, hex] of this.enemyHex) {
      if (hex === this.hoveredKey) {
        return id;
      }
    }
    return null;
  }

  /**
   * React to the hovered hex: highlight the enemies that could strike it, swap
   * the union danger zone for the hovered enemy's own range, and name it.
   */
  private applyHover(): void {
    const hoveredEnemy = this.hoveredEnemyId();
    if (this.dangerOutline !== null) {
      this.dangerOutline.classList.toggle("hidden", hoveredEnemy !== null);
    }
    for (const [id, outline] of this.enemyOutlines) {
      outline.classList.toggle("hidden", id !== hoveredEnemy);
    }
    for (const [id, node] of this.enemyNodes) {
      const zone = this.enemyDanger.get(id);
      const threatens =
        zone !== undefined &&
        this.hoveredKey !== null &&
        zone.has(this.hoveredKey);
      node.classList.toggle("threat", threatens);
    }
    const enemy =
      hoveredEnemy === null ? undefined : this.enemyById.get(hoveredEnemy);
    if (enemy === undefined) {
      this.tooltip.classList.add("hidden");
      return;
    }
    const pixel = hexToPixel(enemy.position);
    this.tooltip.textContent = enemyName(enemy);
    this.place(this.tooltip, { x: pixel.x, y: pixel.y - 30 });
    this.tooltip.classList.remove("hidden");
  }

  /** Show the active highlight's outline and targets, hide the rest. */
  private applyHighlight(): void {
    const active =
      this.activeHighlight === null
        ? null
        : this.highlightGroups.get(this.activeHighlight) ?? null;
    for (const [key, group] of this.highlightGroups) {
      const shown = key === this.activeHighlight;
      if (group.outline !== null) {
        group.outline.classList.toggle("hidden", !shown);
      }
    }
    for (const [id, node] of this.enemyNodes) {
      const targeted = active !== null && active.targets.has(id);
      node.classList.toggle("target", targeted);
    }
    this.updateHoverCursor();
  }

  /**
   * The target reticle as the cursor while hovering an enemy the active
   * highlight could attack. The cursor lives on the layer, not the enemy, since
   * enemy markers pass pointer events through to the map.
   */
  private updateHoverCursor(): void {
    let targeted = false;
    if (this.activeHighlight !== null && this.hoveredKey !== null) {
      const active = this.highlightGroups.get(this.activeHighlight);
      if (active !== undefined) {
        for (const [id, hex] of this.enemyHex) {
          if (hex === this.hoveredKey && active.targets.has(id)) {
            targeted = true;
            break;
          }
        }
      }
    }
    this.layer.style.cursor = targeted ? `url("${targetUrl}") 8 8, pointer` : "";
  }
}

type HighlightNodes = {
  outline: SVGSVGElement | null;
  targets: ReadonlySet<string>;
};