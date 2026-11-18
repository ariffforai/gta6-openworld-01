// SOLMAR input: keyboard state with per-frame edge detection, plus mouse
// look through pointer lock. The game only listens while it is playing; the
// menu and pause screens use ordinary buttons.

const PREVENTED = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);

/** Track keys and the mouse for one canvas. Call `endFrame()` once per tick. */
export function createInput(canvas) {
  const keys = new Set();
  const edge = new Set();
  const state = {
    /** Keys held right now (KeyboardEvent.code values). */
    keys,
    /** Mouse movement accumulated since the last frame, in pixels. */
    mouseDX: 0,
    mouseDY: 0,
    /** Whether the pointer is locked to the canvas. */
    locked: false,
  };

  window.addEventListener('keydown', (event) => {
    if (PREVENTED.has(event.code)) event.preventDefault();
    if (!event.repeat) edge.add(event.code);
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    edge.clear();
  });

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.mouseDX += event.movementX || 0;
    state.mouseDY += event.movementY || 0;
  });

  /** True while `code` is held down. */
  state.isDown = (code) => keys.has(code);

  /** True while any of `codes` is held down. */
  state.isDownAny = (codes) => codes.some((code) => keys.has(code));

  /** Give the mouse back (leaves pointer lock, e.g. when pausing). */
  state.unlock = () => {
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  };

  /** True only on the frame `code` was first pressed (consumes the edge). */
  state.wasPressed = (code) => {
    if (!edge.has(code)) return false;
    edge.delete(code);
    return true;
  };

  /** Mouse delta since the last frame, then cleared. */
  state.consumeMouse = () => {
    const out = { dx: state.mouseDX, dy: state.mouseDY };
    state.mouseDX = 0;
    state.mouseDY = 0;
    return out;
  };

  /** WASD movement axes: x is strafe (right positive), y is forward. */
  state.moveAxis = () => ({
    x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    y: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
  });

  /** Clear per-frame edges. Call once at the end of every tick. */
  state.endFrame = () => {
    edge.clear();
    state.mouseDX = 0;
    state.mouseDY = 0;
  };

  return state;
}
