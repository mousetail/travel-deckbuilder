import { setChildren } from "./dom";

export function renderMenu(
  root: HTMLElement,
  onPlay: () => void,
  onEdit: () => void,
): void {
  const title = document.createElement("h1");
  title.classList.add("menu-title");
  title.textContent = "Travel Card Game";

  const buttons = document.createElement("div");
  buttons.classList.add("menu-buttons");
  setChildren(buttons, [
    menuButton("Play", onPlay),
    menuButton("Section editor", onEdit),
  ]);

  const shell = document.createElement("div");
  shell.classList.add("menu");
  setChildren(shell, [title, buttons]);
  setChildren(root, [shell]);
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.classList.add("menu-button");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
