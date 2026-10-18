import * as THREE from 'three';
import { HEROES, ABILITIES } from './config.js';
import { HERO_BUILDERS, animateRig, disposeRig } from './robotModels.js';
import { segDist } from './combat.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

const FX_COLORS = {
  jimmy: { blast: '#4de1ff', laser: '#4de1ff' },
  bob: { blast: '#7dff6a', laser: '#7dff6a' },
  nooby: { blast: '#ffd23f', laser: '#ffd23f' },
  oli: { blast: '#ff6a3a', laser: '#ff2a2a' },
};

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = Math.PI;
    this.alive = true;
    this.grounded = true;
    this.cooldowns = {};
    this.superCharge = 0;
    this.superActive = null;
    this.action = null;
    this.actionLock = 0;
    this.pending = [];
    this.invuln = 0;
    this.hitT = 0;
    this.time = 0;
    this.lastHurt = -99;
    this.punchSide = 1;
    this.dash = null;
    this.rig = null;
    this.superWasReady = false;
  }

  setHero(id) {
    const hero = HEROES[id];
    const hpFrac = this.rig ? this.hp / this.maxHp : 1;
    if (this.rig) disposeRig(this.rig);
    this.endSuper();
    this.hero = hero;
    this.heroId = id;
    this.maxHp = hero.health;
    this.hp = Math.max(1, Math.round(this.maxHp * hpFrac));
    this.strength = hero.strength;
    this.speed = hero.speed;
    this.rig = HERO_BUILDERS[id]();
    this.rig.root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    this.radius = 0.45 * hero.scale;
    this.height = this.rig.height;
    this.fx = FX_COLORS[id];
    this.superCharge = 0;
    this.superWasReady = false;
    this.cooldowns = {};
    this.game.scene.add(this.rig.root);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
  }

  spawnAt(p) {
    this.pos.copy(p);
    this.pos.y = this.game.world.heightAt(p.x, p.z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.alive = true;
    this.hp = this.maxHp;
    this.invuln = 2.5;
    this.dash = null;
    this.action = null;
    this.endSuper();
    this.rig.root.visible = true;
    this.facing = Math.PI;
  }

  get abilities() {
    const h = this.hero;
    return [h.primary, h.secondary, 'dash', h.superAbility].filter(Boolean);
  }

  // ---------------------------------------------------------------- targeting
  getAim(range) {
    const yaw = this.game.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = Infinity;
    for (const e of this.game.enemies.list) {
      if (!e.alive || !e.active) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      let score;
      if (d < 3.2 + e.radius) score = d * 0.5;
      else if (dot > 0.55) score = d * (2.2 - dot);
      else continue;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    const dir = new THREE.Vector3(fx, 0, fz);
    if (best) dir.set(best.pos.x - this.pos.x, 0, best.pos.z - this.pos.z).normalize();
    return { target: best, dir };
  }

  _face(dir, lock) {
    this.aimYaw = Math.atan2(dir.x, dir.z);
    this.actionLock = Math.max(this.actionLock, lock);
  }

  _schedule(t, fn) {
    this.pending.push({ t, fn });
  }

  _worldPos(obj, out = new THREE.Vector3()) {
    this.rig.root.updateMatrixWorld(true);
    return obj.getWorldPosition(out);
  }

  addCharge(n) {
    if (!this.hero.superAbility || this.superActive) return;
    this.superCharge = Math.min(100, this.superCharge + n);
  }

  // ---------------------------------------------------------------- melee
  _melee(range, minDot, dmg, knock, dir, hitColor) {
    let hits = 0;
    for (const e of this.game.enemies.list) {
      if (!e.alive || !e.active) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > range) continue;
      if (Math.abs(e.pos.y - this.pos.y) > e.height + 1.5) continue;
      const dot = (dx * dir.x + dz * dir.z) / Math.max(0.01, Math.hypot(dx, dz));
      if (d > 0.6 && dot < minDot) continue;
      _v.set(dx, 0, dz).normalize();
      e.takeDamage(dmg, _v, knock);
      this.addCharge(8);
      hits++;
      _v2.copy(e.pos).addScaledVector(_v, -e.radius * 0.8);
      _v2.y += e.height * 0.55;
      this.game.effects.burst(_v2, { count: 12, color: hitColor, speed: 9, size: 0.12, intensity: 4 });
      this.game.effects.flash(_v2, { radius: 0.7, color: hitColor, life: 0.12 });
    }
    if (hits) this.game.cam.shake(0.15);
    return hits;
  }

  // ---------------------------------------------------------------- abilities
  _use(name) {
    if ((this.cooldowns[name] ?? 0) > 0) return false;
    const ab = ABILITIES[name];
    const s = this.strength;
    const game = this.game;
    const fx = game.effects;
    switch (name) {
      case 'punch': {
        const { dir } = this.getAim(6);
        this._face(dir, 0.3);
        this.punchSide = -this.punchSide;
        this.action = { type: 'punch', t: 0, dur: 0.32, side: this.punchSide };
        game.audio.play('dash', { vol: 0.25 });
        this._schedule(0.09, () => {
          if (this._melee(1.6 * this.hero.scale + 0.5, 0.25, s, 5, dir, '#ffe08a')) game.audio.play('punch');
        });
        break;
      }
      case 'slice': {
        const { dir } = this.getAim(7);
        this._face(dir, 0.35);
        this.action = { type: 'slice', t: 0, dur: 0.36 };
        this.sliceTrail = 0.3;
        game.audio.play('slice');
        this._schedule(0.1, () => { this._melee(2.6 * this.hero.scale + 0.4, -0.15, s, 6, dir, '#a8f0ff'); });
        break;
      }
      case 'blast': {
        const { dir, target } = this.getAim(32);
        this._face(dir, 0.35);
        const isOli = this.heroId === 'oli';
        this.action = { type: isOli ? 'blast2' : 'blast', t: 0, dur: 0.4 };
        this._schedule(0.08, () => {
          const from = this._worldPos(this.rig.muzzle);
          const aimDir = new THREE.Vector3();
          if (target && target.alive) aimDir.copy(target.pos).setY(target.pos.y + target.height * 0.5).sub(from).normalize();
          else aimDir.copy(dir);
          game.combat.shoot({
            from, dir: aimDir, speed: 34, damage: isOli ? s * 1.1 : s, team: 'player', color: this.fx.blast,
            size: isOli ? 0.42 : 0.32, homing: target, turn: 3, life: 1.4, explode: isOli ? 2.8 : 0,
            onHit: () => this.addCharge(7),
          });
          fx.flash(from, { radius: 0.6, color: this.fx.blast, life: 0.12 });
          game.audio.play('blast');
        });
        break;
      }
      case 'laser': {
        const { dir, target } = this.getAim(30);
        this._face(dir, 0.4);
        this.action = { type: 'laser', t: 0, dur: 0.4 };
        this._schedule(0.06, () => {
          const from = this._worldPos(this.rig.eyeMuzzle);
          const to = new THREE.Vector3();
          if (target && target.alive) to.copy(target.pos).setY(target.pos.y + target.height * 0.55);
          else to.copy(from).addScaledVector(dir, 30);
          const beamDir = _v.subVectors(to, from).normalize();
          to.copy(from).addScaledVector(beamDir, 32);
          this._clipToGround(from, to);
          let hit = 0;
          for (const e of game.enemies.list) {
            if (!e.alive || !e.active) continue;
            _v2.copy(e.pos).setY(e.pos.y + e.height * 0.5);
            if (segDist(_v2, from, to) < e.radius + 0.6) {
              e.takeDamage(s * 1.3, beamDir, 5);
              this.addCharge(6);
              fx.burst(_v2, { count: 10, color: this.fx.laser, speed: 8, size: 0.1, intensity: 4 });
              hit++;
            }
          }
          fx.beam(from, to, { color: this.fx.laser, width: 0.16, life: 0.22 });
          fx.burst(to, { count: 6, color: this.fx.laser, speed: 5, size: 0.08 });
          game.audio.play('laser');
          if (hit) game.cam.shake(0.12);
        });
        break;
      }
      case 'dash': {
        const dir = this.moveDir.lengthSq() > 0.01 ? this.moveDir.clone() : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        this.dash = { dir, t: 0.22, hit: new Set() };
        this.invuln = Math.max(this.invuln, 0.32);
        this.facing = Math.atan2(dir.x, dir.z);
        game.audio.play('dash');
        break;
      }
      default:
        return false;
    }
    this.cooldowns[name] = ab.cooldown;
    return true;
  }

  _clipToGround(from, to) {
    const w = this.game.world;
    const steps = Math.ceil(from.distanceTo(to));
    for (let i = 1; i <= steps; i++) {
      _v2.lerpVectors(from, to, i / steps);
      if (_v2.y < w.heightAt(_v2.x, _v2.z)) {
        to.copy(_v2);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- supers
  _startSuper() {
    const h = this.hero;
    if (!h.superAbility || this.superCharge < 100 || this.superActive) return;
    const game = this.game;
    this.superCharge = 0;
    this.superWasReady = false;
    game.audio.play('super');
    game.ui.banner(`${ABILITIES[h.superAbility].icon} ${ABILITIES[h.superAbility].name}!`, this.fx.laser, 1.2);
    const s = this.strength;
    switch (h.superAbility) {
      case 'laserSuper': {
        this.superActive = { type: 'laserSuper', t: 0, dur: 3.2, tick: 0, beam: game.effects.persistentBeam('#7dff6a', 0.55) };
        game.audio.startHum();
        break;
      }
      case 'starSlice': {
        this.superActive = { type: 'starSlice', t: 0, dur: 1.0, fired: false };
        this.invuln = Math.max(this.invuln, 1.1);
        game.audio.play('starSlice');
        break;
      }
      case 'rocket': {
        this.superActive = { type: 'rocket', t: 0, dur: 1.0 };
        const targets = game.enemies.list
          .filter((e) => e.alive && e.active && e.pos.distanceTo(this.pos) < 50)
          .sort((a, b) => (b.isBoss - a.isBoss) || a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))
          .slice(0, 3);
        const { dir } = this.getAim(50);
        for (let k = 0; k < 3; k++) {
          this._schedule(0.12 + k * 0.18, () => {
            let target = targets[k] ?? targets[0];
            if (!target || !target.alive) {
              const p = this.pos.clone().addScaledVector(dir, 18 + k * 4);
              p.x += (k - 1) * 4;
              p.y = game.world.heightAt(p.x, p.z);
              target = { alive: true, pos: p, height: 0 };
            }
            const from = this._worldPos(this.rig.rocketMount).add(new THREE.Vector3((k - 1) * 0.3, 0.4, 0));
            const launch = new THREE.Vector3((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6).normalize();
            game.combat.shoot({
              from, dir: launch, speed: 14, damage: s * 5, team: 'player', kind: 'rocket', homing: target,
              turn: 3.5, life: 4, explode: 6.5, color: '#ff8a2a',
            });
            game.audio.play('rocket');
            game.effects.smokePuff(from, 2, 0.5, '#8a8a8a');
          });
        }
        break;
      }
      default: break;
    }
  }

  _updateSuper(dt) {
    const sa = this.superActive;
    if (!sa) return;
    const game = this.game;
    const fx = game.effects;
    sa.t += dt;
    if (sa.type === 'laserSuper') {
      const { dir, target } = this.getAim(40);
      this._face(dir, 0.2);
      this.action = { type: 'super', t: 0.5, dur: 10 };
      const from = this._worldPos(this.rig.chestMuzzle ?? this.rig.muzzle, _from);
      const to = _to;
      if (target) to.copy(target.pos).setY(target.pos.y + target.height * 0.5);
      else to.copy(from).addScaledVector(dir, 40).setY(from.y - 1.5);
      _v.subVectors(to, from).normalize();
      to.copy(from).addScaledVector(_v, 42);
      const hitGround = this._clipToGround(from, to);
      game.effects.setBeam(sa.beam, from, to, 1 + Math.sin(sa.t * 40) * 0.15);
      sa.tick -= dt;
      if (sa.tick <= 0) {
        sa.tick = 0.1;
        for (const e of game.enemies.list) {
          if (!e.alive || !e.active) continue;
          _v2.copy(e.pos).setY(e.pos.y + e.height * 0.5);
          if (segDist(_v2, from, to) < e.radius + 1.0) {
            e.takeDamage(this.strength * 0.55, _v, 2, true);
            fx.burst(_v2, { count: 4, color: '#b6ff9a', speed: 6, size: 0.1 });
          }
        }
        if (hitGround) {
          fx.burst(to, { count: 8, color: '#7dff6a', speed: 7, size: 0.12, intensity: 4 });
          fx.smokePuff(to, 1, 0.6, '#777');
        }
      }
      game.cam.shake(0.05);
      if (sa.t >= sa.dur) this.endSuper();
    } else if (sa.type === 'starSlice') {
      const f = Math.min(1, sa.t / sa.dur);
      this.rig.spin = f * Math.PI * 6;
      this.action = { type: 'super', t: 0.5, dur: 10 };
      if (this.rig.swordTip && Math.random() < 0.9) {
        fx.glow(this._worldPos(this.rig.swordTip), { color: '#ffd23f', size: 0.5, life: 0.35, intensity: 3 });
      }
      if (!sa.fired && sa.t > 0.18) {
        sa.fired = true;
        const c = this.pos.clone().setY(this.pos.y + 1);
        game.combat.areaDamage(c, 8.5, this.strength * 4, 'player', 12);
        fx.ring(this.pos.clone(), { radius: 10, color: '#ffd23f', life: 0.6 });
        fx.flash(c, { radius: 4, color: '#ffd23f', life: 0.35 });
        fx.burst(c, { count: 40, color: '#ffe680', speed: 16, size: 0.15, life: 0.6, gravity: 2, up: 0, intensity: 4 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          game.combat.shoot({
            from: c, dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), speed: 22, damage: this.strength * 1.5,
            team: 'player', kind: 'star', size: 0.35, life: 0.9, pierce: true, color: '#ffd23f',
          });
        }
        game.cam.shake(0.5);
      }
      if (sa.t >= sa.dur) { this.rig.spin = 0; this.endSuper(); }
    } else if (sa.type === 'rocket') {
      this.action = { type: 'super', t: 0.5, dur: 10 };
      if (sa.t >= sa.dur) this.endSuper();
    }
  }

  endSuper() {
    const sa = this.superActive;
    if (!sa) return;
    if (sa.beam) this.game.effects.removeBeam(sa.beam);
    if (sa.type === 'laserSuper') this.game.audio.stopHum();
    if (this.rig) this.rig.spin = 0;
    this.superActive = null;
    this.action = null;
  }

  // ---------------------------------------------------------------- damage
  takeDamage(amount, fromPos) {
    const game = this.game;
    if (!this.alive || this.invuln > 0 || game.state !== 'playing') return;
    amount = Math.max(1, Math.round(amount));
    this.hp -= amount;
    this.lastHurt = this.time;
    this.hitT = 1;
    this.invuln = 0.35;
    game.audio.play('hurt');
    game.ui.hurtFlash();
    game.cam.shake(0.3);
    _v.copy(this.pos).setY(this.pos.y + this.height * 0.6);
    game.effects.burst(_v, { count: 10, color: '#ff6a3a', speed: 7, size: 0.1 });
    game.effects.text(_v, `-${amount}`, { color: '#ff5050', size: 24 });
    if (fromPos) {
      _v.subVectors(this.pos, fromPos).setY(0).normalize();
      this.vel.addScaledVector(_v, 7);
    }
    if (this.hp <= 0) this.die();
  }

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const gained = Math.round(this.hp - before);
    if (gained > 0) this.game.effects.text(this.pos.clone().setY(this.pos.y + this.height), `+${gained}`, { color: '#3dff6e', size: 24 });
  }

  die() {
    const game = this.game;
    this.alive = false;
    this.hp = 0;
    this.endSuper();
    this.dash = null;
    const c = this.pos.clone().setY(this.pos.y + this.height * 0.5);
    game.effects.explosion(c, 3, '#ffaa44', true);
    game.effects.debrisBurst(c, [this.hero.color, '#cccccc', '#333333'], 18, 9, 0.25);
    this.rig.root.visible = false;
    game.onPlayerDeath();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const game = this.game;
    const input = game.input;
    const world = game.world;
    this.time += dt;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitT = Math.max(0, this.hitT - dt * 4);
    this.actionLock = Math.max(0, this.actionLock - dt);
    if (!this.alive) return;

    // Pending ability events (hit frames).
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        if (this.alive) p.fn();
      }
    }

    // ---- movement input relative to the camera
    const yaw = game.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const mz = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0) + input.stickY;
    const mx = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) + input.stickX;
    this.moveDir = new THREE.Vector3(fx * mz + rx * mx, 0, fz * mz + rz * mx);
    if (this.moveDir.lengthSq() > 1) this.moveDir.normalize();

    let speed = this.speed;
    if (this.superActive?.type === 'laserSuper') speed *= 0.45;
    else if (this.action && this.action.type !== 'punch') speed *= 0.8;

    if (this.dash) {
      this.dash.t -= dt;
      this.vel.x = this.dash.dir.x * 25;
      this.vel.z = this.dash.dir.z * 25;
      game.effects.glow(_v.copy(this.pos).setY(this.pos.y + this.height * 0.5), { color: this.hero.color, size: 0.9 * this.hero.scale, life: 0.25, intensity: 1.5 });
      for (const e of game.enemies.list) {
        if (!e.alive || !e.active || this.dash.hit.has(e)) continue;
        if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < e.radius + this.radius + 0.6) {
          this.dash.hit.add(e);
          e.takeDamage(this.strength * 0.5, this.dash.dir, 9);
          this.addCharge(5);
          game.audio.play('punch', { vol: 0.7 });
        }
      }
      if (this.dash.t <= 0) {
        this.dash = null;
        this.vel.multiplyScalar(0.35);
      }
    } else {
      const k = 1 - Math.exp(-14 * dt);
      this.vel.x += (this.moveDir.x * speed - this.vel.x) * k;
      this.vel.z += (this.moveDir.z * speed - this.vel.z) * k;
    }

    this.vy -= 26 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    world.resolveCollision(this.pos, this.radius);
    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vy < -7) {
        game.audio.play('land');
        game.effects.smokePuff(this.pos, 3, 0.5, '#9b8b6e');
      }
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.25) {
      this.grounded = false;
    } else if (this.vy <= 0) {
      this.pos.y = ground; // stick to slopes when walking downhill
      this.vy = 0;
      this.grounded = true;
    }

    // ---- actions
    if (input.pressed('Space') && this.grounded) {
      this.vy = 10;
      this.grounded = false;
      game.audio.play('jump');
    }
    if (input.pressed('ShiftLeft') || input.pressed('ShiftRight') || input.pressed('KeyL')) this._use('dash');
    const busy = this.superActive && this.superActive.type !== 'rocket';
    if (!busy && !this.dash) {
      if (input.down('Mouse0') || input.down('KeyJ')) this._use(this.hero.primary);
      if (this.hero.secondary && (input.down('Mouse2') || input.down('KeyK'))) this._use(this.hero.secondary);
    }
    if (input.pressed('KeyE') || input.pressed('KeyQ') || input.pressed('Mouse1')) {
      if (this.hero.superAbility && this.superCharge >= 100) this._startSuper();
      else if (this.hero.superAbility) game.ui.toast('Super is still charging! Hit robots to charge it.');
      else game.ui.toast('Jimmy has no super power yet. Buy a new robot in the shop! ' + (game.input.touch ? '🛒' : '(B)'));
    }

    this._updateSuper(dt);
    if (this.hero.superAbility && !this.superActive) {
      this.superCharge = Math.min(100, this.superCharge + dt * 1.2);
      if (this.superCharge >= 100 && !this.superWasReady) {
        this.superWasReady = true;
        game.audio.play('superReady');
        game.ui.banner(game.input.touch ? 'SUPER READY! Tap ⭐' : 'SUPER READY! Press E', '#ffd23f', 1.6);
      }
    }

    // Sword trail.
    if (this.sliceTrail > 0 && this.rig.swordTip) {
      this.sliceTrail -= dt;
      game.effects.glow(this._worldPos(this.rig.swordTip), { color: '#a8f0ff', size: 0.35, life: 0.18, intensity: 2.5 });
    }

    // Regenerate when out of danger.
    if (this.time - this.lastHurt > 4 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.06 * dt);
    }

    // ---- facing + animation
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    let targetYaw = this.facing;
    if (this.actionLock > 0 && this.aimYaw !== undefined) targetYaw = this.aimYaw;
    else if (this.moveDir.lengthSq() > 0.01) targetYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
    this.facing = angleLerp(this.facing, targetYaw, 1 - Math.exp(-(this.actionLock > 0 ? 30 : 12) * dt));

    if (this.action) {
      this.action.t += dt / this.action.dur;
      if (this.action.t >= 1) this.action = null;
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    this.rig.root.visible = !(this.invuln > 0.4 && Math.floor(this.time * 20) % 2 === 0 && !this.dash && !this.superActive);
    animateRig(this.rig, {
      speed: this.dash ? 0 : horizSpeed, airborne: !this.grounded, dashing: !!this.dash,
      action: this.action, time: this.time, hit: this.hitT,
    }, dt);
  }

  // Used on the title screen: idle on the pad.
  idle(dt) {
    this.time += dt;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    animateRig(this.rig, { speed: 0, airborne: false, dashing: false, action: null, time: this.time, hit: 0 }, dt);
  }
}
