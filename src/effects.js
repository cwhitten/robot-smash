import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// A pool of instanced particles: glowing sparks (additive) or solid debris.
class ParticlePool {
  constructor(scene, max, geo, mat) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    scene.add(this.mesh);
    this.max = max;
    this.items = [];
  }

  spawn(p) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(p);
  }

  update(dt, heightAt) {
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - p.drag * dt);
      p.pos.addScaledVector(p.vel, dt);
      if (p.bounce && heightAt) {
        const g = heightAt(p.pos.x, p.pos.z) + p.size * 0.5;
        if (p.pos.y < g) {
          p.pos.y = g;
          p.vel.y = Math.abs(p.vel.y) * 0.35;
          p.vel.x *= 0.6; p.vel.z *= 0.6;
          p.spin *= 0.6;
        }
      }
      p.rot += p.spin * dt;
      items[w++] = p;
    }
    items.length = w;
    const mesh = this.mesh;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const f = Math.min(1, p.life / p.maxLife);
      const sc = p.size * (p.shrink ? f : 1) * (p.grow ? 1 + (1 - f) * p.grow : 1);
      _q.setFromAxisAngle(p.axis, p.rot);
      _s.set(sc * (p.stretch || 1), sc, sc);
      if (p.stretch) _q.setFromUnitVectors(_v.set(1, 0, 0), _v.copy(p.vel).normalize());
      _m.compose(p.pos, _q, _s);
      mesh.setMatrixAt(i, _m);
      const fade = p.fade ? f : 1;
      mesh.setColorAt(i, _c.copy(p.color).multiplyScalar(fade * p.intensity));
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.scene = scene;
    this.sparks = new ParticlePool(scene, 900, new THREE.BoxGeometry(1, 0.35, 0.35),
      new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glows = new ParticlePool(scene, 300, new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const debrisMat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.4 });
    this.debris = new ParticlePool(scene, 400, new THREE.BoxGeometry(1, 0.6, 0.8), debrisMat);
    this.debris.mesh.castShadow = true;
    this.smoke = new ParticlePool(scene, 200, new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, envMapIntensity: 0.2 }));

    // Expanding rings / flashes (individual meshes, pooled).
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
    this.flashGeo = new THREE.SphereGeometry(1, 24, 16);
    this.transients = [];
    this.telegraphs = [];
    this.beams = [];

    this.textLayer = document.getElementById('floaters');
    this.texts = [];
  }

  // ---------------------------------------------------------------- particles
  burst(pos, { count = 12, color = '#ffcc66', speed = 8, size = 0.12, life = 0.45, gravity = 12, intensity = 3, up = 0.3, spread = 1 } = {}) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.5 + up, Math.random() - 0.5).normalize();
      dir.x *= spread; dir.z *= spread;
      const l = life * (0.6 + Math.random() * 0.6);
      this.sparks.spawn({
        pos: pos.clone(), vel: dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8)),
        life: l, maxLife: l, size: size * (0.6 + Math.random() * 0.8), color: col, intensity,
        gravity, drag: 1.5, rot: 0, spin: 0, axis: UP, shrink: true, fade: true, stretch: 2.5,
      });
    }
  }

  glow(pos, { color = '#ffffff', size = 0.5, life = 0.3, intensity = 2, vel = null, grow = 0, gravity = 0 } = {}) {
    this.glows.spawn({
      pos: pos.clone(), vel: vel ? vel.clone() : new THREE.Vector3(), life, maxLife: life, size,
      color: new THREE.Color(color), intensity, gravity, drag: 2, rot: 0, spin: 0, axis: UP, shrink: !grow, grow, fade: true,
    });
  }

  debrisBurst(pos, colors, count = 10, power = 7, size = 0.22) {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).normalize();
      const l = 1.6 + Math.random() * 1.2;
      this.debris.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.6, (Math.random() - 0.5) * 0.6)),
        vel: dir.multiplyScalar(power * (0.5 + Math.random() * 0.8)), life: l, maxLife: l,
        size: size * (0.5 + Math.random()), color: new THREE.Color(colors[i % colors.length]), intensity: 1,
        gravity: 20, drag: 0.4, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 18,
        axis: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), shrink: true, bounce: true,
      });
    }
  }

  smokePuff(pos, count = 6, size = 1.2, color = '#6a6a6a') {
    for (let i = 0; i < count; i++) {
      const l = 1 + Math.random() * 0.8;
      this.smoke.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * size, Math.random() * size * 0.5, (Math.random() - 0.5) * size)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
        life: l, maxLife: l, size: size * (0.5 + Math.random() * 0.5), color: new THREE.Color(color), intensity: 1,
        gravity: -0.5, drag: 1.2, rot: 0, spin: 0, axis: UP, grow: 1.8, shrink: true,
      });
    }
  }

  // ---------------------------------------------------------------- one-shot meshes
  _transient(mesh, life, update) {
    this.scene.add(mesh);
    this.transients.push({ mesh, life, maxLife: life, update });
  }

  ring(pos, { radius = 6, color = '#ffaa33', life = 0.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mat.color.multiplyScalar(4);
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos);
    m.position.y += 0.15;
    this._transient(m, life, (mesh, f) => {
      const s = Math.max(0.01, radius * easeOut(1 - f));
      mesh.scale.set(s, 1, s);
      mesh.material.opacity = f;
    });
  }

  flash(pos, { radius = 3, color = '#ffbb55', life = 0.35 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    mat.color.multiplyScalar(4);
    const m = new THREE.Mesh(this.flashGeo, mat);
    m.position.copy(pos);
    this._transient(m, life, (mesh, f) => {
      mesh.scale.setScalar(radius * (0.3 + easeOut(1 - f) * 0.9));
      mesh.material.opacity = f * f;
    });
  }

  explosion(pos, radius = 4, color = '#ff9933', big = false) {
    this.flash(pos, { radius: radius * 0.8, color, life: 0.4 });
    this.flash(pos, { radius: radius * 0.4, color: '#ffffee', life: 0.2 });
    this.ring(this._ground(pos), { radius: radius * 1.3, color, life: 0.55 });
    this.burst(pos, { count: big ? 50 : 26, color, speed: radius * 4, size: 0.2, life: 0.7, gravity: 6, up: 0.1, intensity: 4 });
    this.burst(pos, { count: big ? 20 : 10, color: '#ffffaa', speed: radius * 2.5, size: 0.12, life: 0.5, intensity: 5 });
    this.smokePuff(pos, big ? 12 : 6, radius * 0.5, '#6b6b6b');
    this.game.audio.play('explosion', { big });
    this.game.cam.shake(big ? 0.9 : 0.45);
  }

  _ground(pos) {
    return new THREE.Vector3(pos.x, this.game.world.heightAt(pos.x, pos.z), pos.z);
  }

  // Ground warning circle that fills up before a boss attack lands.
  telegraphCircle(pos, radius, duration, color = '#ff2a2a') {
    const g = new THREE.Group();
    const p = this._ground(pos);
    g.position.set(p.x, p.y + 0.12, p.z);
    const edge = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    edge.scale.set(radius, 1, radius);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
    fill.position.y = 0.02;
    g.add(edge, fill);
    this.scene.add(g);
    const t = { obj: g, life: duration, maxLife: duration, update: (f) => { const s = Math.max(0.01, radius * (1 - f)); fill.scale.set(s, 1, s); edge.material.opacity = 0.5 + 0.5 * Math.sin((1 - f) * 30); } };
    this.telegraphs.push(t);
    return t;
  }

  telegraphLine(from, dir, length, width, duration, color = '#ff2a2a') {
    const g = new THREE.Group();
    const p = this._ground(from);
    g.position.set(p.x, p.y + 0.2, p.z);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    const geo = new THREE.PlaneGeometry(width, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
    back.scale.z = length;
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
    fill.position.y = 0.03;
    g.add(back, fill);
    this.scene.add(g);
    const t = { obj: g, life: duration, maxLife: duration, update: (f) => { fill.scale.z = Math.max(0.01, length * (1 - f)); } };
    this.telegraphs.push(t);
    return t;
  }

  removeTelegraph(t) {
    t.life = 0;
  }

  // ---------------------------------------------------------------- beams
  beam(from, to, { color = '#ff3030', width = 0.25, life = 0.18 } = {}) {
    const b = this._makeBeam(color, width);
    this.setBeam(b, from, to);
    this.scene.add(b.group);
    this.beams.push({ b, life, maxLife: life });
    return b;
  }

  persistentBeam(color, width) {
    const b = this._makeBeam(color, width);
    this.scene.add(b.group);
    return b;
  }

  _makeBeam(color, width) {
    const group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    coreMat.color.multiplyScalar(4);
    const outerMat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    outerMat.color.multiplyScalar(4);
    const core = new THREE.Mesh(geo, coreMat);
    const outer = new THREE.Mesh(geo, outerMat);
    group.add(core, outer);
    const endGlow = new THREE.Mesh(this.flashGeo, outerMat);
    group.add(endGlow);
    return { group, core, outer, endGlow, width, geo };
  }

  setBeam(b, from, to, widthMul = 1) {
    const len = from.distanceTo(to);
    b.group.position.copy(from);
    b.group.lookAt(to);
    const w = b.width * widthMul;
    b.core.scale.set(w * 0.35, w * 0.35, len);
    b.outer.scale.set(w, w, len);
    b.endGlow.position.set(0, 0, len);
    b.endGlow.scale.setScalar(w * 2.2);
  }

  removeBeam(b) {
    b.group.removeFromParent();
    b.geo.dispose();
    b.core.material.dispose();
    b.outer.material.dispose();
  }

  // ---------------------------------------------------------------- floating text
  text(pos, str, { color = '#ffffff', size = 22, life = 0.9, rise = 1.6 } = {}) {
    if (this.texts.length > 40) {
      const old = this.texts.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = str;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.textLayer.appendChild(el);
    this.texts.push({ el, pos: pos.clone(), life, maxLife: life, rise });
  }

  // ---------------------------------------------------------------- update
  update(dt, camera) {
    const h = (x, z) => this.game.world.heightAt(x, z);
    this.sparks.update(dt);
    this.glows.update(dt);
    this.debris.update(dt, h);
    this.smoke.update(dt);

    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.removeFromParent();
        t.mesh.material.dispose();
        this.transients.splice(i, 1);
        continue;
      }
      t.update(t.mesh, t.life / t.maxLife);
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.obj.removeFromParent();
        t.obj.traverse((c) => { if (c.isMesh) { c.material.dispose(); if (c.geometry !== this.ringGeo) c.geometry.dispose(); } });
        this.telegraphs.splice(i, 1);
        continue;
      }
      t.update(t.life / t.maxLife);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bb = this.beams[i];
      bb.life -= dt;
      const f = bb.life / bb.maxLife;
      bb.b.outer.material.opacity = 0.7 * f;
      bb.b.core.scale.x = bb.b.core.scale.y = bb.b.width * 0.35 * f;
      if (bb.life <= 0) {
        this.removeBeam(bb.b);
        this.beams.splice(i, 1);
      }
    }

    const w = window.innerWidth, hh = window.innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.el.remove();
        this.texts.splice(i, 1);
        continue;
      }
      t.pos.y += t.rise * dt;
      _v.copy(t.pos).project(camera);
      if (_v.z > 1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      const f = t.life / t.maxLife;
      const pop = 1 + Math.max(0, f - 0.8) * 2.5;
      t.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * hh}px) translate(-50%, -50%) scale(${pop})`;
      t.el.style.opacity = Math.min(1, f * 2.5);
    }
  }
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}
