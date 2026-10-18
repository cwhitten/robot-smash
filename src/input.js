// Keyboard + mouse state with edge-triggered "pressed" queries and pointer lock look.
// On touch devices an on-screen joystick, drag-to-look area and buttons feed the same state.

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
const TOUCH_LOOK_SCALE = 2.2;
const STICK_RADIUS = 60;

export const isTouch = typeof window !== 'undefined'
  && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  && window.matchMedia('(pointer: coarse)').matches;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.onKey = null;
    this.touch = isTouch;
    this.stickX = 0;
    this.stickY = 0;
    this.lastTouch = 0;

    window.addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      this.press(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.stickX = this.stickY = 0;
    });
    window.addEventListener('mousedown', (e) => {
      // iOS synthesizes mouse events after a tap; touch input is handled separately.
      if (performance.now() - this.lastTouch < 1000) return;
      if (e.target !== canvas && !this.locked) return;
      this.press(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    if (this.touch) this._setupTouch();
  }

  press(code) {
    if (!this.keys.has(code)) this.justPressed.add(code);
    this.keys.add(code);
  }

  release(code) {
    this.keys.delete(code);
  }

  _setupTouch() {
    document.body.classList.add('touch');
    const markTouch = () => { this.lastTouch = performance.now(); };
    window.addEventListener('touchstart', markTouch, { capture: true, passive: true });
    window.addEventListener('touchend', markTouch, { capture: true, passive: true });

    // Drag anywhere on the game view to look around.
    const looks = new Map();
    listen(this.canvas, {
      down: (e) => looks.set(e.pointerId, { x: e.clientX, y: e.clientY }),
      move: (e) => {
        const p = looks.get(e.pointerId);
        if (!p) return;
        this.dx += (e.clientX - p.x) * TOUCH_LOOK_SCALE;
        this.dy += (e.clientY - p.y) * TOUCH_LOOK_SCALE;
        p.x = e.clientX;
        p.y = e.clientY;
      },
      up: (e) => looks.delete(e.pointerId),
    });

    // Floating joystick: appears wherever the thumb lands in the left zone.
    const zone = document.getElementById('stickZone');
    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    let stickId = null, ox = 0, oy = 0;
    listen(zone, {
      down: (e) => {
        if (stickId !== null) return;
        stickId = e.pointerId;
        ox = e.clientX;
        oy = e.clientY;
        const r = zone.getBoundingClientRect();
        base.style.left = `${ox - r.left}px`;
        base.style.top = `${oy - r.top}px`;
        base.classList.add('active');
        knob.style.transform = 'translate(-50%, -50%)';
      },
      move: (e) => {
        if (e.pointerId !== stickId) return;
        let x = e.clientX - ox, y = e.clientY - oy;
        const len = Math.hypot(x, y);
        if (len > STICK_RADIUS) {
          x *= STICK_RADIUS / len;
          y *= STICK_RADIUS / len;
        }
        knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        // Small dead zone so a resting thumb doesn't drift.
        const m = Math.min(1, len / STICK_RADIUS);
        const k = m < 0.15 ? 0 : 1 / STICK_RADIUS;
        this.stickX = x * k;
        this.stickY = -y * k;
      },
      up: (e) => {
        if (e.pointerId !== stickId) return;
        stickId = null;
        this.stickX = this.stickY = 0;
        base.classList.remove('active');
      },
    });

    // Action buttons map to the same codes the keyboard uses.
    document.querySelectorAll('#touchControls [data-code]').forEach((btn) => {
      const code = btn.dataset.code;
      const ids = new Set();
      listen(btn, {
        down: (e) => {
          ids.add(e.pointerId);
          btn.classList.add('down');
          this.press(code);
          if (this.onKey) this.onKey(code);
        },
        up: (e) => {
          ids.delete(e.pointerId);
          if (ids.size) return;
          btn.classList.remove('down');
          this.release(code);
        },
      });
    });
  }

  lock() {
    if (this.locked || this.touch) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* some browsers refuse right after an unlock; the player can click again */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  pressed(code) {
    return this.enabled && this.justPressed.has(code);
  }

  endFrame() {
    this.justPressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}

// Pointer-capture helper so a finger keeps driving the control it started on.
function listen(el, { down, move, up }) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    down(e);
  });
  if (move) el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}
