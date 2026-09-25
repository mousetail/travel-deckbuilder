import type { TileIcon } from "../game/terrain";

/**
 * The icon elements of a tile, one per slot. A hex has four slots in a 2×2
 * grid, so at most four icons fit without overlapping; any extra are dropped.
 */
export function iconSlotElements(icons: readonly TileIcon[]): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (let i = 0; i < icons.length && i < 4; i += 1) {
    const icon = icons[i];
    const slot = document.createElement("div");
    slot.classList.add("hex-icon", `hex-icon-slot-${i}`);
    if (icon.kind === "coin") {
      slot.classList.add("hex-icon-coin");
    } else if (icon.kind === "random") {
      slot.classList.add("hex-icon-random", `hex-icon-random-${icon.tier}`);
      slot.textContent = "?";
    } else {
      slot.style.backgroundImage = `url("${icon.url}")`;
    }
    nodes.push(slot);
  }
  return nodes;
}
