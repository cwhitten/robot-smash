import * as THREE from 'three';
import { ENEMY_TYPES, ECONOMY } from './config.js';
import { buildEnemyModel, animateRig, disposeRig } from './robotModels.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const ACTIVE_RANGE = 120;
const MAX_ATTACKERS = 2; // only a couple of regular bots may wind up at once — keeps it fair for kids

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class HealthBar {
  constructor(scene, width, color) {
    this.group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.08, 0.2), new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.7, depthWrite: false }));
    const geo = new THREE.PlaneGeometry(width, 0.13).translate(width / 2, 0, 0);
    this.fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, toneMapped: false, depthWrite: false, transparent: true }));
    this.fill.position.set(-width / 2, 0, 0.01);
    this.group.add(bg, this.fill);
    this.group.renderOrder = 10;
    this.group.visible = false;
    scene.add(this.group);
  }

  set(frac) {
    this.fill.scale.x = Math.max(0.001, frac);
    this.fill.material.color.setHSL(0.33 * frac, 0.9, 0.5);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((c) => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); } });
  }
}

export class Enemy {
  constructor(game, typeKey, home, bossDef = null, arena = null) {
    this.game = game;
    this.typeKey = typeKey;
    this.def = bossDef ? { ...bossDef, speed: 3.6, range: 4.5, windup: 0.8, cooldown: 1.6, radius: 1.5, attack: 'melee', name: bossDef.name } : ENEMY_TYPES[typeKey];
    this.bossDef = bossDef;
    this.isBoss = !!bossDef;
    this.arena = arena;
    this.home = home.clone();
    this.pos = home.clone();
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;
    this.active = true;
    this.state = 'idle';
    this.timer = Math.random() * 3;
    this.cooldown = 0;
    this.hitT = 0;
    this.time = Math.random() * 10;
    this.action = null;
    this.wanderTarget = home.clone();
    this.radius = this.def.radius * (this.isBoss ? 1 : 1);
    this.specialTimer = 4;
    this.specialIndex = 0;
    this.respawnTimer = 0;
    this._build();
    this.rescale(game.player.hero);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  _build() {
    this.rig = buildEnemyModel(this.typeKey, this.bossDef);
    this.height = this.rig.height;
    this.game.scene.add(this.rig.root);
    if (!this.isBoss) this.bar = new HealthBar(this.game.scene, this.typeKey === 'clanker' ? 1.6 : 1.1, '#3dff6e');
  }

  rescale(hero) {
    const frac = this.maxHp ? this.hp / this.maxHp : 1;
    this.maxHp = Math.round(this.def.hpMul * hero.strength);
    this.hp = Math.max(1, Math.round(this.maxHp * frac));
    this.damage = Math.max(1, Math.round(this.def.dmgMul * hero.health));
    this.coins = Math.round(this.def.coins * hero.coinMult);
  }

  get name() { return this.def.name; }

  takeDamage(amount, dir, knock = 4, quiet = false) {
    if (!this.alive) return;
    const game = this.game;
    amount = Math.max(1, Math.round(amount * (0.9 + Math.random() * 0.2)));
    this.hp -= amount;
    this.hitT = 1;
    if (dir) this.knock.addScaledVector(dir, knock * (this.isBoss ? 0.15 : 1));
    _v.copy(this.pos).setY(this.pos.y + this.height + 0.2);
    _v.x += (Math.random() - 0.5) * 0.8;
    if (!quiet || Math.random() < 0.3) game.effects.text(_v, `${amount}`, { color: this.isBoss ? '#ffd23f' : '#ffffff', size: this.isBoss ? 26 : 22 });
    if (!quiet) game.audio.play('enemyHit');
    if (this.state === 'idle' || this.state === 'return') this._aggro();
    if (this.hp <= 0) this.die();
  }

  _aggro() {
    if (this.state === 'chase') return;
    this.state = 'chase';
    if (this.isBoss) {
      this.game.onBossEngaged(this);
    } else {
      this.game.effects.text(_v2.copy(this.pos).setY(this.pos.y + this.height + 0.6), '!', { color: '#ff3b3b', size: 34, life: 0.7, rise: 0.6 });
      this.game.audio.play('alert');
    }
  }

  die() {
    const game = this.game;
    this.alive = false;
    this.hp = 0;
    this._cancelTelegraph();
    if (this._counted) { game.enemies.attackers--; this._counted = false; }
    this.state = 'idle';
    this.special = null;
    this.action = null;
    const c = this.pos.clone().setY(this.pos.y + this.height * 0.5);
    const colors = this.isBoss ? [this.bossDef.body, this.bossDef.accent, '#333'] : this.typeKey === 'zapper' ? ['#f2b705', '#222'] : ['#b5562a', '#5a4a3a', '#3b302a'];
    game.effects.explosion(c, this.isBoss ? 6 : 2.2, '#ffaa44', this.isBoss);
    game.effects.debrisBurst(c, colors, this.isBoss ? 30 : 10, this.isBoss ? 14 : 7, this.isBoss ? 0.5 : 0.2);
    game.pickups.dropCoins(this.pos, this.coins);
    if (this.isBoss) game.pickups.dropHealth(this.pos, 3);
    else if (Math.random() < 0.22) game.pickups.dropHealth(this.pos);
    this.rig.root.visible = false;
    if (this.bar) this.bar.group.visible = false;
    this.respawnTimer = this.isBoss ? ECONOMY.bossRespawn : ECONOMY.enemyRespawn + Math.random() * 10;
    game.onEnemyKilled(this);
  }

  revive() {
    this.alive = true;
    this.hp = this.maxHp;
    this.pos.copy(this.home);
    this.pos.y = this.game.world.heightAt(this.pos.x, this.pos.z);
    this.state = 'idle';
    this.action = null;
    this.knock.set(0, 0, 0);
    this.rig.root.visible = true;
    this.rig.root.position.copy(this.pos);
    // Pop in with a puff so it doesn't just appear.
    this.game.effects.smokePuff(this.pos, 4, 1, '#cfcfcf');
  }

  _cancelTelegraph() {
    if (this.telegraph) {
      this.game.effects.removeTelegraph(this.telegraph);
      this.telegraph = null;
    }
  }

  // ---------------------------------------------------------------- AI
  update(dt, distToPlayer) {
    const game = this.game;
    const pl = game.player;
    const world = game.world;
    this.time += dt;
    this.hitT = Math.max(0, this.hitT - dt * 5);
    this.cooldown -= dt;
    this.timer -= dt;
    const def = this.def;

    const toP = _v.subVectors(pl.pos, this.pos).setY(0);
    const d = toP.length();
    const dirP = d > 0.001 ? toP.divideScalar(d) : toP.set(0, 0, 1);
    let move = 0;
    let moveDir = null;
    let faceYaw = null;

    const aggroRange = this.isBoss ? this.arena.r + 3 : 15;
    const homeDist = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);

    switch (this.state) {
      case 'idle': {
        if (pl.alive && (this.isBoss ? Math.hypot(pl.pos.x - this.arena.x, pl.pos.z - this.arena.z) < aggroRange : d < aggroRange)) {
          this._aggro();
          break;
        }
        if (this.timer <= 0) {
          this.timer = 2 + Math.random() * 4;
          const a = Math.random() * Math.PI * 2, r = Math.random() * (this.isBoss ? 6 : 5);
          this.wanderTarget.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        }
        const wd = _v2.subVectors(this.wanderTarget, this.pos).setY(0);
        if (wd.length() > 0.8) { moveDir = wd.normalize(); move = def.speed * 0.35; }
        break;
      }
      case 'return': {
        const back = _v2.subVectors(this.home, this.pos).setY(0);
        if (back.length() < 2) {
          this.state = 'idle';
          break;
        }
        moveDir = back.normalize();
        move = def.speed * 1.2;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
        break;
      }
      case 'chase': {
        const leash = this.isBoss
          ? Math.hypot(pl.pos.x - this.arena.x, pl.pos.z - this.arena.z) > this.arena.r + 22
          : homeDist > 38 || d > 30;
        if (!pl.alive || leash) {
          this.state = 'return';
          this._cancelTelegraph();
          if (this.isBoss) game.onBossReset(this);
          break;
        }
        faceYaw = Math.atan2(dirP.x, dirP.z);
        if (this.isBoss) {
          this.specialTimer -= dt;
          if (this.specialTimer <= 0) { this._startSpecial(dirP, d); break; }
        }
        const canAttack = this.cooldown <= 0 && (this.isBoss || game.enemies.attackers < MAX_ATTACKERS);
        if (def.attack === 'ranged') {
          if (d < 7) { moveDir = dirP.clone().negate(); move = def.speed * 0.8; }
          else if (d > def.range * 0.85) { moveDir = dirP.clone(); move = def.speed; }
          else {
            // Strafe around the player.
            moveDir = new THREE.Vector3(-dirP.z, 0, dirP.x).multiplyScalar(Math.sin(this.time * 0.7) > 0 ? 1 : -1);
            move = def.speed * 0.5;
          }
          if (canAttack && d < def.range) this._startWindup('shoot');
        } else {
          if (d > def.range * 0.8) { moveDir = dirP.clone(); move = def.speed; }
          if (canAttack && d < def.range + 0.4) this._startWindup(this.typeKey === 'clanker' || this.isBoss ? 'smash' : 'swing');
        }
        break;
      }
      case 'windup': {
        faceYaw = Math.atan2(dirP.x, dirP.z);
        if (this.action) this.action.t = 1 - this.timer / def.windup;
        if (this.timer <= 0) this._attack(d, dirP);
        break;
      }
      case 'recover': {
        if (this.timer <= 0) this.state = 'chase';
        break;
      }
      case 'special': {
        this._updateSpecial(dt, dirP, d);
        break;
      }
      case 'dizzy': {
        if (Math.random() < 0.3) {
          const a = this.time * 6;
          game.effects.glow(_v2.set(this.pos.x + Math.cos(a) * 1.2, this.pos.y + this.height + 0.4, this.pos.z + Math.sin(a) * 1.2), { color: '#ffe14d', size: 0.4, life: 0.3, intensity: 3 });
        }
        if (this.timer <= 0) { this.state = 'chase'; this.specialTimer = 3 + Math.random() * 2; }
        break;
      }
      default: break;
    }

    // ---- movement
    const k = 1 - Math.exp(-8 * dt);
    const tx = moveDir ? moveDir.x * move : 0, tz = moveDir ? moveDir.z * move : 0;
    if (this.state !== 'special' || this.special?.type !== 'charge' || this.special.phase !== 'go') {
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    }
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-7 * dt));
    if (this.isBoss) {
      // Bosses stay in their arena.
      const ax = this.pos.x - this.arena.x, az = this.pos.z - this.arena.z;
      const ad = Math.hypot(ax, az);
      if (ad > this.arena.r - 1) { this.pos.x = this.arena.x + (ax / ad) * (this.arena.r - 1); this.pos.z = this.arena.z + (az / ad) * (this.arena.r - 1); }
    } else {
      world.resolveCollision(this.pos, this.radius * 0.8);
    }
    // Don't overlap the player.
    if (pl.alive) {
      const px = this.pos.x - pl.pos.x, pz = this.pos.z - pl.pos.z;
      const pd = Math.hypot(px, pz), min = this.radius + pl.radius;
      if (pd < min && pd > 0.001) {
        this.pos.x = pl.pos.x + (px / pd) * min;
        this.pos.z = pl.pos.z + (pz / pd) * min;
      }
    }
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (faceYaw === null && hs > 0.3) faceYaw = Math.atan2(this.vel.x, this.vel.z);
    if (faceYaw !== null) this.yaw = angleLerp(this.yaw, faceYaw, 1 - Math.exp(-10 * dt));

    if (this.action && this.state !== 'windup') {
      this.action.t += dt / this.action.dur;
      if (this.action.t >= 1) this.action = null;
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    animateRig(this.rig, { speed: hs, airborne: false, dashing: false, action: this.action, time: this.time, hit: this.hitT }, dt);

    if (this.bar) {
      const show = this.hp < this.maxHp || this.state === 'chase' || this.state === 'windup';
      this.bar.group.visible = show && distToPlayer < 45;
      if (show) {
        this.bar.group.position.set(this.pos.x, this.pos.y + this.height + 0.35, this.pos.z);
        this.bar.group.quaternion.copy(game.camera.quaternion);
        this.bar.set(this.hp / this.maxHp);
      }
    }
  }

  _startWindup(kind) {
    this.state = 'windup';
    this.timer = this.def.windup;
    this.action = { type: kind, t: 0, dur: this.def.windup, windup: true };
    this.game.enemies.attackers++;
    this._counted = true;
    // Eye flare telegraph so kids can see the hit coming.
    this.game.effects.glow(_v2.copy(this.pos).setY(this.pos.y + this.height * 0.85), { color: '#ff3b3b', size: 0.6 * (this.isBoss ? 2 : 1), life: this.def.windup, intensity: 2.5 });
  }

  _attack(d, dirP) {
    const game = this.game;
    const def = this.def;
    if (this._counted) { game.enemies.attackers--; this._counted = false; }
    this.state = 'recover';
    this.timer = 0.5;
    this.cooldown = def.cooldown * (0.8 + Math.random() * 0.5);
    const kind = this.action?.type ?? 'swing';
    this.action = { type: kind, t: 0, dur: 0.35, windup: false };
    if (def.attack === 'ranged') {
      const from = new THREE.Vector3();
      this.rig.root.updateMatrixWorld(true);
      this.rig.muzzle.getWorldPosition(from);
      const target = game.player.pos.clone().setY(game.player.pos.y + game.player.height * 0.5);
      game.combat.shoot({ from, dir: target.sub(from), speed: 13, damage: this.damage, team: 'enemy', color: '#ff3355', size: 0.35, life: 2.5 });
      game.audio.play('enemyShoot');
      return;
    }
    // Melee: hits if the player is still in reach and in front.
    const reach = def.range + 0.6 + (this.isBoss ? 1 : 0);
    const facing = Math.sin(this.yaw) * dirP.x + Math.cos(this.yaw) * dirP.z;
    const hitPos = this.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), def.range * 0.6);
    if (kind === 'smash') {
      game.effects.ring(hitPos, { radius: this.isBoss ? 5 : 3, color: '#ffb347', life: 0.4 });
      game.effects.smokePuff(hitPos, 3, 0.8, '#9b8b6e');
      game.audio.play('slam', { vol: 0.5 });
      game.cam.shake(this.isBoss ? 0.4 : 0.15);
    }
    if (d < reach && facing > 0.2) game.player.takeDamage(this.damage, this.pos);
  }

  // ---------------------------------------------------------------- boss specials
  _startSpecial(dirP, d) {
    const order = { kingclank: ['slam', 'volley', 'charge'], megadrill: ['charge', 'slam', 'charge', 'volley'], boombot: ['volley', 'slam', 'volley', 'charge'], rustytitan: ['slam', 'charge', 'volley', 'slam'] }[this.bossDef.id];
    const type = order[this.specialIndex++ % order.length];
    this.state = 'special';
    this.special = { type, t: 0, phase: 'windup', shots: 0 };
    const fx = this.game.effects;
    if (type === 'slam') {
      this.special.dur = 1.4;
      this.action = { type: 'smash', t: 0, dur: 1.4, windup: true };
      this.telegraph = fx.telegraphCircle(this.pos, 7.5, 1.4);
      this.game.audio.play('bossRoar', { vol: 0.6 });
    } else if (type === 'volley') {
      this.special.dur = 0.9;
      this.action = { type: 'shoot', t: 0, dur: 0.9, windup: true };
    } else {
      this.special.dur = 1.1;
      this.special.dir = dirP.clone();
      this.action = { type: 'smash', t: 0, dur: 1.1, windup: true };
      this.telegraph = fx.telegraphLine(this.pos, dirP, 24, 3.2, 1.1);
      this.game.audio.play('bossRoar', { vol: 0.5 });
    }
  }

  _updateSpecial(dt, dirP) {
    const sp = this.special;
    const game = this.game;
    const fx = game.effects;
    sp.t += dt;
    if (sp.type === 'slam') {
      if (sp.phase === 'windup') {
        this.action.t = Math.min(1, sp.t / sp.dur);
        if (sp.t >= sp.dur) {
          sp.phase = 'done';
          this.telegraph = null;
          this.action = { type: 'smash', t: 0, dur: 0.4, windup: false };
          fx.ring(this.pos, { radius: 8.5, color: '#ff7a33', life: 0.6 });
          fx.ring(this.pos, { radius: 5, color: '#ffd23f', life: 0.4 });
          fx.smokePuff(this.pos, 10, 2, '#9b8b6e');
          fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.3), ['#6b5a40', '#7b6b50'], 10, 8, 0.25);
          game.audio.play('slam');
          game.cam.shake(1.0);
          const pl = game.player;
          const pd = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
          const airborne = pl.pos.y > game.world.heightAt(pl.pos.x, pl.pos.z) + 0.7;
          if (pd < 7.5 + pl.radius && !airborne) pl.takeDamage(this.damage * 1.3, this.pos);
          this._endSpecial(0.8);
        }
      }
    } else if (sp.type === 'volley') {
      this.yaw = angleLerp(this.yaw, Math.atan2(dirP.x, dirP.z), 1 - Math.exp(-8 * dt));
      if (sp.phase === 'windup' && sp.t >= sp.dur) { sp.phase = 'fire'; sp.t = 0; }
      if (sp.phase === 'fire' && sp.t >= sp.shots * 0.45 && sp.shots < 2) {
        sp.shots++;
        const from = new THREE.Vector3();
        this.rig.root.updateMatrixWorld(true);
        this.rig.muzzle.getWorldPosition(from);
        const n = 7;
        const base = Math.atan2(dirP.x, dirP.z);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.17 + (sp.shots === 2 ? 0.085 : 0);
          game.combat.shoot({ from, dir: new THREE.Vector3(Math.sin(a), -0.04, Math.cos(a)), speed: 12, damage: this.damage * 0.7, team: 'enemy', color: this.bossDef.eye, size: 0.5, life: 3 });
        }
        fx.flash(from, { radius: 1.5, color: this.bossDef.eye, life: 0.2 });
        game.audio.play('enemyShoot');
        game.audio.play('blast', { vol: 0.6 });
        this.action = { type: 'shoot', t: 0, dur: 0.4, windup: false };
      }
      if (sp.shots >= 2 && sp.t > 1.0) this._endSpecial(0.6);
    } else if (sp.type === 'charge') {
      if (sp.phase === 'windup') {
        this.yaw = Math.atan2(sp.dir.x, sp.dir.z);
        this.action.t = Math.min(1, sp.t / sp.dur);
        if (sp.t >= sp.dur) {
          sp.phase = 'go';
          sp.t = 0;
          sp.hit = false;
          this.telegraph = null;
          this.action = { type: 'swing', t: 0, dur: 0.8, windup: false };
          game.audio.play('dash', { vol: 1 });
        }
      } else if (sp.phase === 'go') {
        this.vel.set(sp.dir.x * 22, 0, sp.dir.z * 22);
        if (Math.random() < 0.6) fx.smokePuff(this.pos, 1, 1, '#9b8b6e');
        const pl = game.player;
        if (!sp.hit && Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < this.radius + pl.radius + 0.6) {
          sp.hit = true;
          pl.takeDamage(this.damage * 1.2, this.pos);
          pl.vel.addScaledVector(sp.dir, 10);
        }
        const ax = this.pos.x - this.arena.x, az = this.pos.z - this.arena.z;
        if (sp.t > 1.1 || Math.hypot(ax, az) > this.arena.r - 1.5) {
          this.vel.set(0, 0, 0);
          game.cam.shake(0.4);
          game.audio.play('slam', { vol: 0.5 });
          // Bonk! The boss gets dizzy - a great time to hit it.
          this.state = 'dizzy';
          this.timer = 2.0;
          this.special = null;
          game.effects.text(this.pos.clone().setY(this.pos.y + this.height + 0.5), 'DIZZY!', { color: '#ffe14d', size: 28, life: 1.4, rise: 0.4 });
        }
      }
    }
  }

  _endSpecial(recover) {
    this.special = null;
    this.state = 'recover';
    this.timer = recover;
    this.specialTimer = 4.5 + Math.random() * 2.5;
  }

  setActive(on) {
    this.active = on;
    this.rig.root.visible = on && this.alive;
    if (!on && this.bar) this.bar.group.visible = false;
    if (!on && this._counted) { this.game.enemies.attackers--; this._counted = false; }
    if (!on && this.state !== 'idle') {
      this.state = 'idle';
      this.action = null;
      this._cancelTelegraph();
      this.pos.copy(this.home);
      this.hp = this.maxHp;
    }
  }

  dispose() {
    disposeRig(this.rig);
    if (this.bar) this.bar.dispose();
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.attackers = 0;
    const world = game.world;
    const rng = Math.random;
    for (const camp of world.camps) {
      const d = Math.hypot(camp.x, camp.z);
      const types = [];
      if (d < 75) {
        types.push('scrapper', 'scrapper');
        if (rng() < 0.4) types.push('zapper');
      } else if (d < 125) {
        types.push('scrapper', 'zapper');
        types.push(rng() < 0.5 ? 'clanker' : 'scrapper');
      } else {
        types.push('scrapper', 'clanker', 'zapper');
        if (rng() < 0.4) types.push('scrapper');
      }
      types.forEach((t, i) => {
        const a = (i / types.length) * Math.PI * 2;
        const home = new THREE.Vector3(camp.x + Math.cos(a) * 3, 0, camp.z + Math.sin(a) * 3);
        home.y = world.heightAt(home.x, home.z);
        const e = new Enemy(game, t, home);
        e.camp = camp;
        this.list.push(e);
      });
    }
    for (const arena of world.arenas) {
      const home = new THREE.Vector3(arena.x, arena.h, arena.z);
      this.list.push(new Enemy(game, 'boss', home, arena.boss, arena));
    }
  }

  rescale(hero) {
    for (const e of this.list) e.rescale(hero);
  }

  get bosses() {
    return this.list.filter((e) => e.isBoss);
  }

  update(dt) {
    const pl = this.game.player;
    for (const e of this.list) {
      const d = Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z);
      if (!e.alive) {
        e.respawnTimer -= dt;
        const far = Math.hypot(e.home.x - pl.pos.x, e.home.z - pl.pos.z) > (e.isBoss ? 45 : 40);
        if (e.respawnTimer <= 0 && far) e.revive();
        continue;
      }
      const shouldBeActive = d < ACTIVE_RANGE;
      if (shouldBeActive !== e.active) e.setActive(shouldBeActive);
      if (!e.active) continue;
      e.update(dt, d);
    }
    // Gentle separation so bots don't stack on top of each other.
    const act = this.list.filter((e) => e.alive && e.active);
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const wa = a.isBoss ? 0.1 : 1, wb = b.isBoss ? 0.1 : 1;
          a.pos.x -= (dx / d) * push * wa; a.pos.z -= (dz / d) * push * wa;
          b.pos.x += (dx / d) * push * wb; b.pos.z += (dz / d) * push * wb;
        }
      }
    }
    if (this.attackers < 0) this.attackers = 0;
  }

  // After the player dies everyone calms down and goes home.
  resetAggro() {
    for (const e of this.list) {
      if (!e.alive) continue;
      if (e._counted) { this.attackers--; e._counted = false; }
      e._cancelTelegraph();
      e.special = null;
      e.action = null;
      e.state = 'return';
    }
    this.attackers = 0;
  }
}

