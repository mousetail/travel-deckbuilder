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
import type { Enemy } from "../game/enemies";
import type { FogLevel } from "../game/fog";
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
  turn: number;
  /** Every possible highlight, pre-computed so hover can just show/hide. */
  highlights: readonly HighlightGroup[];
  /** Which highlight is visible right now, or null for none. */
  activeHighlight: string | null;
};

export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);
const SVG_NS = "http://www.w3.org/2000/svg";

/** Midpoint of each hex side, relative to the hex centre. */
const SIDE_MIDPOINT: readonly { x: number; y: number }[] = [
  { x: (SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
  { x: (SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
];

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

/**
 * The outline of a reachable region: for every reachable hex, the sides whose
 * neighbour is not reachable, as world-pixel segments. Side `s` of a hex runs
 * from corner `s` to corner `s + 1`, matching the danger-zone edges.
 */
export function reachableSegments(
  reachable: ReadonlySet<string>,
): readonly { a: Point; b: Point }[] {
  const segments: { a: Point; b: Point }[] = [];
  for (const key of reachable) {
    const coord = parseHexKey(key);
    const corners = hexCorners(hexToPixel(coord));
    for (
      let direction = 0;
      direction < AXIAL_DIRECTIONS.length;
      direction += 1
    ) {
      const neighbour = addHex(coord, AXIAL_DIRECTIONS[direction]);
      if (reachable.has(hexKey(neighbour))) {
        continue;
      }
      const side = (1 - direction + 6) % 6;
      segments.push({ a: corners[side], b: corners[(side + 1) % 6] });
    }
  }
  return segments;
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
  private readonly onHexClick: (coord: HexCoord) => void;
  private readonly onHexHover: (coord: HexCoord | null) => void;
  private readonly onCancel: () => void;
  private camera: Point = { x: 0, y: 0 };
  private hoveredKey: string | null = null;
  private playerNode: HTMLElement | null = null;
  private readonly enemyNodes = new Map<string, HTMLElement>();
  private readonly enemyHex = new Map<string, string>();
  private readonly highlightGroups = new Map<string, HighlightNodes>();
  private activeHighlight: string | null = null;

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
    setChildren(layer, [this.world]);

    layer.addEventListener("click", (event) => {
      const rect = layer.getBoundingClientRect();
      this.onHexClick(
        pixelToHex({
          x: event.clientX - rect.left + this.camera.x,
          y: event.clientY - rect.top + this.camera.y,
        }),
      );
    });
    layer.addEventListener("mousemove", (event) => {
      const rect = layer.getBoundingClientRect();
      const coord = pixelToHex({
        x: event.clientX - rect.left + this.camera.x,
        y: event.clientY - rect.top + this.camera.y,
      });
      const key = hexKey(coord);
      if (key !== this.hoveredKey) {
        this.hoveredKey = key;
        this.onHexHover(coord);
        this.updateHoverCursor();
      }
    });
    layer.addEventListener("mouseleave", () => {
      if (this.hoveredKey !== null) {
        this.hoveredKey = null;
        this.onHexHover(null);
        this.updateHoverCursor();
      }
    });
    layer.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onCancel();
    });
  }

  render(view: MapViewState): void {
    const nodes: Node[] = [];
    for (const [key, tile] of view.tiles) {
      nodes.push(this.hexElement(key, tile, view.fog.get(key)));
    }
    for (const edge of this.dangerEdges(view)) {
      nodes.push(edge);
    }
    for (const [key, tile] of view.tiles) {
      const badge = this.spawnBadge(key, tile, view.turn);
      if (badge !== null) {
        nodes.push(badge);
      }
    }

    this.enemyNodes.clear();
    this.enemyHex.clear();
    for (const enemy of view.enemies) {
      const node = this.enemyElement(enemy);
      this.enemyNodes.set(enemy.id, node);
      this.enemyHex.set(enemy.id, hexKey(enemy.position));
      nodes.push(node);
    }
    this.playerNode = this.markerElement(view.player);
    nodes.push(this.playerNode);

    this.highlightGroups.clear();
    for (const group of view.highlights) {
      const outline = this.reachableOutline(group.reachable);
      this.highlightGroups.set(group.key, { outline, targets: group.targets });
      if (outline !== null) {
        nodes.push(outline);
      }
    }
    this.activeHighlight = view.activeHighlight;
    this.applyHighlight();

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

  /** World pixel at the top-left of the viewport; the camera's position. */
  setCamera(topLeft: Point): void {
    this.camera = topLeft;
    this.world.style.transform = `translate(${-topLeft.x}px, ${-topLeft.y}px)`;
  }

  viewportSize(): { width: number; height: number } {
    return { width: this.layer.clientWidth, height: this.layer.clientHeight };
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

  /**
   * The outline of the danger zone: for every dangerous hex, draw only the sides
   * whose neighbour is safe, so the whole zone gets one continuous red border.
   */
  private dangerEdges(view: MapViewState): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const key of view.danger) {
      if (!view.tiles.has(key)) {
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
        if (view.danger.has(hexKey(neighbour))) {
          continue;
        }
        nodes.push(this.dangerEdgeElement(pixel, (1 - direction + 6) % 6));
      }
    }
    return nodes;
  }

  private dangerEdgeElement(center: Point, side: number): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("danger-edge");
    const mid = SIDE_MIDPOINT[side];
    const angle = 30 + 60 * side;
    element.style.transform =
      `translate(${center.x + mid.x}px, ${center.y + mid.y}px) ` +
      `translate(-50%, -50%) rotate(${angle}deg)`;
    return element;
  }

  /**
   * The reachable region as one SVG: for every reachable hex, the sides whose
   * neighbour is not reachable, so the whole region gets one continuous green
   * outline. The SVG is positioned at the region's top-left corner in world
   * pixels, so it moves with the camera like every other map node.
   */
  private reachableOutline(reachable: ReadonlySet<string>): SVGSVGElement | null {
    if (reachable.size === 0) {
      return null;
    }
    const segments = reachableSegments(reachable);
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
    // The stroke is centred on each side, so it spills a couple of pixels past
    // the corners; pad the viewBox so the outer edge is not clipped.
    const PAD = 2;
    minX -= PAD;
    minY -= PAD;
    maxX += PAD;
    maxY += PAD;
    const width = maxX - minX;
    const height = maxY - minY;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("reachable-outline");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", `${width}`);
    svg.setAttribute("height", `${height}`);
    svg.style.transform = `translate(${minX}px, ${minY}px)`;

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