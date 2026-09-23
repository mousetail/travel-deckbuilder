import { hexToPixel, parseHexKey, pixelToHex } from "../game/hex";
import type { HexCoord } from "../game/hex";
import { TERRAIN_TEXTURE, featureVisual } from "../game/terrain";
import type { Tile } from "../game/terrain";
import type { FogLevel } from "../game/fog";
import { setChildren } from "./dom";

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

  render(
    tiles: ReadonlyMap<string, Tile>,
    fog: ReadonlyMap<string, FogLevel>,
    player: HexCoord,
    reachable: ReadonlySet<string>,
  ): void {
    // Camera: centre on the player. With only three sections live at once the
    // visible window always fits around them.
    const playerPixel = hexToPixel(player);
    this.camera = {
      x: playerPixel.x - this.layer.clientWidth / 2,
      y: playerPixel.y - this.layer.clientHeight / 2,
    };

    const nodes: Node[] = [];
    for (const [key, tile] of tiles) {
      nodes.push(this.hexElement(key, tile, reachable.has(key), fog.get(key)));
    }
    nodes.push(this.markerElement(player));
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