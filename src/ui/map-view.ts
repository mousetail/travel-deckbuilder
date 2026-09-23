import { AXIAL_DIRECTIONS, HEX_SIZE, addHex, hexKey, hexToPixel, parseHexKey, pixelToHex } from "../game/hex";
import type { HexCoord } from "../game/hex";
import { TERRAIN_TEXTURE, featureVisual } from "../game/terrain";
import type { Tile } from "../game/terrain";
import type { Enemy } from "../game/enemies";
import type { FogLevel } from "../game/fog";
import { setChildren } from "./dom";

export type MapViewState = {
  tiles: ReadonlyMap<string, Tile>;
  fog: ReadonlyMap<string, FogLevel>;
  player: HexCoord;
  reachable: ReadonlySet<string>;
  enemies: readonly Enemy[];
  /** Enemy ids the player may click right now (during a pending attack). */
  targets: ReadonlySet<string>;
  /** Hexes an enemy could strike at the end of this turn. */
  danger: ReadonlySet<string>;
  turn: number;
};

const SQRT3 = Math.sqrt(3);

/** Midpoint of each hex side, relative to the hex centre. */
const SIDE_MIDPOINT: readonly { x: number; y: number }[] = [
  { x: (SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
  { x: (SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (3 / 4) * HEX_SIZE },
  { x: (-SQRT3 / 2) * HEX_SIZE, y: 0 },
  { x: (-SQRT3 / 4) * HEX_SIZE, y: (-3 / 4) * HEX_SIZE },
];

export class MapView {
  private readonly layer: HTMLElement;
  private readonly onHexClick: (coord: HexCoord) => void;
  private readonly onCancel: () => void;
  private camera: { x: number; y: number } = { x: 0, y: 0 };

  constructor(
    layer: HTMLElement,
    onHexClick: (coord: HexCoord) => void,
    onCancel: () => void,
  ) {
    this.layer = layer;
    this.onHexClick = onHexClick;
    this.onCancel = onCancel;

    layer.addEventListener("click", (event) => {
      const rect = layer.getBoundingClientRect();
      this.onHexClick(pixelToHex({
        x: event.clientX - rect.left + this.camera.x,
        y: event.clientY - rect.top + this.camera.y,
      }));
    });
    layer.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onCancel();
    });
  }

  render(view: MapViewState): void {
    // Camera: centre on the player. With only three sections live at once the
    // visible window always fits around them.
    const playerPixel = hexToPixel(view.player);
    this.camera = {
      x: playerPixel.x - this.layer.clientWidth / 2,
      y: playerPixel.y - this.layer.clientHeight / 2,
    };

    const nodes: Node[] = [];
    for (const [key, tile] of view.tiles) {
      nodes.push(this.hexElement(key, tile, view.reachable.has(key), view.fog.get(key)));
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
    for (const enemy of view.enemies) {
      nodes.push(this.enemyElement(enemy, view.targets.has(enemy.id)));
    }
    nodes.push(this.markerElement(view.player));
    setChildren(this.layer, nodes);
  }

  private hexElement(
    key: string,
    tile: Tile,
    reachable: boolean,
    fog: FogLevel | undefined,
  ): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("hex", `terrain-${tile.terrain}`);
    if (reachable) {
      element.classList.add("reachable");
    }
    if (fog !== undefined) {
      element.classList.add(`fog-${fog}`);
    }
    element.style.backgroundImage = `url(${TERRAIN_TEXTURE[tile.terrain]})`;
    element.dataset["hexKey"] = key;
    this.place(element, hexToPixel(parseHexKey(key)));

    const visual = featureVisual(tile.feature);
    switch (visual.kind) {
      case "none":
        break;
      case "image": {
        const icon = document.createElement("div");
        icon.classList.add("hex-feature");
        icon.style.backgroundImage = `url(${visual.url})`;
        setChildren(element, [icon]);
        break;
      }
      case "coin": {
        const coin = document.createElement("div");
        coin.classList.add("hex-feature-coin");
        setChildren(element, [coin]);
        break;
      }
    }
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
      for (let direction = 0; direction < AXIAL_DIRECTIONS.length; direction += 1) {
        const neighbour = addHex(coord, AXIAL_DIRECTIONS[direction]);
        if (view.danger.has(hexKey(neighbour))) {
          continue;
        }
        nodes.push(this.dangerEdgeElement(pixel, (1 - direction + 6) % 6));
      }
    }
    return nodes;
  }

  private dangerEdgeElement(center: { x: number; y: number }, side: number): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("danger-edge");
    const mid = SIDE_MIDPOINT[side];
    const angle = 30 + 60 * side;
    element.style.transform =
      `translate(${center.x - this.camera.x + mid.x}px, ${center.y - this.camera.y + mid.y}px) ` +
      `translate(-50%, -50%) rotate(${angle}deg)`;
    return element;
  }

  /** Turns until an assassin spawns here, or null if none is due. */
  private spawnBadge(key: string, tile: Tile, turn: number): HTMLElement | null {
    if (tile.spawnTurn < 0 || tile.spawnTurn < turn) {
      return null;
    }
    const element = document.createElement("div");
    element.classList.add("spawn-badge");
    element.textContent = `${tile.spawnTurn - turn}`;
    const pixel = hexToPixel(parseHexKey(key));
    this.place(element, { x: pixel.x, y: pixel.y - 26 });
    return element;
  }

  private enemyElement(enemy: Enemy, target: boolean): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("enemy", `enemy-${enemy.kind}`);
    if (target) {
      element.classList.add("target");
    }
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

  private place(element: HTMLElement, pixel: { x: number; y: number }): void {
    element.style.transform =
      `translate(${pixel.x - this.camera.x}px, ${pixel.y - this.camera.y}px) translate(-50%, -50%)`;
  }
}
