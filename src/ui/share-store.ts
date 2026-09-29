const STORAGE_KEY = "travel-card-game.share.v1";

/**
 * Whether the player opted in to sharing run data. Defaults to on, so the box
 * starts checked and only an explicit opt-out turns it off.
 */
export function loadSharePreference(): boolean {
  return readStorage() !== "off";
}

export function saveSharePreference(share: boolean): void {
  writeStorage(share ? "on" : "off");
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the default (on) stands.
  }
}
