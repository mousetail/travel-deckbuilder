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

At the start, you can only cross grass and forest.

There's also "dirt" which can be passed by any movement card and impassible which is never passable.

# Cards

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

# Combat

Each map tile has a timer. If the map tile is still present after a certain number of turns, an assasin will spawn on the tile. When the player ends their turn, any assasins will move and if they can reach the player the player dies and the game is over.

Assasins have to consider terrain when moving and can also move faster over easier terrain. If an assasin can not reach the player they will pathfind towards the leading edge of the map, potentially cutting the player off.

Further in the game, multiple assasins will spawn at the same time. They also get faster.

In addition, there are snipers. They spawn in fixed positions on the map. Only appearing later in the game. If the player ends their turn within a certain radius of the sniper, they die.

Both assasins and snipers can be killed with a combat card. Or if they disappear off the trailing edge of the screen.

# Map Generation

The map has a hexagonical grid and consists of winding sections of had coded tiles. The terrain in a labarynthine structure.

Each pre-generated terrain tile has a difficulty associated with it. The further in the game the more difficult the tiles get. More advanced upgrades and obstacles like snipers only appear on more difficult ones.

Each pregenerated tile has a side length of 4 hexagons.

There are special pregenerated tiles which are 2x the size.

In general, most pregenerated tiles have a grass path following the outer curve, or winding back and forth a bit for straight paths. Forest and water provide shortcuts and can surround upgrades. Mountains surround rarer upgrades and are out of the way, requring not only taking a long route but having rare mountain cards in your deck.

# Economy & Upgrades

You start with some number of currency. You can earn currency in a number of ways:
- Playing a card that gives you currency
- Passing your turn without playing any cards earns you 1 currency (anti-softlock feature)
- Killing an enemy gives you some currency
- Currency can also be found on the map as an upgrade

You generally need to end your turn on an upgrade tile to use use it. The end turn button will be replaced by a "use upgrade" button.

Some tiles allow you to upgrade your deck.
- Shops allow you to spend money to buy cards. Shops stock 3 cards, biassed by rarity and you can also spend money to reroll what the shop sells.
- Smith allows you to upgrade a card, generally adding +1 to movement. The range of combat cards can not be upgraded.
- A space that allows removing a card from your deck (rare)
- A space that gives you a random card (uncommon and up). Player can choose to take it and leave it.

# Graphics Style

Graphics style is retro/pixel art. There are some images in src/images showing the texture of the terrain types.

The full screen is the map with the UI hovering above it. Cards look a bit like playing cards, with a symbolic representation in the top left corner. Each card has a name, an image (leave this as placeholder)

Cards are shown in a "fan" pattern, slightly angled to the left and the right.

To the left of your cards is your draw pile with a number indicating how many cards are in it. To the right your discard pile. You can click your discard pile or draw pile to see exactly what cards are in it.

UI is mostly black and white, thick borders, no border radius. The map itself is allowed to have color.

# Fog of War and tile addition/removal

Generally, 3 tiles are visible.
- The tile the player is on
- The previous tile
- The first 2 rows of the next tile (fog of war)

If the player reaches the next tile, the tile is entirely revealed and the tile now two behind the player is removed including any assasins. This doesn't end the players turn. The player can never go back there.

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
