import { setChildren } from "./dom";
import { loadSharePreference, saveSharePreference } from "./share-store";

export function renderMenu(
  root: HTMLElement,
  onPlay: () => void,
  onEdit: () => void,
  onStats: () => void,
): void {
  const title = document.createElement("h1");
  title.classList.add("menu-title");
  title.textContent = "Travel Card Game";

  const buttons = document.createElement("div");
  buttons.classList.add("menu-buttons");
  setChildren(buttons, [
    menuButton("Play", onPlay),
    menuButton("Statistics", onStats),
    menuButton("Section editor", onEdit),
  ]);

  const shell = document.createElement("div");
  shell.classList.add("menu");
  setChildren(shell, [title, buttons, shareCheckbox()]);
  setChildren(root, [shell]);
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.classList.add("menu-button");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** The opt-in box for sharing run data; checked by default. */
function shareCheckbox(): HTMLLabelElement {
  const label = document.createElement("label");
  label.classList.add("menu-share");

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = loadSharePreference();
  input.addEventListener("change", () => saveSharePreference(input.checked));

  const text = document.createElement("span");
  text.textContent = "Share some data about your run with the developers";

  label.append(input, text);
  return label;
}
