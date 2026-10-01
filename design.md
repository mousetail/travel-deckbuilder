# Travel Card Game

The travel card game (Name TBD) is a roguelike similar to El Dorado.

The game takes place on a hexagonical grid. Follow a winding path and escape before respawning enemies catch up to you. To do this, you must buy, upgrade, combine, and destroy cards.

# Terrain

The game has 4 terrain types:

- Grass
- Forest
- Water
- Mountains

Cards can move over terrain of their type. There is a hexagonical grid.

There terrain types are given in order of difficulty. Cards that can cross grass is more common and typically have higher numbers than those that can cross the more difficult terrain types.

Each terrain has a cost from 1 to 4, shown as that many icons on the tile. A tile costs that many movement points to cross: entering it needs a card with at least that many movement points, and the whole move's path may not cost more than the card's distance. Two separate cards cannot combine to cross a single tile.

At the start, you can only cross grass and forest.

There's also "dirt" which can be passed by any movement card and impassible which is never passable.

# Cards

## Card Traits

Some cards carry a **trait**: a rule-bending property shown as a badge on the card face (top-right) and enforced by the game. Traits are general — any card may carry any of them, and they survive upgrades.

- **Must play first** (orange badge): while this card is in your hand, no other card may be played, and this card can never be discarded.
- **Indestructible** (green badge): this card can never be destroyed (removed from your deck) or put to sleep.

`Escalation` carries both traits.

## Escalation

`Escalation` is a starting card, not a shop card, and it is the game's difficulty
ramp:

- **Escalation** (starting): raises every enemy's movement speed by 1 this turn and
  0.2 permanently. Snipers take half the ramp, so they stay slower than assassins.
  Carries the must-play-first and indestructible traits.

It replaces the old turn-number ramp: enemies no longer get faster with the turn
number, so the only way the threat grows is the player drawing and playing
`Escalation`. Acting each turn therefore means paying the enemy-speed tax first.

For comparison, a build flag (`DIFFICULTY_SCALING` in `src/game/config.ts`) can
switch the whole game back to the turn-number ramp.

# Basic Movement Cards

Basic movement cards move some number of spaces over the given terrain. The basic movement cards are as follows:

- Grass 1 (starting x 2)
- Grass 3 (starting)
- Forest 1 (starting)
- Grass 4 (common)
- Grass 6 (uncommon)
- Grass 8 (uncommon)
- Water 1 (common)
- Water 2 (uncommon)
- Mountains 1 (uncommon)

Starting cards never appear in shops or found on the map.

## Combination Movement Cards

Allow moving over either terrain types.

- Grass 1/Forest 1 (common)
- Grass 1/Water 1 (common)
- Forest 1/Mountain 1 (uncommon)
- Grass 3/Forest 1 (uncommon)
- Forest 1/Water 1/Mountain 1 (uncommon)
- Grass 5/Forest 3 (uncommon)
- Grass 6/Water 2/Mountain 1 (rare)

Each card can only be used as one of the slash seperated options in a turn.

## Hand Management Cards

- Draw 3 cards, discard 2 (common)
- If you have 3 or more cards in your hand, discard them then draw 4 new cards (common)
- Draw 2 cards (uncommon)
- Draw 3 cards, discard 1 (rare)
- Take 1 card from your discard pile (uncommon)
- Put a card from your hand to sleep for 4 reshuffles (rare)

## Combat

X attack means you can kill an enemy within X tiles of you. 0 means you must be on the same tile as the enemy.

- 2 Grass/0 attack (common)
- 3 attack (common)
- 5 grass/3 attack (uncommon)

## Economy

- Gain 2 currency (common)
- 1 mountain/1 currency (common)

# Hand Management

At the start of your turn, you draw up to 4 cards.

When you buy a card, it gets added to your discard pile. Your discard pile is only reshuffled after your draw pile runs out.

You may freely discard any number of cards you like without playing them. Or you may choose to keep them for next turn. UI for this should be inituitive.

## Sleeping

A card can be asleep for N reshuffles. A sleeping card sits in the discard pile but is skipped by every reshuffle; each reshuffle ticks its counter down by one, and once it reaches 0 the card wakes and rejoins the draw pile. Sleeping cards are shown in the discard pile with the number of reshuffles they still have to sit out.

Various cards can cause sleeping. Some cards sleep themselves on discard as a balancing mechanic. Some cards can cause other cards to sleep.

# Combat

The map has "spawn points" which can spawn different kinds of enemies. An enemy can either spawn immediatly or on a timer. Enemy types include:

## Assasins

- Typically have relatively long spawn timers causing them to spawn behind the player
- Have realtively high movement speed
- High cost of crossing a terrain type boundary, mimicking a player who would have to play a second card.
- Assasins chase the player and kill them if they can end their turn on the players space

Assassins and snipers do not get faster with the turn number. Instead, the starting `Escalation` card raises every enemy's speed: +1 for the turn it is played and +0.2 permanently. It carries the must-play-first and indestructible traits, so it cannot be dodged by discarding, removing, or sleeping it — acting each turn means paying the ramp.

## Watch Towers

Watch towers typically spawn on map start. They have a certain radius, and can shoot the player if they end their turn within that radius. They can not move.

## Snipers

Snipers appear in higher difficulty levels, typically in numbers. They move like an assasin but have lower movement speed. They generally run away from the player, while attempting to avoid being cut off from the map edge and also respecting spacing.

Snipers aim at a certain direction (one of the 6 map hexes). At the end of the snipers turn, they aim in a direction (towards the player, ideally the longest line of sight). If the player ends their next turn in that line, they are shot and die.

# Map Generation

The map has a hexagonical grid and consists of winding sections of had coded tiles. The terrain in a labarynthine structure.

Each pre-generated terrain tile has a difficulty associated with it. The further in the game the more difficult the tiles get. More advanced upgrades and enemies like watchtowers and snipers only appear on more difficult ones.

In general, most pregenerated tiles have a grass path following the outer curve, or winding back and forth a bit for straight paths. Forest and water provide shortcuts and can surround upgrades. Mountains surround rarer upgrades and are out of the way, requring not only taking a long route but having rare mountain cards in your deck.

# Economy & Upgrades

You start with some number of currency. You can earn currency in a number of ways:
- Playing a card that gives you currency
- Passing your turn without playing any cards earns you 1 currency (anti-softlock feature)
- Killing an enemy gives you some currency
- Currency can also be found on the map as an upgrade

You generally need to end your turn on an upgrade tile to use use it. The end turn button will be replaced by a "use upgrade" button.

Some tiles allow you to upgrade your deck.
- Shops allow you to spend money to buy cards. Shops stock 4 cards, biassed by rarity and you can also spend money to reroll what the shop sells.
- Smith allows you to upgrade a card. Each card has a hardcoded "+" version.
- A space that allows removing a card from your deck (rare)
- A space that gives you a random card (uncommon and up). Player can choose to take it and leave it.

# Graphics Style

Graphics style is retro/pixel art. There are some images in src/images showing the texture of the terrain types.

The full screen is the map with the UI hovering above it. Cards look a bit like playing cards, with a symbolic representation in the top left corner. Each card has a name, an image (leave this as placeholder), and a stack of small badges in the top-right corner: one per trait, then the sleep counter and the temporary-upgrade sigil. Badge art lives in `src/images/card-icons/` as small SVGs.

Cards are shown in a "fan" pattern, slightly angled to the left and the right.

To the left of your cards is your draw pile with a number indicating how many cards are in it. To the right your discard pile. You can click your discard pile or draw pile to see exactly what cards are in them.

The top-right of the HUD shows the turn number, the current depth, and the current enemy movement speed. When a temporary effect is boosting or slowing enemies this turn, its signed value is shown in parentheses, e.g. `enemy speed 1.2 (+1)`; with nothing temporary it is omitted.

UI is mostly black and white, thick borders, no border radius. The map itself is allowed to have color.

# Fog of War and tile addition/removal

Generally, a few tiles are visible.
- The tile the player is on
- The tiles behind it, up to `SECTIONS_BEHIND` of them
- The first `FOG_DEPTH` rows of the next tile (fog of war), each row dimmed a little
  more than the one in front of it

If the player reaches the next tile, the tile is entirely revealed and the tiles more than `SECTIONS_BEHIND` behind the player are removed including any assasins. This doesn't end the players turn. The player can never go back there.

Even though the tile is removed, the game still keeps track if it's position to prevent the path from winding there and reaching that position again.

# Code Guidelines

- Avoid using `as`, `any`, or `unknown` types
- Avoid optional properties, prefer tagged unions such that each variation is type safe.
- Avoid giving functions default arguments, prefer passing them explicitly every invocation.
- Avoid using `innerHTML`. Prefer `replaceChildren` to clear an element
- Keep the game logic seperate from the UI
- Prefer `element.classList.add/remove/toggle` over `element.class=`
- No need to comment every function. Only when it truely does something you would not expect from the name and even then consider just giving it a better name.
- Keep classes and types small. Consider splitting classes if they get too complex.
- For CSS, prefer nested properties like `.x { & .y {} }` to group things together. Prefer grid over flex box. Keep the CSS simple, prefer simple backgrounds on hover rather than complex positioning effects. Use a limited amount of colors.
- Best to ask the user rather than make assumptions. If something seems too complex, you might have simply misunderstood the user.
