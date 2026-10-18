import * as THREE from 'three';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();

// Third-person orbit camera that follows the player and never dips under the hills.
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 8;
    this.zoom = 1;
    this.shakeAmt = 0;
    this.sensitivity = 0.0024;
    this.look = new THREE.Vector3();
    this.initialized = false;
  }

  shake(a) {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, a));
  }

  update(dt, focus, heroScale, input, followYaw) {
    if (input) {
      this.yaw -= input.dx * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.dy * this.sensitivity, -0.15, 1.15);
      if (input.wheel) this.zoom = THREE.MathUtils.clamp(this.zoom + input.wheel * 0.1, 0.6, 1.6);
      // Without mouse look, ease the camera round behind the robot while it moves.
      if (!input.locked && followYaw !== null && followYaw !== undefined) {
        let d = followYaw + Math.PI - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, dt * 1.2);
      }
    }
    const dist = this.dist * (0.75 + 0.25 * heroScale) * this.zoom;
    _target.copy(focus);
    _target.y += 1.5 * heroScale + 0.3;
    const cp = Math.cos(this.pitch);
    _desired.set(
      _target.x + Math.sin(this.yaw) * cp * dist,
      _target.y + Math.sin(this.pitch) * dist,
      _target.z + Math.cos(this.yaw) * cp * dist,
    );
    const ground = this.world.heightAt(_desired.x, _desired.z) + 0.6;
    if (_desired.y < ground) _desired.y = ground;

    const cam = this.camera;
    if (!this.initialized) {
      cam.position.copy(_desired);
      this.look.copy(_target);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-14 * dt);
    cam.position.lerp(_desired, k);
    this.look.lerp(_target, 1 - Math.exp(-20 * dt));
    cam.lookAt(this.look);

    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.exp(-7 * dt);
    }
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
