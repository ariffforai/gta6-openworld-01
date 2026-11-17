// Input for SOLMAR: keyboard state, mouse look with pointer lock, and the
// edge-triggered keys (E, T, C, M, P, Space) the game polls each frame.
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.pressed = {};   // cleared at the end of each frame by main
    this.mouseDX = 0; this.mouseDY = 0;
    this.mouseDown = false;
    this.locked = false;
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.pressed[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('click', () => {
      if (!this.locked && document.body.classList.contains('playing')) {
        canvas.requestPointerLock();
      }
    });
  }
  down(code) { return !!this.keys[code]; }
  hit(code) { return !!this.pressed[code]; }
  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }
  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }
  endFrame() { this.pressed = {}; }
}
