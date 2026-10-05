import {
  AXIAL_DIRECTIONS,
  HEX_SIZE,
  addHex,
  equalsHex,
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
import { FOG_DEPTH } from "../game/fog";
import type { FogEdge } from "../game/fog";
import type { HoverPath } from "../game/reach";
import type { Mover } from "../game/transition";
import type { WallEdge } from "../game/walls";
import arrowUrl from "../images/arrow.svg";
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
  /** Fog hexes, keyed by hex, valued by their depth from the entry edge. */
  fog: ReadonlyMap<string, number>;
  /** Direction arrows drawn just past the fog sliver, or null if none. */
  fogEdge: FogEdge | null;
  player: HexCoord;
  enemies: readonly Enemy[];
  /** Hexes an enemy could strike at the end of this turn. */
  danger: ReadonlySet<string>;
  /** Every hex each enemy could strike, keyed by enemy id. */
  enemyDanger: ReadonlyMap<string, ReadonlySet<string>>;
  turn: number;
  /** True while Scout's effect makes every tile cost 1; dims terrain icons. */
  trivialTerrain: boolean;
  /** Every possible highlight, pre-computed so hover can just show/hide. */
  highlights: readonly HighlightGroup[];
  /** Which highlight is visible right now, or null for none. */
  activeHighlight: string | null;
  /** Enemies that clicking would kill right now, so the cursor shows a reticle. */
  killable: ReadonlySet<string>;
  /** Directed hex edges blocked by a wall. */
  walls: readonly WallEdge[];
  /** Candidate walls offered by the Wall card, one per side; empty otherwise. */
  wallChoices: readonly (readonly WallEdge[])[];
  /** The mimic's tile, or null while none is placed. */
  mimic: HexCoord | null;
};

export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);
const SVG_NS = "http://www.w3.org/2000/svg";
/** The stroke is centred on each side, so it spills past the corners. */
const OUTLINE_PAD = 2;
/** How far inside the border the danger zone's inner line is drawn. */
const INNER_INSET = 5;
/** How far the pointer must travel before a press counts as a drag, in pixels. */
const DRAG_THRESHOLD = 4;
/** Zoom bounds and how fast the wheel changes it. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_RATE = 0.0015;

/**
 * How opaque a fog hex is, by its depth from the entry edge: the nearest row is
 * brightest, the furthest dimmest. The ramp follows `FOG_DEPTH`, so raising the
 * fog depth adds a gradation rather than needing new styles.
 */
function fogOpacity(depth: number): number {
  return (FOG_DEPTH - depth) / (FOG_DEPTH + 1);
}

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

/** A hex edge on the border of a region, with the normal pointing into it. */
type BoundaryEdge = { a: Point; b: Point; inward: Point };

/**
 * The border of a set of hexes: for every hex, the sides whose neighbour is not
 * in the set, as world-pixel edges. Side `s` of a hex runs from corner `s` to
 * corner `s + 1`, so the whole region gets one continuous border.
 */
function boundaryEdges(hexes: ReadonlySet<string>): BoundaryEdge[] {
  const edges: BoundaryEdge[] = [];
  for (const key of hexes) {
    const coord = parseHexKey(key);
    const centre = hexToPixel(coord);
    const corners = hexCorners(centre);
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
      const a = corners[side];
      const b = corners[(side + 1) % 6];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const length = Math.hypot(centre.x - mid.x, centre.y - mid.y);
      edges.push({
        a,
        b,
        inward: {
          x: (centre.x - mid.x) / length,
          y: (centre.y - mid.y) / length,
        },
      });
    }
  }
  return edges;
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

type Line = { point: Point; direction: Point };
type VertexEdges = { at: Point; indices: number[] };

/** Identity of a hex corner by position, so corners shared by hexes collapse. */
function vertexKey(point: Point): string {
  return `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
}

function offsetLine(edge: BoundaryEdge, inset: number): Line {
  return {
    point: {
      x: edge.a.x + inset * edge.inward.x,
      y: edge.a.y + inset * edge.inward.y,
    },
    direction: { x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y },
  };
}

function intersectLines(first: Line, second: Line): Point | null {
  const denominator =
    first.direction.x * second.direction.y -
    first.direction.y * second.direction.x;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const t =
    ((second.point.x - first.point.x) * second.direction.y -
      (second.point.y - first.point.y) * second.direction.x) /
    denominator;
  return {
    x: first.point.x + t * first.direction.x,
    y: first.point.y + t * first.direction.y,
  };
}

/** The inset corner at `vertex`, where its two edges' inset lines cross. */
function cornerPoint(
  vertex: VertexEdges,
  edges: readonly BoundaryEdge[],
  inset: number,
): Point {
  if (vertex.indices.length !== 2) {
    return vertex.at;
  }
  const first = edges[vertex.indices[0]];
  const second = edges[vertex.indices[1]];
  const meet = intersectLines(
    offsetLine(first, inset),
    offsetLine(second, inset),
  );
  if (meet !== null) {
    return meet;
  }
  // Collinear edges share one inset line, so either edge gives the point.
  return {
    x: vertex.at.x + inset * first.inward.x,
    y: vertex.at.y + inset * first.inward.y,
  };
}

/** The other edge sharing `vertex` with `current`, or null at a dead end. */
function nextEdge(
  vertex: VertexEdges | undefined,
  current: number,
): number | null {
  if (vertex === undefined || vertex.indices.length !== 2) {
    return null;
  }
  const first = vertex.indices[0];
  const second = vertex.indices[1];
  return first === current ? second : first;
}

/**
 * The inset border of a region, one closed polyline per border loop. Each edge
 * is pushed towards its hex's centre by `inset`, and neighbouring edges are
 * joined where their inset lines cross, so the line stays connected through
 * convex and concave corners alike instead of leaving gaps or spikes.
 */
function insetOutlineLoops(
  edges: readonly BoundaryEdge[],
  inset: number,
): Point[][] {
  const vertices = new Map<string, VertexEdges>();
  edges.forEach((edge, index) => {
    for (const at of [edge.a, edge.b]) {
      const key = vertexKey(at);
      const vertex = vertices.get(key);
      if (vertex === undefined) {
        vertices.set(key, { at, indices: [index] });
      } else {
        vertex.indices.push(index);
      }
    }
  });

  const corners = new Map<string, Point>();
  for (const [key, vertex] of vertices) {
    corners.set(key, cornerPoint(vertex, edges, inset));
  }

  const loops: Point[][] = [];
  const visited = new Set<number>();
  for (let start = 0; start < edges.length; start += 1) {
    if (visited.has(start)) {
      continue;
    }
    const loop: Point[] = [];
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      const corner = corners.get(vertexKey(edges[current].a));
      if (corner !== undefined) {
        loop.push(corner);
      }
      const next = nextEdge(vertices.get(vertexKey(edges[current].b)), current);
      if (next === null) {
        break;
      }
      current = next;
    }
    if (loop.length >= 2) {
      loop.push(loop[0]);
      loops.push(loop);
    }
  }
  return loops;
}

/** The outline of `hexes` as one SVG, or null when there is nothing to draw. */
/** The world-pixel segment of a directed wall edge, or null if not adjacent. */
function wallSegment(edge: WallEdge): { a: Point; b: Point } | null {
  const direction = AXIAL_DIRECTIONS.findIndex((dir) =>
    equalsHex(addHex(edge.from, dir), edge.to),
  );
  if (direction === -1) {
    return null;
  }
  const corners = hexCorners(hexToPixel(edge.from));
  const side = (1 - direction + 6) % 6;
  const a = corners[side];
  const b = corners[(side + 1) % 6];
  if (a === undefined || b === undefined) {
    return null;
  }
  return { a, b };
}

/** Every wall drawn as a thick line on the hex edge it blocks. */
function wallsSvg(
  walls: readonly WallEdge[],
  className: string,
): SVGSVGElement | null {
  const segments: { a: Point; b: Point }[] = [];
  for (const edge of walls) {
    const segment = wallSegment(edge);
    if (segment !== null) {
      segments.push(segment);
    }
  }
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
  const svg = positionedSvg(minX, minY, maxX - minX, maxY - minY, [
    "map-outline",
    className,
  ]);
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

/** The candidate walls of a Wall play, drawn as faint dashed previews. */
function wallChoicesSvg(
  choices: readonly (readonly WallEdge[])[],
  tiles: ReadonlyMap<string, Tile>,
): SVGSVGElement | null {
  const visible = choices.flatMap((choice) =>
    choice.filter(
      (edge) => tiles.has(hexKey(edge.from)) && tiles.has(hexKey(edge.to)),
    ),
  );
  return wallsSvg(visible, "outline-wall-choice");
}

function outlineSvg(
  hexes: ReadonlySet<string>,
  className: string,
  inset: number | null,
): SVGSVGElement | null {
  const edges = boundaryEdges(hexes);
  if (edges.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const edge of edges) {
    minX = Math.min(minX, edge.a.x, edge.b.x);
    maxX = Math.max(maxX, edge.a.x, edge.b.x);
    minY = Math.min(minY, edge.a.y, edge.b.y);
    maxY = Math.max(maxY, edge.a.y, edge.b.y);
  }
  minX -= OUTLINE_PAD;
  minY -= OUTLINE_PAD;
  maxX += OUTLINE_PAD;
  maxY += OUTLINE_PAD;

  const svg = positionedSvg(minX, minY, maxX - minX, maxY - minY, [
    "map-outline",
    className,
  ]);
  for (const edge of edges) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", `${edge.a.x - minX}`);
    line.setAttribute("y1", `${edge.a.y - minY}`);
    line.setAttribute("x2", `${edge.b.x - minX}`);
    line.setAttribute("y2", `${edge.b.y - minY}`);
    svg.append(line);
  }
  if (inset !== null) {
    for (const loop of insetOutlineLoops(edges, inset)) {
      const polyline = document.createElementNS(SVG_NS, "polyline");
      polyline.classList.add("outline-inner");
      polyline.setAttribute(
        "points",
        loop.map((point) => `${point.x - minX},${point.y - minY}`).join(" "),
      );
      svg.append(polyline);
    }
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
  /** Screen pixels of the bottom edge covered by the HUD's card band. */
  private bottomInset = 0;
  private drag: DragState | null = null;
  /** Set when a drag ends, so the click it would otherwise fire is ignored. */
  private suppressClick = false;
  private hoveredKey: string | null = null;
  private playerNode: HTMLElement | null = null;
  private readonly enemyNodes = new Map<string, HTMLElement>();
  private readonly enemyHex = new Map<string, string>();
  private readonly enemyById = new Map<string, Enemy>();
  private enemyDanger = new Map<string, ReadonlySet<string>>();
  private killable: ReadonlySet<string> = new Set();
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
      nodes.push(
        this.hexElement(key, tile, view.fog.get(key), view.trivialTerrain),
      );
    }

    if (view.fogEdge !== null) {
      nodes.push(...this.fogArrows(view.fogEdge));
    }

    const visibleWalls = view.walls.filter(
      (edge) =>
        view.tiles.has(hexKey(edge.from)) && view.tiles.has(hexKey(edge.to)),
    );
    const walls = wallsSvg(visibleWalls, "outline-wall");
    if (walls !== null) {
      nodes.push(walls);
    }

    const wallChoices = wallChoicesSvg(view.wallChoices, view.tiles);
    if (wallChoices !== null) {
      nodes.push(wallChoices);
    }

    this.dangerOutline = outlineSvg(
      this.visibleHexes(view.danger, view.tiles),
      "outline-danger",
      INNER_INSET,
    );
    if (this.dangerOutline !== null) {
      nodes.push(this.dangerOutline);
    }

    this.enemyOutlines.clear();
    for (const [id, zone] of view.enemyDanger) {
      const outline = outlineSvg(
        this.visibleHexes(zone, view.tiles),
        "outline-enemy",
        INNER_INSET,
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
    this.killable = view.killable;
    if (view.mimic !== null && view.tiles.has(hexKey(view.mimic))) {
      nodes.push(this.mimicElement(view.mimic));
    }
    this.playerNode = this.markerElement(view.player);
    nodes.push(this.playerNode);

    this.highlightGroups.clear();
    for (const group of view.highlights) {
      const outline = outlineSvg(group.reachable, "outline-reachable", null);
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

  /** How much of the bottom edge the card band covers, in screen pixels. */
  setBottomInset(pixels: number): void {
    this.bottomInset = pixels;
  }

  bottomInsetPixels(): number {
    return this.bottomInset;
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
    fog: number | undefined,
    trivialTerrain: boolean,
  ): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("hex", `terrain-${tile.terrain}`);
    if (fog !== undefined) {
      element.classList.add("fog");
      element.style.setProperty("--fog-opacity", `${fogOpacity(fog)}`);
    }
    if (trivialTerrain) {
      element.classList.add("trivial-terrain");
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

  /**
   * The direction arrows past the fog: one per hex of the far edge, tiled edge
   * to edge so they read as a single line, each pointing the way the player
   * travels. They sit on the row beyond the fog, so they cover no drawn hex.
   */
  private fogArrows(edge: FogEdge): HTMLElement[] {
    const width = SQRT3 * HEX_SIZE;
    const angle = this.fogArrowAngle(edge);
    return edge.hexes.map((coord) => {
      const element = document.createElement("img");
      element.classList.add("fog-arrow");
      element.src = arrowUrl;
      element.alt = "";
      element.style.width = `${width}px`;
      element.style.height = `${width}px`;
      const pixel = hexToPixel(coord);
      element.style.transform = `translate(${pixel.x}px, ${pixel.y}px) translate(-50%, -50%) rotate(${angle}deg)`;
      return element;
    });
  }

  /**
   * The rotation that makes the arrows point
   */
  private fogArrowAngle(edge: FogEdge): number {
    return edge.direction * 60 - 120;
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

  private mimicElement(mimic: HexCoord): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("mimic-marker");
    this.place(element, hexToPixel(mimic));
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
        : (this.highlightGroups.get(this.activeHighlight) ?? null);
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
   * The target reticle as the cursor while hovering an enemy that clicking would
   * kill. The cursor lives on the layer, not the enemy, since enemy markers pass
   * pointer events through to the map.
   */
  private updateHoverCursor(): void {
    const hoveredEnemy = this.hoveredEnemyId();
    const targeted = hoveredEnemy !== null && this.killable.has(hoveredEnemy);
    this.layer.style.cursor = targeted
      ? `url("${targetUrl}") 8 8, pointer`
      : "";
  }
}

type HighlightNodes = {
  outline: SVGSVGElement | null;
  targets: ReadonlySet<string>;
};
