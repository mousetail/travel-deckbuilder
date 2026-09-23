export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  expected: new () => T,
): T {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`missing element: ${selector}`);
  }
  if (!(found instanceof expected)) {
    throw new Error(`element ${selector} is not a ${expected.name}`);
  }
  return found;
}

export function requireElementById<T extends Element>(
  id: string,
  expected: new () => T,
): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`missing element: #${id}`);
  }
  if (!(found instanceof expected)) {
    throw new Error(`element #${id} is not a ${expected.name}`);
  }
  return found;
}

/** Clears `parent` and appends `children`, replacing innerHTML entirely. */
export function setChildren(parent: Element, children: readonly Node[]): void {
  parent.replaceChildren(...children);
}