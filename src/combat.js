import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _closest = new THREE.Vector3();

function starGeometry(r1, r2, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.center();
  return g;
}

/** Distance from point p to a vertical capsule standing at base with given height. */
export function capsuleDist(p, base, height) {
  const y = Math.min(Math.max(p.y, base.y + 0.2), base.y + height - 0.2);
  _closest.set(base.x, y, base.z);
  return p.distanceTo(_closest);
}

/** Distance from point p to segment ab. */
export function segDist(p, a, b) {
  _v.subVectors(b, a);
  const t = Math.min(1, Math.max(0, _v2.subVectors(p, a).dot(_v) / _v.lengthSq()));
  return _v2.copy(a).addScaledVector(_v, t).distanceTo(p);
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.orbGeo = new THREE.SphereGeometry(1, 16, 12);
    this.starGeo = starGeometry(0.5, 0.22, 0.12);
    const body = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.12, 0.3, 10).rotateX(Math.PI / 2).translate(0, 0, 0.55);
    this.rocketBody = body;
    this.rocketNose = nose;
    this.rocketMat = new THREE.MeshStandardMaterial({ color: '#f0f0f0', metalness: 0.6, roughness: 0.3 });
    this.rocketNoseMat = new THREE.MeshStandardMaterial({ color: '#e63946', metalness: 0.4, roughness: 0.35 });
  }

  _orbMesh(color, size) {
    const g = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    coreMat.color.multiplyScalar(4);
    const haloMat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    haloMat.color.multiplyScalar(4);
    const core = new THREE.Mesh(this.orbGeo, coreMat);
    core.scale.setScalar(size * 0.55);
    const halo = new THREE.Mesh(this.orbGeo, haloMat);
    halo.scale.setScalar(size);
    g.add(core, halo);
    return g;
  }

  /**
   * opts: { from, dir, speed, damage, team: 'player'|'enemy', kind: 'orb'|'star'|'rocket',
   *         color, size, life, gravity, homing (enemy), turn, explode: radius, pierce }
   */
  shoot(opts) {
    const p = {
      pos: opts.from.clone(),
      vel: opts.dir.clone().normalize().multiplyScalar(opts.speed),
      speed: opts.speed,
      damage: opts.damage,
      team: opts.team,
      kind: opts.kind ?? 'orb',
      color: new THREE.Color(opts.color ?? '#66ccff'),
      size: opts.size ?? 0.35,
      life: opts.life ?? 2.5,
      gravity: opts.gravity ?? 0,
      homing: opts.homing ?? null,
      turn: opts.turn ?? 0,
      explode: opts.explode ?? 0,
      pierce: opts.pierce ?? false,
      hitSet: new Set(),
      trail: 0,
      onHit: opts.onHit,
    };
    if (p.kind === 'star') {
      const mat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffd23f', emissiveIntensity: 3 });
      p.mesh = new THREE.Mesh(this.starGeo, mat);
      p.mesh.scale.setScalar(p.size * 1.6);
    } else if (p.kind === 'rocket') {
      p.mesh = new THREE.Group();
      p.mesh.add(new THREE.Mesh(this.rocketBody, this.rocketMat), new THREE.Mesh(this.rocketNose, this.rocketNoseMat));
      const flame = this._orbMesh('#ff8a00', 0.22);
      flame.position.z = -0.5;
      p.mesh.add(flame);
      p.mesh.scale.setScalar(1.4);
    } else {
      p.mesh = this._orbMesh(p.color, p.size);
    }
    p.mesh.position.copy(p.pos);
    this.game.scene.add(p.mesh);
    this.projectiles.push(p);
    return p;
  }

  _remove(p, i) {
    p.mesh.removeFromParent();
    p.mesh.traverse((c) => {
      if (c.isMesh && c.material !== this.rocketMat && c.material !== this.rocketNoseMat) c.material.dispose();
    });
    this.projectiles.splice(i, 1);
  }

  _impact(p) {
    const fx = this.game.effects;
    if (p.explode) {
      this.areaDamage(p.pos, p.explode, p.damage, p.team, 9);
      fx.explosion(p.pos, p.explode * 0.7, p.kind === 'rocket' ? '#ff8a2a' : `#${p.color.getHexString()}`, p.kind === 'rocket');
    } else {
      fx.burst(p.pos, { count: 10, color: `#${p.color.getHexString()}`, speed: 7, size: 0.1, intensity: 4 });
      fx.flash(p.pos, { radius: p.size * 2.5, color: `#${p.color.getHexString()}`, life: 0.18 });
    }
  }

  update(dt) {
    const game = this.game;
    const world = game.world;
    const fx = game.effects;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      // Homing towards a target enemy (rockets / player blasts get a gentle assist).
      if (p.homing && p.homing.alive) {
        _v.copy(p.homing.pos);
        _v.y += p.homing.height * 0.5;
        _v.sub(p.pos).normalize().multiplyScalar(p.speed);
        p.vel.lerp(_v, Math.min(1, p.turn * dt));
        p.vel.setLength(p.speed);
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind === 'star') p.mesh.rotation.z += dt * 18;
      if (p.kind === 'rocket') {
        p.mesh.lookAt(_v.copy(p.pos).add(p.vel));
        p.speed = Math.min(p.speed + dt * 30, 45);
      }
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.025;
        if (p.kind === 'rocket') {
          fx.glow(p.pos, { color: '#ff9a3a', size: 0.45, life: 0.25, intensity: 3 });
          if (Math.random() < 0.5) fx.smokePuff(p.pos, 1, 0.35, '#7a7a7a');
        } else {
          fx.glow(p.pos, { color: `#${p.color.getHexString()}`, size: p.size * 0.8, life: 0.15, intensity: 2.5 });
        }
      }

      let done = p.life <= 0;
      const ground = world.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y < ground + 0.05) done = true;

      if (!done && p.team === 'player') {
        for (const e of game.enemies.list) {
          if (!e.alive || !e.active || p.hitSet.has(e)) continue;
          if (capsuleDist(p.pos, e.pos, e.height) < e.radius + p.size) {
            if (p.explode) { done = true; break; }
            p.hitSet.add(e);
            _v2.copy(p.vel).setY(0).normalize();
            e.takeDamage(p.damage, _v2, 4);
            if (p.onHit) p.onHit(e);
            if (!p.pierce) { done = true; break; }
            fx.burst(p.pos, { count: 6, color: `#${p.color.getHexString()}`, speed: 6, size: 0.1 });
          }
        }
      } else if (!done && p.team === 'enemy') {
        const pl = game.player;
        if (pl.alive && capsuleDist(p.pos, pl.pos, pl.height) < pl.radius + p.size) {
          pl.takeDamage(p.damage, p.pos);
          done = true;
        }
      }

      if (done) {
        if (p.life > 0 || p.explode) this._impact(p);
        this._remove(p, i);
      }
    }
  }

  areaDamage(center, radius, damage, team, knock = 6) {
    const game = this.game;
    if (team === 'player') {
      for (const e of game.enemies.list) {
        if (!e.alive || !e.active) continue;
        const d = capsuleDist(center, e.pos, e.height);
        if (d < radius + e.radius) {
          _v.subVectors(e.pos, center).setY(0).normalize();
          e.takeDamage(damage * (1 - 0.4 * Math.min(1, d / radius)), _v, knock);
        }
      }
    } else {
      const pl = game.player;
      if (pl.alive && capsuleDist(center, pl.pos, pl.height) < radius + pl.radius) pl.takeDamage(damage, center);
    }
  }

  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._remove(this.projectiles[i], i);
  }
}
