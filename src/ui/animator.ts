import { hexToPixel } from "../game/hex";
import type { HexCoord } from "../game/hex";
import type { MovePath, Mover } from "../game/transition";
import type { MapView, Point } from "./map-view";

/** Milliseconds spent crossing one hex. */
const STEP_MS = 130;
/** How long to hold still, before and after a watched move, so the eye can land. */
const BEAT_MS = 200;
/** Camera smoothing rate, per second; higher catches up faster. */
const CAMERA_RATE = 16;
/** The camera counts as settled once within this many pixels of its target. */
const SETTLE_PX = 1.5;
/** Upper bound on a camera glide, so an eased approach can never stall. */
const SETTLE_MAX_MS = 600;
/** Longest frame to honour, so a backgrounded tab cannot fling the camera. */
const MAX_FRAME_MS = 50;

/**
 * Walks markers along their paths and pans the camera to follow them. All the
 * timing lives here, so the game layer stays a pure state machine that only
 * reports which paths were taken.
 *
 * The pieces are deliberately small — `focusOn`, `beat`, `moveAlong` — so the
 * caller can compose a readable sequence: settle on the actor, hold a beat,
 * walk it, hold another beat, then move on to the next one.
 */
export class Animator {
  private readonly map: MapView;
  /** World pixel at the viewport's top-left. */
  private camera: Point = { x: 0, y: 0 };
  /** World pixel the camera is easing toward centring. */
  private focus: Point = { x: 0, y: 0 };
  private lastFrame = 0;

  constructor(map: MapView) {
    this.map = map;
  }

  /** Centre the camera on `point` with no animation. */
  snap(point: Point): void {
    this.focus = point;
    this.camera = this.centredOn(point);
    this.map.setCamera(this.camera);
  }

  /**
   * Park every actor at the start of its path. The state is already the
   * destination when a transition lands, so without this a marker would sit on
   * its goal and then jump back the moment its walk begins.
   */
  prepare(moves: readonly MovePath[]): void {
    for (const move of moves) {
      const first = move.path[0];
      if (first !== undefined) {
        this.map.placeActor(move.mover, hexToPixel(first));
      }
    }
  }

  /** Ease the camera onto `point` and wait until it arrives. */
  async focusOn(point: Point): Promise<void> {
    this.focus = point;
    await this.settle();
  }

  /** Hold for a beat, letting the camera finish and the viewer orient. */
  async beat(): Promise<void> {
    let elapsed = 0;
    while (elapsed < BEAT_MS) {
      elapsed += await this.tick();
    }
  }

  /**
   * Walk `mover` along `path`, the camera trailing it. The camera should
   * already be on the mover — call `focusOn` first for an actor the viewer was
   * not looking at.
   */
  async moveAlong(mover: Mover, path: readonly HexCoord[]): Promise<void> {
    const first = path[0];
    if (first === undefined || path.length < 2) {
      return;
    }
    this.map.setMoving(mover, true);
    try {
      await this.walk(mover, path);
    } finally {
      this.map.setMoving(mover, false);
    }
  }

  private async walk(mover: Mover, path: readonly HexCoord[]): Promise<void> {
    const total = (path.length - 1) * STEP_MS;
    let elapsed = 0;
    let pixel = hexToPixel(path[0]);
    this.focus = pixel;
    this.map.placeActor(mover, pixel);

    for (;;) {
      elapsed += await this.tick();
      const t = Math.min(1, elapsed / total);
      pixel = pointAlong(path, t);
      this.focus = pixel;
      this.map.placeActor(mover, pixel);
      if (t >= 1) {
        return;
      }
    }
  }

  private async settle(): Promise<void> {
    let elapsed = 0;
    for (;;) {
      elapsed += await this.tick();
      if (this.cameraSettled() || elapsed >= SETTLE_MAX_MS) {
        this.camera = this.centredOn(this.focus);
        this.map.setCamera(this.camera);
        return;
      }
    }
  }

  /** Await the next frame, ease the camera, and report the time it took. */
  private async tick(): Promise<number> {
    const time = await nextFrame();
    const dt = this.lastFrame === 0 ? 0 : Math.min(MAX_FRAME_MS, time - this.lastFrame);
    this.lastFrame = time;
    this.advanceCamera(dt);
    return dt;
  }

  private advanceCamera(dtMs: number): void {
    const k = 1 - Math.exp(-(dtMs / 1000) * CAMERA_RATE);
    const desired = this.centredOn(this.focus);
    this.camera = {
      x: this.camera.x + (desired.x - this.camera.x) * k,
      y: this.camera.y + (desired.y - this.camera.y) * k,
    };
    this.map.setCamera(this.camera);
  }

  private cameraSettled(): boolean {
    const desired = this.centredOn(this.focus);
    return Math.abs(desired.x - this.camera.x) < SETTLE_PX
      && Math.abs(desired.y - this.camera.y) < SETTLE_PX;
  }

  private centredOn(point: Point): Point {
    const size = this.map.viewportSize();
    return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
  }
}

/** The world pixel a fraction `t` of the way along `path`. */
function pointAlong(path: readonly HexCoord[], t: number): Point {
  const last = path.length - 1;
  const scaled = t * last;
  const index = Math.min(last - 1, Math.floor(scaled));
  const local = scaled - index;
  const a = hexToPixel(path[index]);
  const b = hexToPixel(path[index + 1]);
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

function nextFrame(): Promise<number> {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
  // No animation frames (tests, SSR): still advance, on a timer, so the loop
  // can never spin on a non-advancing clock.
  return new Promise((resolve) => {
    setTimeout(() => resolve(Date.now()), 16);
  });
}

/** Whether the user has asked the system to avoid motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
