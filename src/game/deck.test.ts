import { describe, expect, it } from "vitest";
import type { CardSpec } from "./cards";
import { counterIds, instantiate } from "./cards";
import type { Deck } from "./deck";
import { buildDeck, drawCards, drawUpTo, shuffleAll } from "./deck";
import type { Rng } from "./rng";

function spec(name: string, traits: CardSpec["traits"] = []): CardSpec {
  return {
    name,
    image: "",
    cost: 0,
    rarity: "starting",
    traits,
    modes: [],
    onPlay: [],
    onDiscard: [],
    upgradedForm: null,
  };
}

/** A deck of `count` plain cards plus one shy card, all sitting in the discard. */
function deckWithShy(count: number): Deck {
  const ids = counterIds("t");
  const plain = Array.from({ length: count }, () =>
    instantiate(spec("Plain"), ids()),
  );
  const shy = instantiate(spec("Shy", ["shy"]), ids());
  return { draw: [], hand: [], discard: [...plain, shy] };
}

const RNG: Rng = { seed: 1 };

describe("shy trait", () => {
  it("sinks to the bottom of the draw pile when the discard is recycled", () => {
    const deck = deckWithShy(5);
    const { drawn } = drawCards(deck, 6, RNG);
    expect(drawn).toHaveLength(6);
    expect(drawn[drawn.length - 1]?.name).toBe("Shy");
  });

  it("is not drawn until every other card has been drawn", () => {
    const deck = deckWithShy(5);
    const { drawn } = drawCards(deck, 5, RNG);
    expect(drawn.map((card) => card.name)).not.toContain("Shy");
  });

  it("sinks to the bottom on a full reshuffle", () => {
    const deck = deckWithShy(5);
    const { drawn } = shuffleAll(deck, RNG);
    expect(drawn).toHaveLength(4);
    expect(drawn.map((card) => card.name)).not.toContain("Shy");
  });

  it("is left out of the opening hand when 4+ non-shy cards exist", () => {
    const ids = counterIds("t");
    const specs = [
      ...Array.from({ length: 5 }, () => spec("Plain")),
      spec("Shy", ["shy"]),
    ];
    const deck = buildDeck(specs, ids, RNG);
    const { drawn } = drawUpTo(deck, 4, RNG);
    expect(drawn).toHaveLength(4);
    expect(drawn.map((card) => card.name)).not.toContain("Shy");
  });

  it("can still be drawn when fewer than 4 non-shy cards exist", () => {
    const ids = counterIds("t");
    const specs = [
      ...Array.from({ length: 2 }, () => spec("Plain")),
      spec("Shy", ["shy"]),
    ];
    const deck = buildDeck(specs, ids, RNG);
    const { drawn } = drawUpTo(deck, 4, RNG);
    expect(drawn.map((card) => card.name)).toContain("Shy");
  });
});
