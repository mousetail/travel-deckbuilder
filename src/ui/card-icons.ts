import coinUrl from "../images/card-icons/coin.svg";
import searchUrl from "../images/card-icons/search.svg";
import scoutUrl from "../images/card-icons/scout.svg";
import upgradeUrl from "../images/card-icons/upgrade.svg";
import temporaryUrl from "../images/card-icons/temporary.svg";
import teleportUrl from "../images/card-icons/teleport.svg";
import playsFirstUrl from "../images/card-icons/plays-first.svg";
import indestructibleUrl from "../images/card-icons/indestructible.svg";

/** Play-cost coin, shown on Millionaire's play line. */
export const COIN_ICON = coinUrl;
/** Foresight's draw-pile search mode. */
export const SEARCH_ICON = searchUrl;
/** Scout's trivial-terrain mode. */
export const SCOUT_ICON = scoutUrl;
/** Upgrader's upgrade-hand mode. */
export const UPGRADE_ICON = upgradeUrl;
/** The sigil marking a temporary upgrade. */
export const TEMPORARY_ICON = temporaryUrl;
/** Hookshot's teleport mode. */
export const TELEPORT_ICON = teleportUrl;
/** The badge for a card that must be played before any other. */
export const PLAYS_FIRST_ICON = playsFirstUrl;
/** The badge for a card that cannot be destroyed or put to sleep. */
export const INDESTRUCTIBLE_ICON = indestructibleUrl;

/** The coin icon as an inline element, for writing an amount of currency. */
export function coinIcon(): HTMLImageElement {
  const icon = document.createElement("img");
  icon.classList.add("card-symbol-icon");
  icon.src = COIN_ICON;
  icon.alt = "";
  return icon;
}
