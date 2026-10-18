import * as THREE from 'three';
import { ECONOMY } from './config.js';

const MAX_COINS = 260;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Pickups {
  constructor(game) {
    this.game = game;
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 28).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffc933', metalness: 1, roughness: 0.18, emissive: '#ff9a00', emissiveIntensity: 0.35 });
    this.coinMesh = new THREE.InstancedMesh(geo, mat, MAX_COINS);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.castShadow = true;
    game.scene.add(this.coinMesh);

    this.coins = game.world.coinSpots.map((p) => ({
      pos: new THREE.Vector3(p.x, game.world.heightAt(p.x, p.z) + 0.9, p.z),
      base: game.world.heightAt(p.x, p.z) + 0.9,
      vel: new THREE.Vector3(),
      value: ECONOMY.mapCoinValue,
      kind: 'map',
      active: true,
      respawn: 0,
      phase: Math.random() * 10,
    }));

    this.heartGeo = new THREE.OctahedronGeometry(0.35, 0);
    this.heartMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#3dff6e', emissiveIntensity: 2.5 });
    this.hearts = [];
    this.coinStreak = 0;
    this.streakTimer = 0;
  }

  dropCoins(pos, total) {
    const n = Math.max(3, Math.min(12, Math.ceil(total / 2)));
    let left = total;
    for (let i = 0; i < n; i++) {
      const v = i === n - 1 ? left : Math.max(1, Math.floor(total / n));
      left -= v;
      if (v <= 0) continue;
      const a = Math.random() * Math.PI * 2;
      this.coins.push({
        pos: pos.clone().add(new THREE.Vector3(0, 1, 0)),
        vel: new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 3), 6 + Math.random() * 4, Math.sin(a) * (2 + Math.random() * 3)),
        value: v, kind: 'drop', active: true, age: 0, phase: Math.random() * 10,
      });
    }
    // Keep the instanced buffer bounded.
    while (this.coins.length > MAX_COINS) {
      const idx = this.coins.findIndex((c) => c.kind === 'drop');
      this.game.addCoins(this.coins[idx].value, null);
      this.coins.splice(idx, 1);
    }
  }

  dropHealth(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.heartGeo, this.heartMat);
      const a = Math.random() * Math.PI * 2;
      const h = {
        mesh: m, pos: pos.clone().add(new THREE.Vector3(0, 1, 0)),
        vel: new THREE.Vector3(Math.cos(a) * 2, 7, Math.sin(a) * 2), age: 0,
      };
      m.position.copy(h.pos);
      this.game.scene.add(m);
      this.hearts.push(h);
    }
  }

  update(dt) {
    const game = this.game;
    const pl = game.player;
    const world = game.world;
    const t = world.time.value;
    const target = _v.copy(pl.pos);
    target.y += pl.height * 0.5;
    this.streakTimer -= dt;
    if (this.streakTimer <= 0) this.coinStreak = 0;

    let n = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.kind === 'map' && !c.active) {
        c.respawn -= dt;
        if (c.respawn <= 0) c.active = true;
        continue;
      }
      const d = c.pos.distanceTo(target);
      if (c.kind === 'map') {
        c.pos.y = c.base + Math.sin(t * 2 + c.phase) * 0.15;
        if (pl.alive && d < 3.5) {
          c.pos.lerp(target, Math.min(1, dt * 10));
          c.base = c.pos.y;
        }
      } else {
        c.age += dt;
        const ground = world.heightAt(c.pos.x, c.pos.z) + 0.45;
        if (c.age > 0.45 && pl.alive && d < 10) {
          // Magnet towards the player.
          const pull = _s.subVectors(target, c.pos).normalize().multiplyScalar(14 + c.age * 10);
          c.vel.lerp(pull, Math.min(1, dt * 8));
        } else {
          c.vel.y -= 22 * dt;
        }
        c.pos.addScaledVector(c.vel, dt);
        if (c.pos.y < ground && !(c.age > 0.45 && d < 10)) {
          c.pos.y = ground;
          c.vel.y = Math.abs(c.vel.y) * 0.4;
          c.vel.x *= 0.7; c.vel.z *= 0.7;
        }
        if (c.age > 40) {
          this.coins.splice(i, 1);
          continue;
        }
      }
      if (pl.alive && c.pos.distanceTo(target) < 1.1) {
        this.coinStreak++;
        this.streakTimer = 0.6;
        game.addCoins(c.value, c.pos);
        game.audio.play('coin', { pitch: 1 + Math.min(this.coinStreak, 12) * 0.04 });
        game.effects.burst(c.pos, { count: 5, color: '#ffd84a', speed: 3, size: 0.07, life: 0.3, gravity: 0 });
        if (c.kind === 'map') {
          c.active = false;
          c.respawn = ECONOMY.mapCoinRespawn;
          c.base = world.heightAt(c.pos.x, c.pos.z) + 0.9;
        } else {
          this.coins.splice(i, 1);
        }
        continue;
      }
    }
    for (const c of this.coins) {
      if (c.kind === 'map' && !c.active) continue;
      _e.set(0, t * 3 + c.phase, 0);
      _q.setFromEuler(_e);
      _m.compose(c.pos, _q, _s.setScalar(c.kind === 'map' ? 1.15 : 0.9));
      this.coinMesh.setMatrixAt(n++, _m);
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.age += dt;
      const ground = world.heightAt(h.pos.x, h.pos.z) + 0.8;
      const d = h.pos.distanceTo(target);
      if (h.age > 0.6 && pl.alive && d < 5 && pl.hp < pl.maxHp) {
        h.vel.lerp(_s.subVectors(target, h.pos).normalize().multiplyScalar(12), Math.min(1, dt * 6));
      } else {
        h.vel.y -= 18 * dt;
        h.vel.x *= 1 - dt * 2; h.vel.z *= 1 - dt * 2;
      }
      h.pos.addScaledVector(h.vel, dt);
      if (h.pos.y < ground) { h.pos.y = ground; h.vel.y = Math.abs(h.vel.y) * 0.3; }
      h.mesh.position.copy(h.pos);
      h.mesh.position.y += Math.sin(t * 3 + i) * 0.1;
      h.mesh.rotation.y += dt * 2;
      if (pl.alive && d < 1.2 && pl.hp < pl.maxHp) {
        pl.heal(pl.maxHp * 0.3);
        game.audio.play('heal');
        game.effects.burst(h.pos, { count: 14, color: '#3dff6e', speed: 4, size: 0.1, gravity: -2 });
        h.mesh.removeFromParent();
        this.hearts.splice(i, 1);
      } else if (h.age > 45) {
        h.mesh.removeFromParent();
        this.hearts.splice(i, 1);
      }
    }
  }
}
