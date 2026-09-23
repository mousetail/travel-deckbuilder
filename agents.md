- Avoid using `as`, `any`, or `unknown` types
- Avoid optional properties, prefer tagged unions such that each variation is type safe.
- Avoid giving functions default arguments, prefer passing them explicitly every invocation.
- Avoid using `innerHTML`. Prefer `replaceChildren` to clear an element
- Keep the game logic seperate from the UI
- Prefer `element.classList.add/remove/toggle` over `element.class=`
- No need to comment every function/variable/type. Only when it truely does something you would not expect from the name and even then consider just giving it a better name.
- Keep classes and types small. Consider splitting classes if they get too complex.
- For CSS, prefer nested properties like `.x { & .y {} }` to group things together. Prefer grid over flex box. Keep the CSS simple, prefer simple backgrounds on hover rather than complex positioning effects. Use a limited amount of colors.
- Best to ask the user rather than make assumptions. If something seems too complex, you might have simply misunderstood the user.

`node` is is old. Use `PATH=/home/mousetail/.nvm/versions/node/v26.8.2/bin:/usr/bin:/bin node` or `PATH=/home/mousetail/.nvm/versions/node/v26.8.2/bin:/usr/bin:/bin npm` for node or npm commands, including vite, tsc etc.

You can also cross refrence with ./design.md when you are unsure how a feature is supposed to fit in to the larger system.
