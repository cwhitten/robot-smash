import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, fbm, ridged, smoothstep, clamp, lerp, mulberry32 } from './noise.js';
import { WORLD, BOSSES } from './config.js';

const TAU = Math.PI * 2;
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

const COL = {
  grassA: new THREE.Color('#3f6f22'),
  grassB: new THREE.Color('#6a9a34'),
  grassDry: new THREE.Color('#9a9a48'),
  forest: new THREE.Color('#2f4f1c'),
  dirt: new THREE.Color('#7b5b3b'),
  arena: new THREE.Color('#8d7b5c'),
  rock: new THREE.Color('#6c6862'),
  rockDark: new THREE.Color('#4a4744'),
  snow: new THREE.Color('#f4f6fa'),
};

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.noise = makeNoise2D(WORLD.seed);
    this.noise2 = makeNoise2D(WORLD.seed + 7);
    this.rng = mulberry32(WORLD.seed);
    this.time = { value: 0 };
    this.colliders = [];
    this.grid = new Map();
    this.cell = 8;

    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(135));

    this._layout();
    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildHeightTexture();
    this._buildGrass();
    this._buildTrees();
    this._buildRocksAndFlowers();
    this._buildGarage();
    this._buildArenas();
    this._buildCamps();
  }

  // ---------------------------------------------------------------- layout
  _layout() {
    const rng = this.rng;
    this.spawn = new THREE.Vector3(0, 0, 0);
    this.spawnH = this._raw(0, 0);
    this.arenas = BOSSES.map((b) => {
      const a = THREE.MathUtils.degToRad(b.angle);
      const x = Math.cos(a) * WORLD.arenaDistance;
      const z = Math.sin(a) * WORLD.arenaDistance;
      return { x, z, r: WORLD.arenaRadius, h: this._raw(x, z), boss: b };
    });
    this.paths = this.arenas.map((a) => ({ ax: 0, az: 0, bx: a.x, bz: a.z }));
    this.garagePos = new THREE.Vector3(-22, 0, -6);

    // Scrap camps where the regular bad bots hang out.
    this.camps = [];
    let tries = 0;
    while (this.camps.length < 20 && tries++ < 4000) {
      const a = rng() * TAU;
      const d = 42 + Math.sqrt(rng()) * 125;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.arenas.some((ar) => Math.hypot(ar.x - x, ar.z - z) < ar.r + 22)) continue;
      if (this.camps.some((c) => Math.hypot(c.x - x, c.z - z) < 26)) continue;
      this.camps.push({ x, z, r: 7, tier: d });
    }

    // Shiny coins lying around waiting to be collected.
    this.coinSpots = [];
    tries = 0;
    while (this.coinSpots.length < 70 && tries++ < 4000) {
      const a = rng() * TAU;
      const d = 12 + Math.sqrt(rng()) * 165;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.hypot(x - this.garagePos.x, z - this.garagePos.z) < 9) continue;
      this.coinSpots.push(new THREE.Vector3(x, 0, z));
    }
  }

  _raw(x, z) {
    const n = this.noise;
    return fbm(n, x * 0.0065, z * 0.0065, 4) * 11 + n(x * 0.035 + 50, z * 0.035 - 20) * 0.9;
  }

  heightAt(x, z) {
    let h = this._raw(x, z);
    const d = Math.hypot(x, z);
    h = lerp(this.spawnH, h, smoothstep(20, 48, d));
    for (const a of this.arenas) {
      const da = Math.hypot(x - a.x, z - a.z);
      if (da < a.r + 22) h = lerp(a.h, h, smoothstep(a.r + 1, a.r + 20, da));
    }
    const pr = WORLD.playRadius;
    if (d > pr - 30) {
      const m = smoothstep(pr - 20, pr + 130, d);
      h += smoothstep(pr - 30, pr + 15, d) * 9;
      h += m * m * (35 + ridged(this.noise2, x * 0.0042 + 7, z * 0.0042 - 3, 5) * 160);
    }
    return h;
  }

  pathMask(x, z) {
    const wx = x + this.noise(x * 0.02 + 3, z * 0.02) * 6;
    const wz = z + this.noise(x * 0.02, z * 0.02 + 9) * 6;
    let md = 1e9;
    for (const p of this.paths) {
      const dx = p.bx - p.ax, dz = p.bz - p.az;
      const t = clamp(((wx - p.ax) * dx + (wz - p.az) * dz) / (dx * dx + dz * dz), 0, 1);
      md = Math.min(md, Math.hypot(wx - (p.ax + dx * t), wz - (p.az + dz * t)));
    }
    return 1 - smoothstep(1.4, 3.2, md);
  }

  arenaMask(x, z) {
    let m = 0;
    for (const a of this.arenas) m = Math.max(m, 1 - smoothstep(a.r - 3, a.r + 2, Math.hypot(x - a.x, z - a.z)));
    return m;
  }

  forestDensity(x, z) {
    return fbm(this.noise2, x * 0.012 + 11, z * 0.012 - 4, 3) * 0.5 + 0.5;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  terrainColor(x, z, y, ny, out) {
    const n = this.noise;
    out.copy(COL.grassA).lerp(COL.grassB, n(x * 0.045, z * 0.045) * 0.5 + 0.5);
    out.lerp(COL.grassDry, smoothstep(0.25, 0.85, n(x * 0.009 + 40, z * 0.009)) * 0.55);
    out.lerp(COL.forest, smoothstep(0.55, 0.75, this.forestDensity(x, z)) * 0.6);
    const d = Math.hypot(x, z);
    if (d < WORLD.playRadius + 10) {
      out.lerp(COL.dirt, this.pathMask(x, z) * 0.9);
      out.lerp(COL.arena, this.arenaMask(x, z) * 0.75);
    }
    const mountain = smoothstep(WORLD.playRadius, WORLD.playRadius + 90, d);
    out.lerp(COL.forest, mountain * 0.5);
    const rockF = Math.max(smoothstep(0.86, 0.68, ny), mountain * smoothstep(55, 85, y + n(x * 0.03, z * 0.03) * 12));
    out.lerp(n(x * 0.08, z * 0.08) > 0 ? COL.rock : COL.rockDark, rockF);
    out.lerp(COL.snow, smoothstep(105, 125, y + n(x * 0.02, z * 0.02) * 14) * smoothstep(0.5, 0.75, ny));
    return out;
  }

  // ---------------------------------------------------------------- sky & light
  _buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.86;
    u.cloudCoverage.value = 0.42;
    u.cloudDensity.value = 0.45;
    u.cloudScale.value = 0.00018;
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);

    // Image-based lighting from the same sky so robots get real reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value;
    envSky.material.uniforms.cloudCoverage.value = 0.0;
    envScene.add(envSky);
    // A green ground hemisphere so the bottom of shiny robots reflects grass, not sky.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16, 0, TAU, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2c4418', side: THREE.BackSide }),
    );
    envScene.add(ground);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.scene.fog = new THREE.FogExp2('#b4c8d8', 0.0021);
  }

  _buildLights() {
    const sun = new THREE.DirectionalLight('#fff1dc', 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48;
    sc.near = 1; sc.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const hemi = new THREE.HemisphereLight('#bcd4ff', '#4a5a2a', 0.35);
    this.scene.add(hemi);
  }

  // ---------------------------------------------------------------- terrain
  _detailTexture() {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(s, s);
    const rng = mulberry32(99);
    const field = new Float32Array(s * s);
    // Tileable value noise: random lattices that wrap, summed over octaves.
    for (const [cells, amp] of [[4, 0.35], [8, 0.3], [16, 0.2], [32, 0.15], [64, 0.12], [128, 0.08]]) {
      const lat = new Float32Array(cells * cells).map(() => rng() * 2 - 1);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const fx = (x / s) * cells, fy = (y / s) * cells;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = smoothstep(0, 1, fx - x0), ty = smoothstep(0, 1, fy - y0);
          const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
          const a = lerp(lat[y0 * cells + x0], lat[y0 * cells + x1], tx);
          const b = lerp(lat[y1 * cells + x0], lat[y1 * cells + x1], tx);
          field[y * s + x] += lerp(a, b, ty) * amp;
        }
      }
    }
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = field[y * s + x];
        const g = clamp(200 + v * 90 + (rng() - 0.5) * 26, 110, 255);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _terrainMesh(size, seg, offset, detail) {
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)) + offset);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      this.terrainColor(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i), _c);
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      map: detail,
      bumpMap: detail,
      bumpScale: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  _buildTerrain() {
    const detail = this._detailTexture();
    this.terrain = this._terrainMesh(WORLD.terrainSize, 256, 0, detail);
    this.scene.add(this.terrain);
    const far = this._terrainMesh(1900, 240, -1.6, detail);
    far.receiveShadow = false;
    this.scene.add(far);
  }

  _buildHeightTexture() {
    const res = 256;
    const size = WORLD.terrainSize;
    const data = new Uint16Array(res * res * 4);
    const nrm = new THREE.Vector3();
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = (i / (res - 1) - 0.5) * size;
        const z = (j / (res - 1) - 0.5) * size;
        const h = this.heightAt(x, z);
        this.normalAt(x, z, nrm);
        const d = Math.hypot(x, z);
        let mask = (1 - this.pathMask(x, z)) * (1 - this.arenaMask(x, z));
        mask *= smoothstep(0.72, 0.85, nrm.y) * (1 - smoothstep(WORLD.playRadius + 5, WORLD.playRadius + 30, d));
        mask *= smoothstep(4.5, 7, Math.hypot(x - this.garagePos.x, z - this.garagePos.z));
        mask *= smoothstep(3.5, 5, d); // keep the spawn pad clear
        const k = (j * res + i) * 4;
        data[k] = THREE.DataUtils.toHalfFloat(h);
        data[k + 1] = THREE.DataUtils.toHalfFloat(mask);
        data[k + 2] = THREE.DataUtils.toHalfFloat(this.forestDensity(x, z));
        data[k + 3] = THREE.DataUtils.toHalfFloat(1);
      }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    // Texel centres sit at (i/(res-1)), so remap uv in the shader accordingly.
    this.heightTex = tex;
    this.heightRes = res;
  }

  // ---------------------------------------------------------------- grass
  _buildGrass() {
    const BLADES = 90000;
    const PATCH = 72;
    // A single tapered blade, 1 unit tall.
    const w = 0.07;
    const verts = [
      -w, 0, 0, w, 0, 0,
      -w * 0.8, 0.35, 0, w * 0.8, 0.35, 0,
      -w * 0.5, 0.7, 0, w * 0.5, 0.7, 0,
      0, 1, 0,
    ];
    const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    base.setIndex(idx);
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const t = verts[i * 3 + 1];
      _c.set('#1d3a0c').lerp(_c2.set('#6f9a35'), Math.pow(t, 1.1));
      cols.push(_c.r, _c.g, _c.b);
    }
    base.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(21).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.color = base.attributes.color;
    geo.attributes.normal = base.attributes.normal;
    const offs = new Float32Array(BLADES * 2);
    const params = new Float32Array(BLADES * 3);
    const r = mulberry32(5);
    for (let i = 0; i < BLADES; i++) {
      offs[i * 2] = r() * PATCH;
      offs[i * 2 + 1] = r() * PATCH;
      params[i * 3] = r() * TAU;
      params[i * 3 + 1] = 0.22 + r() * r() * 0.42;
      params[i * 3 + 2] = r();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 2));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 3));
    geo.instanceCount = BLADES;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.35,
    });
    this.grassUniforms = {
      uCenter: { value: new THREE.Vector2() },
      uPlayer: { value: new THREE.Vector2(9999, 9999) },
      uPatch: { value: PATCH },
      uHeight: { value: this.heightTex },
      uTerrainSize: { value: WORLD.terrainSize },
      uRes: { value: this.heightRes },
      uTime: this.time,
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.grassUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform vec2 uCenter; uniform vec2 uPlayer; uniform float uPatch;
          uniform sampler2D uHeight; uniform float uTerrainSize; uniform float uRes; uniform float uTime;
          attribute vec2 aOffset; attribute vec3 aParams;`)
        .replace('#include <beginnormal_vertex>', `
          vec2 wp = uCenter + mod(aOffset - uCenter + uPatch * 0.5, uPatch) - uPatch * 0.5;
          vec2 huv = (wp / uTerrainSize + 0.5) * (uRes - 1.0) / uRes + 0.5 / uRes;
          vec4 hm = texture2D(uHeight, huv);
          vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + 0.15 * vec3(cos(aParams.x), 0.0, sin(aParams.x)));`)
        .replace('#include <begin_vertex>', `
          float fade = 1.0 - smoothstep(uPatch * 0.36, uPatch * 0.5, length(wp - uCenter));
          float tall = aParams.y * mix(1.0, 1.35, hm.b);
          float s = hm.g * fade * step(0.12, hm.g);
          vec3 transformed = position;
          transformed.y *= tall * s;
          transformed.x *= mix(0.8, 1.4, aParams.z) * s;
          float c = cos(aParams.x), sn = sin(aParams.x);
          transformed.xz = mat2(c, -sn, sn, c) * transformed.xz;
          float bend = position.y * position.y;
          float gust = sin(uTime * 1.7 + wp.x * 0.11 + wp.y * 0.07) * 0.5 + sin(uTime * 3.3 + wp.x * 0.37 + wp.y * 0.21) * 0.2 + 0.25;
          transformed.x += gust * bend * 0.32 * tall;
          transformed.z += gust * bend * 0.14 * tall;
          vec2 away = wp - uPlayer;
          float pd = length(away);
          transformed.xz += (away / max(pd, 0.001)) * (1.0 - smoothstep(0.0, 1.4, pd)) * bend * 0.7 * tall;
          transformed.y -= (1.0 - smoothstep(0.0, 1.2, pd)) * bend * 0.35 * tall;
          transformed += vec3(wp.x, hm.r - 0.04, wp.y);
          #ifdef USE_COLOR
            vColor.rgb *= mix(0.72, 1.18, aParams.z) * mix(vec3(1.0), vec3(1.15, 1.08, 0.65), step(0.85, aParams.z));
          #endif`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.grass = mesh;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- trees
  _swayMaterial(mat, strength) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 ip = instanceMatrix[3].xz;
          #else
            vec2 ip = vec2(0.0);
          #endif
          float sw = pow(max(position.y, 0.0) / 8.0, 2.0) * ${strength.toFixed(3)};
          transformed.x += sin(uTime * 1.3 + ip.x * 0.2 + ip.y * 0.13) * sw;
          transformed.z += sin(uTime * 1.1 + ip.y * 0.2) * sw * 0.6;`);
    };
    return mat;
  }

  _colorize(geo, fn) {
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
      cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo;
  }

  _lumpy(geo, center, amount, freq, seed) {
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    const n = makeNoise2D(seed);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i);
      const dir = _s.copy(_p).sub(center).normalize();
      const k = n(_p.x * freq + _p.y * 0.7, _p.z * freq - _p.y * 0.5) * amount;
      _p.addScaledVector(dir, k);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  _pineGeometry() {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const r = 2.3 - i * 0.42;
      let g = new THREE.ConeGeometry(r, 2.6 - i * 0.15, 12, 3, true);
      g.translate(0, 2.4 + i * 1.25, 0);
      g = this._lumpy(g, new THREE.Vector3(0, 2.4 + i * 1.25, 0), 0.28, 1.6, 10 + i);
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    return this._colorize(geo, (x, y, z, c) => {
      const rr = Math.hypot(x, z);
      c.set('#1c3a1a').lerp(_c2.set('#3f6a2c'), clamp(rr / 2.2 + y / 14, 0, 1));
    });
  }

  _broadleafGeometry() {
    const parts = [];
    const r = mulberry32(42);
    const blobs = [[0, 5.0, 0, 2.1], [1.3, 4.4, 0.4, 1.5], [-1.2, 4.6, -0.5, 1.6], [0.2, 4.3, 1.3, 1.4], [-0.3, 6.2, 0.1, 1.5], [0.4, 4.2, -1.3, 1.3]];
    for (const [x, y, z, s] of blobs) {
      let g = new THREE.IcosahedronGeometry(s, 2);
      g.translate(x, y, z);
      g = this._lumpy(g, new THREE.Vector3(x, y, z), 0.35, 1.3, Math.floor(r() * 1000));
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    return this._colorize(geo, (x, y, z, c) => {
      c.set('#24481a').lerp(_c2.set('#6e9e3a'), clamp((y - 3) / 4, 0, 1));
    });
  }

  _trunkGeometry(h, r0, r1, color) {
    const g = new THREE.CylinderGeometry(r1, r0, h, 8, 4);
    g.translate(0, h / 2, 0);
    const n = makeNoise2D(3);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = 1 + n(pos.getX(i) * 3 + y, pos.getZ(i) * 3) * 0.12;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return this._colorize(g, (x, y, z, c) => c.set(color).multiplyScalar(0.7 + 0.3 * clamp(y / h, 0, 1)));
  }

  _buildTrees() {
    const rng = mulberry32(WORLD.seed + 1);
    const pines = [];
    const leafy = [];
    const bushes = [];
    const ok = (x, z, inner) => {
      const d = Math.hypot(x, z);
      if (d < 32) return false;
      if (inner) {
        if (this.pathMask(x, z) > 0.02) return false;
        if (this.arenas.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + 6)) return false;
        if (this.camps.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) return false;
        if (Math.hypot(x - this.garagePos.x, z - this.garagePos.z) < 12) return false;
        if (this.coinSpots.some((c) => Math.hypot(c.x - x, c.z - z) < 1.5)) return false;
      }
      return true;
    };
    // Play-area woodland.
    for (let i = 0; i < 9000 && pines.length + leafy.length < 650; i++) {
      const x = (rng() - 0.5) * 2 * WORLD.playRadius;
      const z = (rng() - 0.5) * 2 * WORLD.playRadius;
      if (Math.hypot(x, z) > WORLD.playRadius - 2) continue;
      const fd = this.forestDensity(x, z);
      if (rng() > smoothstep(0.42, 0.72, fd) * 0.9 + 0.04) continue;
      if (!ok(x, z, true)) continue;
      if (pines.concat(leafy).some((t) => Math.abs(t.x - x) < 2.5 && Math.abs(t.z - z) < 2.5)) continue;
      const t = { x, z, s: 0.75 + rng() * 0.6, rot: rng() * TAU };
      (fd > 0.6 && rng() < 0.6 ? pines : leafy).push(t);
    }
    // Outer slopes - dense forest climbing the mountains, no collision needed.
    for (let i = 0; i < 6000 && pines.length < 1600; i++) {
      const a = rng() * TAU;
      const d = WORLD.playRadius + 4 + rng() * 170;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = this.heightAt(x, z);
      if (h > 78 + this.noise(x * 0.05, z * 0.05) * 15) continue;
      if (this.normalAt(x, z, _p).y < 0.65) continue;
      pines.push({ x, z, s: 0.9 + rng() * 0.9, rot: rng() * TAU, outer: true });
    }
    for (let i = 0; i < 4000 && bushes.length < 420; i++) {
      const x = (rng() - 0.5) * 2 * WORLD.playRadius;
      const z = (rng() - 0.5) * 2 * WORLD.playRadius;
      if (Math.hypot(x, z) > WORLD.playRadius) continue;
      if (rng() > this.forestDensity(x, z) + 0.15) continue;
      if (!ok(x, z, true)) continue;
      bushes.push({ x, z, s: 0.28 + rng() * 0.22, rot: rng() * TAU });
    }

    const barkMat = this._swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.08);
    const pineMat = this._swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 0.25);
    const leafMat = this._swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 0.3);

    const place = (geo, mat, list, colorFn, yOff = 0, shadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        const y = this.heightAt(t.x, t.z) + yOff * t.s - 0.15;
        _e.set((rng() - 0.5) * 0.08, t.rot, (rng() - 0.5) * 0.08);
        _q.setFromEuler(_e);
        _m.compose(_p.set(t.x, y, t.z), _q, _s.setScalar(t.s));
        mesh.setMatrixAt(i, _m);
        if (colorFn) mesh.setColorAt(i, colorFn(_c));
      });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const tint = (c) => c.setRGB(0.8 + rng() * 0.35, 0.85 + rng() * 0.3, 0.7 + rng() * 0.3);
    place(this._trunkGeometry(3.2, 0.32, 0.16, '#4a3322'), barkMat, pines);
    place(this._pineGeometry(), pineMat, pines, tint);
    place(this._trunkGeometry(4.2, 0.38, 0.22, '#5a4330'), barkMat, leafy);
    place(this._broadleafGeometry(), leafMat, leafy, tint);
    place(this._broadleafGeometry(), leafMat, bushes, tint, -3.4, false);

    for (const t of pines) if (!t.outer) this.addCollider(t.x, t.z, 0.45 * t.s);
    for (const t of leafy) this.addCollider(t.x, t.z, 0.5 * t.s);
    this.treeSpots = pines.filter((t) => !t.outer).concat(leafy);
  }

  _buildRocksAndFlowers() {
    const rng = mulberry32(WORLD.seed + 2);
    let g = new THREE.IcosahedronGeometry(1, 3);
    g = this._lumpy(g, new THREE.Vector3(), 0.32, 1.4, 77);
    g.scale(1, 0.7, 1);
    g.computeVertexNormals();
    this._colorize(g, (x, y, z, c) => {
      c.set('#77736c').lerp(_c2.set('#5c6b3a'), smoothstep(0.25, 0.6, y) * 0.8);
    });
    const rocks = [];
    for (let i = 0; i < 3000 && rocks.length < 220; i++) {
      const a = rng() * TAU, d = 30 + Math.sqrt(rng()) * (WORLD.playRadius + 40);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this.pathMask(x, z) > 0.05 || this.arenaMask(x, z) > 0.05) continue;
      if (this.camps.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2)) continue;
      rocks.push({ x, z, s: 0.4 + Math.pow(rng(), 2.5) * 2.4 });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const mesh = new THREE.InstancedMesh(g, mat, rocks.length);
    rocks.forEach((r, i) => {
      _e.set((rng() - 0.5) * 0.4, rng() * TAU, (rng() - 0.5) * 0.4);
      _q.setFromEuler(_e);
      _s.set(r.s * (0.8 + rng() * 0.5), r.s * (0.7 + rng() * 0.6), r.s * (0.8 + rng() * 0.5));
      _m.compose(_p.set(r.x, this.heightAt(r.x, r.z) - r.s * 0.2, r.z), _q, _s);
      mesh.setMatrixAt(i, _m);
      if (r.s > 0.9 && Math.hypot(r.x, r.z) < WORLD.playRadius) this.addCollider(r.x, r.z, r.s * 0.9);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Wildflowers.
    const fg = mergeGeometries([
      new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.32, 0),
      new THREE.IcosahedronGeometry(0.07, 0).translate(0.12, 0.25, 0.05),
      new THREE.IcosahedronGeometry(0.08, 0).translate(-0.08, 0.28, -0.1),
    ]);
    const fmat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: '#111111' });
    const palette = ['#ffffff', '#ffe14d', '#c77dff', '#ff5d8f', '#ff9f1c', '#7ec8ff'].map((h) => new THREE.Color(h));
    const flowers = [];
    for (let i = 0; i < 20000 && flowers.length < 2600; i++) {
      const x = (rng() - 0.5) * 2 * WORLD.playRadius, z = (rng() - 0.5) * 2 * WORLD.playRadius;
      if (Math.hypot(x, z) > WORLD.playRadius - 5 || Math.hypot(x, z) < 5) continue;
      const patch = this.noise(x * 0.04 + 200, z * 0.04);
      if (patch < 0.25 || this.pathMask(x, z) > 0.05 || this.arenaMask(x, z) > 0.1) continue;
      flowers.push({ x, z, c: palette[Math.floor((patch * 7 + rng() * 1.5) * 13) % palette.length] });
    }
    const fm = new THREE.InstancedMesh(fg, fmat, flowers.length);
    flowers.forEach((f, i) => {
      _m.compose(_p.set(f.x, this.heightAt(f.x, f.z), f.z), _q.identity(), _s.setScalar(0.8 + rng() * 0.6));
      fm.setMatrixAt(i, _m);
      fm.setColorAt(i, f.c);
    });
    this.scene.add(fm);
  }

  // ---------------------------------------------------------------- landmarks
  _signTexture(text, bg, fg) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = fg;
    ctx.font = 'bold 72px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _buildGarage() {
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: '#c9c3b8', roughness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: '#2f5fb3', roughness: 0.4, metalness: 0.5 });
    const roofM = new THREE.MeshStandardMaterial({ color: '#8a2b1f', roughness: 0.7, metalness: 0.2 });
    const doorM = new THREE.MeshStandardMaterial({ color: '#555b63', roughness: 0.5, metalness: 0.8 });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    box(12, 0.4, 9, trim, 0, 0.2, 0);
    box(0.5, 5, 8, wall, -5.75, 2.9, 0);
    box(0.5, 5, 8, wall, 5.75, 2.9, 0);
    box(12, 5, 0.5, wall, 0, 2.9, -3.75);
    box(12, 1.4, 0.5, wall, 0, 4.7, 3.75);
    // Roller door, half open with a warm glow inside.
    const door = box(11, 1.6, 0.15, doorM, 0, 3.2, 3.6);
    door.castShadow = false;
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.6), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffb347', emissiveIntensity: 0.6 }));
    inside.position.set(0, 2.2, -3.4);
    g.add(inside);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 13, 3, 1), roofM);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, 0.5);
    roof.position.set(0, 5.4 + 1.2, 0);
    roof.castShadow = true;
    g.add(roof);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2),
      new THREE.MeshStandardMaterial({ map: this._signTexture('ROBOT SHOP', '#1d3f8a', '#ffd23f'), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0.0, roughness: 0.5 }),
    );
    sign.material.emissiveMap = sign.material.map;
    sign.material.emissiveIntensity = 0.5;
    sign.position.set(0, 6.0, 4.05);
    g.add(sign);
    // Spinning gear on top.
    const gear = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 8, 12), new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 1, roughness: 0.25 }));
    gear.position.set(0, 9.3, 0);
    g.add(gear);
    this.garageGear = gear;

    const gp = this.garagePos;
    gp.y = this.heightAt(gp.x, gp.z);
    g.position.copy(gp);
    g.rotation.y = Math.PI / 2;
    this.scene.add(g);
    // Door faces +X; the shop counter is just in front of it.
    this.shopSpot = new THREE.Vector3(gp.x + 6.5, gp.y, gp.z);
    for (const dz of [-4, 0, 4]) this.addCollider(gp.x - 0.5, gp.z + dz, 4.2);

    // Spawn pad.
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.4, 0.25, 48),
      new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.8, roughness: 0.35 }),
    );
    pad.position.set(0, this.spawnH - 0.06, 0);
    pad.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: '#4dd2ff', toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, this.spawnH + 0.08, 0);
    this.spawnRing = ring;
    this.scene.add(pad, ring);
    this.spawn.set(0, this.spawnH, 0);
  }

  _buildArenas() {
    const stone = new THREE.MeshStandardMaterial({ color: '#8b877e', roughness: 0.9 });
    let pg = new THREE.CylinderGeometry(0.9, 1.1, 5, 10, 4);
    pg = this._lumpy(pg, new THREE.Vector3(0, 0, 0), 0.08, 2, 5);
    pg.translate(0, 2.2, 0);
    this.flags = [];
    for (const a of this.arenas) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        if (i % 4 === 0) continue; // gaps to walk in
        const ang = (i / n) * TAU + 0.13;
        const x = a.x + Math.cos(ang) * (a.r + 1.5);
        const z = a.z + Math.sin(ang) * (a.r + 1.5);
        const p = new THREE.Mesh(pg, stone);
        p.position.set(x, this.heightAt(x, z) - 0.3, z);
        p.rotation.set((Math.random() - 0.5) * 0.12, Math.random() * TAU, (Math.random() - 0.5) * 0.12);
        p.castShadow = p.receiveShadow = true;
        this.scene.add(p);
        this.addCollider(x, z, 1.1);
      }
      // Banner pole + flag in the boss colours.
      const back = Math.atan2(a.z, a.x);
      const fx = a.x + Math.cos(back) * (a.r - 2), fz = a.z + Math.sin(back) * (a.r - 2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 11, 8), new THREE.MeshStandardMaterial({ color: '#cccccc', metalness: 1, roughness: 0.3 }));
      pole.position.set(fx, this.heightAt(fx, fz) + 5.5, fz);
      pole.castShadow = true;
      const fgeo = new THREE.PlaneGeometry(4, 2.4, 16, 6).translate(2, 0, 0);
      const flag = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ color: a.boss.body, side: THREE.DoubleSide, roughness: 0.8, emissive: a.boss.body, emissiveIntensity: 0.15 }));
      flag.position.set(fx, pole.position.y + 4.2, fz);
      flag.castShadow = true;
      flag.userData.base = fgeo.attributes.position.array.slice();
      this.flags.push(flag);
      this.scene.add(pole, flag);
      this.addCollider(fx, fz, 0.4);
    }
  }

  _buildCamps() {
    const barrels = [];
    const crates = [];
    const rng = mulberry32(WORLD.seed + 3);
    for (const c of this.camps) {
      const k = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < k; i++) {
        const a = rng() * TAU, d = c.r * (0.7 + rng() * 0.5);
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        (rng() < 0.55 ? barrels : crates).push({ x, z, r: rng() * TAU, tip: rng() < 0.25 });
        this.addCollider(x, z, 0.6);
      }
    }
    const bm = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1.3, 14).translate(0, 0.65, 0),
      new THREE.MeshStandardMaterial({ color: '#a0522d', metalness: 0.7, roughness: 0.6 }),
      barrels.length,
    );
    barrels.forEach((b, i) => {
      _e.set(b.tip ? Math.PI / 2 : 0, b.r, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(b.x, this.heightAt(b.x, b.z) + (b.tip ? 0.5 : 0), b.z), _q, _s.setScalar(1));
      bm.setMatrixAt(i, _m);
      bm.setColorAt(i, _c.setHSL(0.03 + rng() * 0.06, 0.6, 0.35 + rng() * 0.15));
    });
    const cm = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.1, 1.1, 1.1).translate(0, 0.55, 0),
      new THREE.MeshStandardMaterial({ color: '#7a7f86', metalness: 0.85, roughness: 0.5 }),
      crates.length,
    );
    crates.forEach((b, i) => {
      _q.setFromEuler(_e.set(0, b.r, 0));
      _m.compose(_p.set(b.x, this.heightAt(b.x, b.z), b.z), _q, _s.setScalar(0.8 + rng() * 0.5));
      cm.setMatrixAt(i, _m);
    });
    for (const m of [bm, cm]) {
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ---------------------------------------------------------------- collisions
  addCollider(x, z, r) {
    const c = { x, z, r };
    this.colliders.push(c);
    const s = this.cell;
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++) {
      for (let iz = Math.floor((z - r) / s); iz <= Math.floor((z + r) / s); iz++) {
        const key = ix * 100000 + iz;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(c);
      }
    }
  }

  resolveCollision(pos, radius) {
    const s = this.cell;
    const cells = this.grid;
    for (let ix = Math.floor((pos.x - radius) / s); ix <= Math.floor((pos.x + radius) / s); ix++) {
      for (let iz = Math.floor((pos.z - radius) / s); iz <= Math.floor((pos.z + radius) / s); iz++) {
        const list = cells.get(ix * 100000 + iz);
        if (!list) continue;
        for (const c of list) {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const min = radius + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
          }
        }
      }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > WORLD.playRadius) {
      pos.x *= WORLD.playRadius / d;
      pos.z *= WORLD.playRadius / d;
    }
    return pos;
  }

  // ---------------------------------------------------------------- minimap
  buildMinimap(size = 220) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const R = WORLD.playRadius + 8;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = (i / size - 0.5) * 2 * R, z = (j / size - 0.5) * 2 * R;
        const k = (j * size + i) * 4;
        if (Math.hypot(x, z) > R) { img.data[k + 3] = 0; continue; }
        const h = this.heightAt(x, z);
        this.terrainColor(x, z, h, 1, _c);
        _c.convertLinearToSRGB();
        const shade = 0.85 + clamp(h / 40, -0.2, 0.3);
        img.data[k] = clamp(_c.r * 255 * shade, 0, 255);
        img.data[k + 1] = clamp(_c.g * 255 * shade, 0, 255);
        img.data[k + 2] = clamp(_c.b * 255 * shade, 0, 255);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(20,50,15,0.55)';
    for (const t of this.treeSpots) {
      ctx.beginPath();
      ctx.arc((t.x / R / 2 + 0.5) * size, (t.z / R / 2 + 0.5) * size, 1.4, 0, TAU);
      ctx.fill();
    }
    return { canvas: cv, R };
  }

  // ---------------------------------------------------------------- per frame
  update(dt, focus, camera) {
    this.time.value += dt;
    this.grassUniforms.uCenter.value.set(camera.position.x * 0.5 + focus.x * 0.5, camera.position.z * 0.5 + focus.z * 0.5);
    this.grassUniforms.uPlayer.value.set(focus.x, focus.z);
    // Keep the shadow box centred on the action; snap to texels to avoid shimmering.
    const step = 96 / 2048;
    const fx = Math.round(focus.x / step) * step, fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.sunDir, 150);
    this.sky.material.uniforms.time.value = this.time.value;
    if (this.garageGear) this.garageGear.rotation.z += dt * 0.8;
    if (this.spawnRing) this.spawnRing.material.color.setHSL(0.55, 1, 0.5 + Math.sin(this.time.value * 3) * 0.15);
    const t = this.time.value;
    for (const f of this.flags) {
      const pos = f.geometry.attributes.position;
      const b = f.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        pos.setZ(i, Math.sin(t * 4 + x * 1.4 + f.position.x) * 0.18 * x);
      }
      pos.needsUpdate = true;
    }
  }
}
