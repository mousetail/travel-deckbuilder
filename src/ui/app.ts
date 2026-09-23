import { setChildren } from "./dom";

export class App {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    const shell = document.createElement("div");
    shell.classList.add("app");

    const mapLayer = document.createElement("div");
    mapLayer.classList.add("map-layer");

    const hudLayer = document.createElement("div");
    hudLayer.classList.add("hud-layer");

    setChildren(shell, [mapLayer, hudLayer]);
    setChildren(this.root, [shell]);
  }
}