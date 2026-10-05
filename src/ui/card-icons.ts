import coinUrl from "../images/card-icons/coin.svg";
import searchUrl from "../images/card-icons/search.svg";
import scoutUrl from "../images/card-icons/scout.svg";
import upgradeUrl from "../images/card-icons/upgrade.svg";
import temporaryUrl from "../images/card-icons/temporary.svg";
import teleportUrl from "../images/card-icons/teleport.svg";
import storageUrl from "../images/card-icons/storage.svg";
import monotonyUrl from "../images/card-icons/monotony.svg";
import hopUrl from "../images/card-icons/hop.svg";
import wallUrl from "../images/card-icons/wall.svg";
import inventionUrl from "../images/card-icons/invention.svg";
import ephemeralUrl from "../images/card-icons/ephemeral.svg";
import playsFirstUrl from "../images/card-icons/plays-first.svg";
import indestructibleUrl from "../images/card-icons/indestructible.svg";
import shyUrl from "../images/card-icons/shy.svg";
import escalateUrl from "../images/card-icons/escalate.svg";
import escalateTempUrl from "../images/card-icons/escalate-temp.svg";

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
/** Storage Bin's store / unstore mode. */
export const STORAGE_ICON = storageUrl;
/** Monotony's move-current-terrain mode. */
export const MONOTONY_ICON = monotonyUrl;
/** Hop's hop-over mode. */
export const HOP_ICON = hopUrl;
/** Wall's wall mode. */
export const WALL_ICON = wallUrl;
/** Invention's temporary-card mode. */
export const INVENTION_ICON = inventionUrl;
/** The sigil marking a card conjured by Invention. */
export const EPHEMERAL_ICON = ephemeralUrl;
/** The badge for a card that must be played before any other. */
export const PLAYS_FIRST_ICON = playsFirstUrl;
/** The badge for a card that cannot be destroyed or put to sleep. */
export const INDESTRUCTIBLE_ICON = indestructibleUrl;
/** The badge for a card that sinks to the bottom of the draw pile. */
export const SHY_ICON = shyUrl;
/** Escalation's permanent speed ramp. */
export const ESCALATE_ICON = escalateUrl;
/** Escalation's one-turn speed ramp. */
export const ESCALATE_TEMP_ICON = escalateTempUrl;

/** The coin icon as an inline element, for writing an amount of currency. */
export function coinIcon(): HTMLImageElement {
  const icon = document.createElement("img");
  icon.classList.add("card-symbol-icon");
  icon.src = COIN_ICON;
  icon.alt = "";
  return icon;
}
