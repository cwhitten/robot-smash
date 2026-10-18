import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- materials
function paint(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.45, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.18, ...o,
  });
}
function metal(color, roughness = 0.32) {
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
}
function rubber(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.75 });
}
function glow(color, intensity = 3) {
  return new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

// ---------------------------------------------------------------- geometry helpers
const rbox = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const caps = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
const sph = (r) => new THREE.SphereGeometry(r, 24, 16);
const cyl = (r0, r1, h, s = 20) => new THREE.CylinderGeometry(r0, r1, h, s);

function starGeometry(r1, r2, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i / 10) * TAU + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.3, bevelSize: depth * 0.3, bevelSegments: 2 });
  g.center();
  return g;
}

function add(parent, geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- generic humanoid rig
// Robots face +Z. Rotation.x < 0 on a limb swings it forward.
function humanoid(o) {
  const root = new THREE.Group();
  const scaleG = group(root);
  scaleG.scale.setScalar(o.scale);
  const m = o.mats;
  const thigh = o.thigh ?? 0.42, shin = o.shin ?? 0.43, foot = 0.1;
  const hipY = thigh + shin + foot;
  const body = group(scaleG, 0, hipY, 0);
  const torso = group(body, 0, 0.06, 0);
  const th = o.torsoH ?? 0.7;
  const sw = o.shoulderW ?? 0.42;
  const hw = o.hipW ?? 0.15;

  add(body, rbox(hw * 2 + 0.14, 0.2, 0.28, 0.07), m.joint, 0, 0, 0);
  const head = group(torso, 0, th + 0.08, 0);
  const shoulderL = group(torso, sw, th - 0.12, 0);
  const shoulderR = group(torso, -sw, th - 0.12, 0);
  const ua = o.upperArm ?? 0.33, fa = o.foreArm ?? 0.33;
  const arms = [];
  for (const [sh, side] of [[shoulderL, 1], [shoulderR, -1]]) {
    add(sh, sph(o.jointR ?? 0.1), m.joint, 0, 0, 0);
    add(sh, caps(o.upperArmR ?? 0.075, ua - 0.1), m.joint, 0, -ua / 2, 0);
    const elbow = group(sh, 0, -ua, 0);
    add(elbow, sph((o.upperArmR ?? 0.075) + 0.02), m.joint, 0, 0, 0);
    const fore = add(elbow, caps(o.foreArmR ?? 0.1, fa - 0.12), m.body, 0, -fa / 2, 0);
    const hand = group(elbow, 0, -fa - 0.06, 0);
    arms.push({ sh, elbow, hand, fore, side });
  }
  const legs = [];
  for (const side of [1, -1]) {
    const hip = group(body, hw * side, -0.04, 0);
    add(hip, sph(0.1), m.joint, 0, 0, 0);
    add(hip, caps(o.thighR ?? 0.085, thigh - 0.12), m.joint, 0, -thigh / 2, 0);
    const knee = group(hip, 0, -thigh, 0);
    add(knee, sph(0.095), m.joint, 0, 0, 0);
    add(knee, caps(o.shinR ?? 0.11, shin - 0.14), m.body, 0, -shin / 2, 0);
    add(knee, rbox(o.footW ?? 0.2, foot, o.footL ?? 0.32, 0.04), m.accent, 0, -shin - foot / 2 + 0.01, 0.06);
    legs.push({ hip, knee, side });
  }

  const rig = {
    root, scaleG, body, torso, head, arms, legs,
    armL: arms[0], armR: arms[1], legL: legs[0], legR: legs[1],
    hipY, scale: o.scale, height: (hipY + th + 0.6) * o.scale,
    phase: 0, mats: [], spin: 0, hover: false,
    muzzle: null, eyeMuzzle: null, chestMuzzle: null, rocketMount: null, sword: null,
  };
  o.build(rig, m, { th, sw });
  // Collect unique materials for hit-flash.
  const set = new Set();
  root.traverse((c) => { if (c.isMesh && c.material && c.material.emissive) set.add(c.material); });
  rig.mats = [...set].map((mat) => ({ mat, base: mat.emissive.clone(), baseI: mat.emissiveIntensity }));
  return rig;
}

// ---------------------------------------------------------------- heroes
function buildJimmy() {
  const mats = { body: paint('#2f7bff'), accent: paint('#d8dde4'), joint: metal('#33373e', 0.4), dark: paint('#101318', { roughness: 0.1 }), eye: glow('#4de1ff', 4) };
  return humanoid({
    scale: 1.0, mats, torsoH: 0.62, shoulderW: 0.38,
    build(rig, m, { th }) {
      const chest = add(rig.torso, caps(0.3, 0.22), m.accent, 0, th / 2, 0);
      chest.scale.set(1, 1, 0.78);
      add(rig.torso, rbox(0.42, 0.34, 0.12, 0.05), m.body, 0, th / 2 + 0.06, 0.19);
      add(rig.torso, cyl(0.07, 0.07, 0.04), glow('#7cf8ff', 3), 0, th / 2 + 0.08, 0.26).rotation.x = Math.PI / 2;
      add(rig.head, sph(0.27), m.body, 0, 0.2, 0);
      const visor = add(rig.head, new THREE.SphereGeometry(0.255, 24, 12, -Math.PI / 2.4, Math.PI / 1.2, Math.PI / 3, Math.PI / 3.2), m.dark, 0, 0.21, 0.035);
      visor.castShadow = false;
      for (const s of [-1, 1]) add(rig.head, caps(0.035, 0.06), m.eye, s * 0.09, 0.22, 0.27, false);
      add(rig.head, cyl(0.012, 0.012, 0.25, 6), m.joint, 0, 0.55, 0);
      add(rig.head, sph(0.05), glow('#ffd23f', 3), 0, 0.69, 0, false);
      for (const s of [-1, 1]) add(rig.head, cyl(0.07, 0.07, 0.06), m.accent, s * 0.27, 0.2, 0).rotation.z = Math.PI / 2;
      for (const a of rig.arms) {
        add(a.sh, sph(0.15), m.body, 0, 0.03, 0);
        add(a.hand, sph(0.13), m.accent, 0, 0, 0);
      }
      rig.muzzle = rig.armR.hand;
      rig.eyeMuzzle = rig.head;
    },
  });
}

function buildBob() {
  const mats = { body: paint('#7f8f7a'), accent: paint('#c9cbc2'), joint: metal('#3a3d40', 0.45), dark: paint('#15181a', { roughness: 0.12 }), eye: glow('#7dff6a', 4) };
  return humanoid({
    scale: 1.15, mats, torsoH: 0.68, shoulderW: 0.46, foreArmR: 0.11,
    build(rig, m, { th }) {
      add(rig.torso, rbox(0.72, 0.6, 0.46, 0.1), m.body, 0, th / 2 + 0.02, 0);
      add(rig.torso, rbox(0.5, 0.18, 0.08, 0.04), m.accent, 0, th / 2 + 0.2, 0.22);
      const lens = add(rig.torso, cyl(0.1, 0.12, 0.06), glow('#7dff6a', 3), 0, th / 2 - 0.05, 0.24);
      lens.rotation.x = Math.PI / 2;
      rig.chestMuzzle = group(rig.torso, 0, th / 2 - 0.05, 0.3);
      add(rig.head, rbox(0.44, 0.38, 0.4, 0.08), m.body, 0, 0.17, 0);
      add(rig.head, rbox(0.38, 0.1, 0.06, 0.03), m.dark, 0, 0.2, 0.19, false);
      add(rig.head, rbox(0.3, 0.04, 0.02, 0.01), m.eye, 0, 0.2, 0.225, false);
      for (const s of [-1, 1]) add(rig.head, cyl(0.06, 0.06, 0.08, 6), m.joint, s * 0.24, 0.17, 0).rotation.z = Math.PI / 2;
      add(rig.head, rbox(0.12, 0.06, 0.2, 0.02), m.accent, 0, 0.38, 0);
      for (const a of rig.arms) add(a.sh, rbox(0.26, 0.2, 0.3, 0.06), m.accent, a.side * 0.04, 0.05, 0);
      // Arm cannon on the right arm.
      const can = add(rig.armR.hand, cyl(0.13, 0.11, 0.42), m.joint, 0, -0.05, 0);
      add(rig.armR.hand, cyl(0.15, 0.15, 0.05), m.accent, 0, -0.22, 0);
      add(rig.armR.hand, cyl(0.08, 0.08, 0.02), glow('#7dff6a', 4), 0, -0.26, 0, false);
      can.castShadow = true;
      rig.muzzle = group(rig.armR.hand, 0, -0.3, 0);
      add(rig.armL.hand, rbox(0.2, 0.2, 0.2, 0.06), m.accent, 0, 0, 0);
      rig.eyeMuzzle = rig.head;
    },
  });
}

function buildNooby() {
  const mats = { body: paint('#9a5cff'), accent: paint('#ffd23f', { metalness: 0.6 }), joint: metal('#2b2140', 0.35), dark: paint('#120c1f', { roughness: 0.1 }), eye: glow('#ffe14d', 4) };
  return humanoid({
    scale: 0.95, mats, torsoH: 0.6, shoulderW: 0.34, shinR: 0.09, foreArmR: 0.085,
    build(rig, m, { th }) {
      const chest = add(rig.torso, caps(0.26, 0.22), m.body, 0, th / 2, 0);
      chest.scale.set(1, 1, 0.75);
      const star = add(rig.torso, starGeometry(0.15, 0.065, 0.04), glow('#ffd23f', 2.2), 0, th / 2 + 0.05, 0.2);
      star.castShadow = false;
      add(rig.head, sph(0.25), m.body, 0, 0.19, 0);
      const face = add(rig.head, new THREE.SphereGeometry(0.24, 24, 12, -Math.PI / 2.6, Math.PI / 1.3, Math.PI / 3.4, Math.PI / 2.8), m.dark, 0, 0.19, 0.03);
      face.castShadow = false;
      for (const s of [-1, 1]) add(rig.head, starGeometry(0.06, 0.026, 0.02), m.eye, s * 0.085, 0.21, 0.255, false);
      add(rig.head, cyl(0.012, 0.012, 0.2, 6), m.joint, 0.08, 0.5, 0).rotation.z = -0.3;
      const tip = add(rig.head, starGeometry(0.09, 0.04, 0.03), glow('#ffd23f', 3), 0.13, 0.62, 0, false);
      rig.spinners = [tip];
      for (const a of rig.arms) {
        add(a.sh, sph(0.12), m.accent, 0, 0.02, 0);
        add(a.hand, sph(0.09), m.accent, 0, 0, 0);
      }
      // Sword held in the right hand, blade pointing forward when the arm hangs down.
      const sword = group(rig.armR.hand, 0, -0.02, 0);
      sword.rotation.x = Math.PI / 2;
      add(sword, cyl(0.03, 0.03, 0.22, 8), rubber('#3a2a55'), 0, 0, 0);
      add(sword, rbox(0.32, 0.05, 0.08, 0.02), m.accent, 0, 0.13, 0);
      const blade = add(sword, rbox(0.09, 1.05, 0.02, 0.01), metal('#dfe6f0', 0.12), 0, 0.68, 0);
      add(sword, rbox(0.02, 1.0, 0.025, 0.005), glow('#a8f0ff', 3), 0, 0.66, 0, false);
      add(sword, starGeometry(0.06, 0.025, 0.03), m.accent, 0, -0.14, 0);
      blade.castShadow = true;
      rig.sword = sword;
      rig.swordTip = group(sword, 0, 1.2, 0);
      rig.muzzle = rig.armR.hand;
      rig.eyeMuzzle = rig.head;
    },
  });
}

function buildOli() {
  const mats = { body: paint('#1b1b20', { metalness: 0.6, roughness: 0.25 }), accent: metal('#d4a017', 0.22), joint: metal('#2b2b30', 0.4), dark: paint('#050505', { roughness: 0.08 }), eye: glow('#ff2a2a', 5) };
  return humanoid({
    scale: 1.35, mats, torsoH: 0.74, shoulderW: 0.5, foreArmR: 0.12, upperArmR: 0.09, shinR: 0.12, thighR: 0.1, footW: 0.24, footL: 0.36,
    build(rig, m, { th }) {
      add(rig.torso, rbox(0.82, 0.66, 0.5, 0.12), m.body, 0, th / 2 + 0.04, 0);
      add(rig.torso, rbox(0.86, 0.08, 0.54, 0.03), m.accent, 0, th / 2 - 0.22, 0);
      add(rig.torso, rbox(0.4, 0.26, 0.06, 0.04), m.accent, 0, th / 2 + 0.12, 0.25);
      const core = add(rig.torso, new THREE.OctahedronGeometry(0.07), glow('#ff4040', 3), 0, th / 2 + 0.12, 0.3, false);
      rig.spinners = [core];
      add(rig.head, rbox(0.42, 0.4, 0.42, 0.1), m.body, 0, 0.18, 0);
      add(rig.head, rbox(0.4, 0.09, 0.06, 0.03), m.dark, 0, 0.21, 0.2, false);
      add(rig.head, rbox(0.34, 0.035, 0.02, 0.01), m.eye, 0, 0.21, 0.235, false);
      // Goat horns + beard. He IS the goat.
      for (const s of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(s * 0.16, 0.36, -0.02),
          new THREE.Vector3(s * 0.28, 0.52, -0.1),
          new THREE.Vector3(s * 0.42, 0.52, -0.26),
          new THREE.Vector3(s * 0.46, 0.36, -0.3),
          new THREE.Vector3(s * 0.42, 0.24, -0.2),
        ]);
        const tube = new THREE.TubeGeometry(curve, 24, 0.045, 8, false);
        // Taper the horn towards the tip.
        const pos = tube.attributes.position;
        const pts = curve.getSpacedPoints(24);
        for (let i = 0; i < pos.count; i++) {
          const ring = Math.floor(i / 9);
          const t = ring / 24;
          const c = pts[Math.min(ring, 24)];
          const k = 1.25 - t * 0.85;
          pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
        }
        tube.computeVertexNormals();
        add(rig.head, tube, paint('#e8dcc0', { metalness: 0.1, roughness: 0.5 }));
      }
      const beard = add(rig.head, new THREE.ConeGeometry(0.06, 0.18, 10), m.accent, 0, -0.06, 0.16);
      beard.rotation.x = Math.PI;
      for (const a of rig.arms) {
        const pad = add(a.sh, rbox(0.34, 0.24, 0.38, 0.08), m.accent, a.side * 0.05, 0.07, 0);
        pad.rotation.z = a.side * 0.2;
        add(a.hand, rbox(0.22, 0.22, 0.22, 0.07), m.body, 0, 0, 0);
        add(a.hand, cyl(0.06, 0.06, 0.03), glow('#ff5040', 3), 0, -0.12, 0, false);
      }
      // Rocket pod on the back.
      const pod = group(rig.torso, 0, th / 2 + 0.25, -0.33);
      add(pod, rbox(0.56, 0.36, 0.22, 0.05), m.joint, 0, 0, 0);
      for (const [x, y] of [[-0.14, 0.08], [0.14, 0.08], [-0.14, -0.08], [0.14, -0.08]]) {
        const r = add(pod, new THREE.ConeGeometry(0.055, 0.16, 10), paint('#e63946'), x, y + 0.2, 0);
        r.castShadow = false;
      }
      rig.rocketMount = pod;
      rig.muzzle = group(rig.armR.hand, 0, -0.14, 0);
      rig.eyeMuzzle = group(rig.head, 0, 0.21, 0.26);
    },
  });
}

export const HERO_BUILDERS = { jimmy: buildJimmy, bob: buildBob, nooby: buildNooby, oli: buildOli };

// ---------------------------------------------------------------- enemies
function buildScrapper(colors = {}) {
  const mats = { body: paint(colors.body ?? '#b5562a', { roughness: 0.55, clearcoat: 0.2 }), accent: metal(colors.accent ?? '#5a4a3a', 0.6), joint: metal('#3b302a', 0.6), eye: glow(colors.eye ?? '#ff2a00', 5) };
  return humanoid({
    scale: colors.scale ?? 0.95, mats, torsoH: 0.62, shoulderW: 0.4,
    build(rig, m, { th }) {
      const chest = add(rig.torso, rbox(0.6, 0.55, 0.42, 0.05), m.body, 0, th / 2, 0);
      chest.rotation.z = 0.04;
      for (let i = 0; i < 4; i++) add(rig.torso, sph(0.025), m.joint, -0.22 + i * 0.15, th / 2 + 0.2, 0.21, false);
      add(rig.head, rbox(0.36, 0.3, 0.34, 0.04), m.body, 0, 0.13, 0);
      add(rig.head, cyl(0.09, 0.09, 0.06), m.joint, 0, 0.14, 0.17).rotation.x = Math.PI / 2;
      add(rig.head, sph(0.06), m.eye, 0, 0.14, 0.2, false);
      const ant = add(rig.head, cyl(0.01, 0.01, 0.3, 5), m.joint, 0.1, 0.4, 0);
      ant.rotation.z = -0.5;
      for (const a of rig.arms) add(a.hand, rbox(0.17, 0.2, 0.17, 0.03), m.accent, 0, 0, 0);
      rig.muzzle = rig.armR.hand;
      rig.eyeMuzzle = rig.head;
    },
  });
}

function buildClanker() {
  const mats = { body: paint('#7a2a1f', { roughness: 0.5, clearcoat: 0.3 }), accent: metal('#4a4a4a', 0.5), joint: metal('#2a2522', 0.55), eye: glow('#ffaa00', 5) };
  return humanoid({
    scale: 1.5, mats, torsoH: 0.66, shoulderW: 0.5, foreArmR: 0.13, upperArmR: 0.095, thighR: 0.11, shinR: 0.13,
    build(rig, m, { th }) {
      add(rig.torso, rbox(0.9, 0.62, 0.55, 0.08), m.body, 0, th / 2, 0);
      add(rig.torso, rbox(0.6, 0.12, 0.1, 0.03), m.accent, 0, th / 2 + 0.12, 0.27);
      add(rig.head, rbox(0.34, 0.24, 0.32, 0.05), m.accent, 0, 0.04, 0.05);
      for (const s of [-1, 1]) add(rig.head, sph(0.045), m.eye, s * 0.08, 0.06, 0.21, false);
      for (const a of rig.arms) {
        add(a.sh, rbox(0.32, 0.26, 0.36, 0.06), m.body, a.side * 0.04, 0.06, 0);
        add(a.hand, sph(0.22), m.accent, 0, -0.05, 0);
      }
      rig.muzzle = rig.armR.hand;
      rig.eyeMuzzle = rig.head;
    },
  });
}

function buildZapper() {
  const root = new THREE.Group();
  const scaleG = group(root);
  const body = group(scaleG, 0, 1.6, 0);
  const torso = group(body);
  const mats = { body: paint('#f2b705', { roughness: 0.35 }), joint: metal('#222428', 0.4), eye: glow('#ff1a1a', 5) };
  add(torso, sph(0.45), mats.body);
  const band = add(torso, new THREE.TorusGeometry(0.46, 0.06, 10, 32), mats.joint);
  band.rotation.x = Math.PI / 2;
  add(torso, cyl(0.16, 0.16, 0.1), mats.joint, 0, 0, 0.4).rotation.x = Math.PI / 2;
  add(torso, sph(0.11), mats.eye, 0, 0, 0.45, false);
  add(torso, cyl(0.03, 0.03, 0.4, 8), mats.joint, 0, 0.5, 0);
  const rotor = group(torso, 0, 0.7, 0);
  for (let i = 0; i < 3; i++) {
    const blade = add(rotor, rbox(0.9, 0.02, 0.1, 0.01), mats.joint, 0, 0, 0, false);
    blade.rotation.y = (i / 3) * TAU;
    blade.geometry.translate(0.45, 0, 0);
  }
  const gun = add(torso, cyl(0.05, 0.07, 0.35, 10), mats.joint, 0, -0.38, 0.2);
  gun.rotation.x = Math.PI / 2;
  const muzzle = group(torso, 0, -0.38, 0.42);
  const rig = {
    root, scaleG, body, torso, head: torso, arms: [], legs: [], rotor,
    hipY: 1.6, scale: 1, height: 2.2, phase: 0, spin: 0, hover: true, muzzle, eyeMuzzle: muzzle,
  };
  const set = new Set();
  root.traverse((c) => { if (c.isMesh && c.material.emissive) set.add(c.material); });
  rig.mats = [...set].map((mat) => ({ mat, base: mat.emissive.clone(), baseI: mat.emissiveIntensity }));
  return rig;
}

function buildBoss(def) {
  const mats = {
    body: paint(def.body, { roughness: 0.4 }),
    accent: metal(def.accent, 0.25),
    joint: metal('#2a2a2e', 0.45),
    eye: glow(def.eye, 6),
  };
  return humanoid({
    scale: 2.7, mats, torsoH: 0.72, shoulderW: 0.52, foreArmR: 0.13, upperArmR: 0.1, thighR: 0.11, shinR: 0.13, footW: 0.26,
    build(rig, m, { th }) {
      add(rig.torso, rbox(0.95, 0.7, 0.58, 0.12), m.body, 0, th / 2, 0);
      const core = add(rig.torso, new THREE.IcosahedronGeometry(0.11, 0), glow(def.eye, 4), 0, th / 2 + 0.05, 0.32, false);
      add(rig.torso, new THREE.TorusGeometry(0.15, 0.03, 8, 24), m.accent, 0, th / 2 + 0.05, 0.3);
      rig.spinners = [core];
      add(rig.head, rbox(0.42, 0.36, 0.4, 0.08), m.body, 0, 0.16, 0);
      add(rig.head, rbox(0.34, 0.07, 0.04, 0.02), m.eye, 0, 0.2, 0.2, false);
      // Crown.
      const crown = group(rig.head, 0, 0.38, 0);
      add(crown, cyl(0.2, 0.18, 0.1, 16), m.accent);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        add(crown, new THREE.ConeGeometry(0.04, 0.14, 6), m.accent, Math.cos(a) * 0.18, 0.11, Math.sin(a) * 0.18);
        add(crown, sph(0.022), glow(def.eye, 3), Math.cos(a) * 0.19, 0.03, Math.sin(a) * 0.19, false);
      }
      for (const a of rig.arms) {
        add(a.sh, rbox(0.36, 0.26, 0.4, 0.08), m.accent, a.side * 0.05, 0.07, 0);
        for (let i = 0; i < 3; i++) add(a.sh, new THREE.ConeGeometry(0.05, 0.16, 6), m.joint, a.side * (0.08 + i * 0.07), 0.24, -0.08 + i * 0.08);
      }
      if (def.id === 'megadrill') {
        const drill = add(rig.armR.hand, new THREE.ConeGeometry(0.17, 0.7, 12), m.accent, 0, -0.3, 0);
        drill.rotation.x = Math.PI;
        rig.drill = drill;
        add(rig.armL.hand, sph(0.2), m.joint, 0, 0, 0);
      } else if (def.id === 'boombot') {
        add(rig.armR.hand, cyl(0.16, 0.13, 0.45), m.joint, 0, -0.08, 0);
        add(rig.armR.hand, cyl(0.1, 0.1, 0.02), glow(def.eye, 4), 0, -0.31, 0, false);
        add(rig.armL.hand, cyl(0.16, 0.13, 0.45), m.joint, 0, -0.08, 0);
      } else {
        for (const a of rig.arms) add(a.hand, sph(0.21), m.accent, 0, -0.03, 0);
      }
      if (def.id === 'rustytitan') {
        for (let i = 0; i < 5; i++) add(rig.torso, sph(0.08 + Math.random() * 0.05), rubber('#4c6b2a'), (Math.random() - 0.5) * 0.8, th / 2 + 0.3, (Math.random() - 0.5) * 0.4);
      }
      rig.muzzle = group(rig.armR.hand, 0, -0.3, 0);
      rig.eyeMuzzle = group(rig.head, 0, 0.2, 0.25);
    },
  });
}

export function buildEnemyModel(type, bossDef) {
  if (bossDef) return buildBoss(bossDef);
  if (type === 'zapper') return buildZapper();
  if (type === 'clanker') return buildClanker();
  return buildScrapper();
}

// ---------------------------------------------------------------- animation
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const ease = (t) => t * t * (3 - 2 * t);

/**
 * s = { speed: m/s, airborne, dashing, action: {type, t (0..1), side}, time, hit (0..1) }
 */
export function animateRig(rig, s, dt) {
  const k = 16;
  const t = s.time;
  if (rig.spinners) for (const sp of rig.spinners) sp.rotation.y += dt * 3;
  if (rig.drill) rig.drill.rotation.y += dt * 20;

  if (rig.hover) {
    rig.body.position.y = rig.hipY + Math.sin(t * 2.5 + rig.phase) * 0.12;
    rig.rotor.rotation.y += dt * 25;
    const tilt = Math.min(s.speed / 6, 1) * 0.25;
    rig.torso.rotation.x = damp(rig.torso.rotation.x, tilt + (s.action ? -0.3 * Math.sin(s.action.t * Math.PI) : 0), 8, dt);
    flash(rig, s.hit);
    return;
  }

  const moveAmt = Math.min(s.speed / 6, 1.2);
  rig.phase += dt * s.speed * (2.2 / rig.scale);
  const p = rig.phase;
  const sinp = Math.sin(p);

  // ---- locomotion targets
  let legLX = -sinp * 0.75 * moveAmt, legRX = sinp * 0.75 * moveAmt;
  let kneeL = Math.max(0, Math.sin(p + 1.3)) * 1.1 * moveAmt + 0.05;
  let kneeR = Math.max(0, Math.sin(p + 1.3 + Math.PI)) * 1.1 * moveAmt + 0.05;
  let armLX = sinp * 0.65 * moveAmt, armRX = -sinp * 0.65 * moveAmt;
  let armLZ = 0.12, armRZ = -0.12;
  let elbowL = -0.35 - moveAmt * 0.45, elbowR = -0.35 - moveAmt * 0.45;
  let torsoX = moveAmt * 0.12 + Math.sin(t * 2) * 0.015;
  let torsoY = 0;
  let headX = 0;
  let bodyY = rig.hipY + Math.abs(Math.cos(p)) * 0.06 * moveAmt + Math.sin(t * 2) * 0.008;
  if (moveAmt < 0.05) { armLZ = 0.16 + Math.sin(t * 2) * 0.03; armRZ = -armLZ; }

  if (s.airborne) {
    legLX = -0.7; legRX = 0.25; kneeL = 1.2; kneeR = 0.6;
    armLZ = 0.7; armRZ = -0.7; armLX = -0.4; armRX = -0.4;
  }
  if (s.dashing) {
    torsoX = 0.55; armLX = 0.9; armRX = 0.9; elbowL = -0.2; elbowR = -0.2;
    legLX = 0.4; legRX = -0.5; kneeL = 0.9; kneeR = 0.3;
  }

  // ---- action overrides
  const a = s.action;
  if (a) {
    const at = a.t;
    switch (a.type) {
      case 'punch': {
        const e = at < 0.3 ? ease(at / 0.3) : 1 - ease((at - 0.3) / 0.7);
        if (a.side > 0) { armLX = -1.55 * e + armLX * (1 - e); elbowL = -1.4 * (1 - e) - 0.05; }
        else { armRX = -1.55 * e + armRX * (1 - e); elbowR = -1.4 * (1 - e) - 0.05; }
        torsoY = a.side * 0.45 * e;
        break;
      }
      case 'blast': {
        const e = at < 0.15 ? ease(at / 0.15) : at > 0.7 ? 1 - ease((at - 0.7) / 0.3) : 1;
        armRX = -1.57 * e + armRX * (1 - e);
        elbowR = elbowR * (1 - e);
        armRZ = -0.05;
        torsoY = -0.25 * e;
        if (at > 0.12 && at < 0.35) torsoX -= 0.15;
        break;
      }
      case 'blast2': {
        const e = at < 0.15 ? ease(at / 0.15) : at > 0.7 ? 1 - ease((at - 0.7) / 0.3) : 1;
        armLX = -1.57 * e + armLX * (1 - e);
        armRX = -1.57 * e + armRX * (1 - e);
        elbowL = elbowL * (1 - e); elbowR = elbowR * (1 - e);
        armLZ = -0.15 * e; armRZ = 0.15 * e;
        break;
      }
      case 'slice': {
        const e = ease(Math.min(at / 0.6, 1));
        const back = 1 - ease(Math.max(0, (at - 0.6) / 0.4));
        armRX = -1.4 * back;
        elbowR = -0.15;
        armRZ = -0.25 * back;
        torsoY = (1.1 - 2.5 * e) * back;
        armLZ = 0.6 * back;
        break;
      }
      case 'laser': {
        headX = -0.1;
        torsoX = -0.12;
        armLZ = 0.5; armRZ = -0.5;
        elbowL = -1.2; elbowR = -1.2;
        break;
      }
      case 'super': {
        armLZ = 1.2; armRZ = -1.2; armLX = -0.3; armRX = -0.3;
        elbowL = -0.4; elbowR = -0.4;
        torsoX = -0.15;
        break;
      }
      case 'smash': {
        // Enemy overhead smash: windup phase raises arms, then slams.
        if (a.windup) {
          const e = ease(Math.min(at, 1));
          armLX = -2.8 * e; armRX = -2.8 * e; elbowL = -0.4; elbowR = -0.4; torsoX = -0.25 * e;
        } else {
          const e = 1 - ease(at);
          armLX = -0.9 * e - 0.3; armRX = -0.9 * e - 0.3; torsoX = 0.35 * e; elbowL = elbowR = -0.1;
        }
        break;
      }
      case 'swing': {
        if (a.windup) {
          const e = ease(Math.min(at, 1));
          armRX = -1.2 * e; armRZ = -1.2 * e; torsoY = -0.7 * e; elbowR = -0.6;
        } else {
          const e = ease(at);
          armRX = -1.4; armRZ = -1.2 + 1.6 * e; torsoY = -0.7 + 1.5 * e; elbowR = -0.1;
        }
        break;
      }
      case 'shoot': {
        armRX = -1.57; elbowR = 0; torsoY = -0.2;
        if (a.windup) torsoX = -0.1;
        break;
      }
      default: break;
    }
  }
  if (s.hit > 0) { torsoX -= s.hit * 0.3; headX -= s.hit * 0.3; }

  const L = rig.armL, R = rig.armR;
  L.sh.rotation.x = damp(L.sh.rotation.x, armLX, k, dt);
  R.sh.rotation.x = damp(R.sh.rotation.x, armRX, k, dt);
  L.sh.rotation.z = damp(L.sh.rotation.z, armLZ, k, dt);
  R.sh.rotation.z = damp(R.sh.rotation.z, armRZ, k, dt);
  L.elbow.rotation.x = damp(L.elbow.rotation.x, elbowL, k, dt);
  R.elbow.rotation.x = damp(R.elbow.rotation.x, elbowR, k, dt);
  rig.legL.hip.rotation.x = damp(rig.legL.hip.rotation.x, legLX, k, dt);
  rig.legR.hip.rotation.x = damp(rig.legR.hip.rotation.x, legRX, k, dt);
  rig.legL.knee.rotation.x = damp(rig.legL.knee.rotation.x, kneeL, k, dt);
  rig.legR.knee.rotation.x = damp(rig.legR.knee.rotation.x, kneeR, k, dt);
  rig.torso.rotation.x = damp(rig.torso.rotation.x, torsoX, k * 0.7, dt);
  rig.torso.rotation.y = a && (a.type === 'slice' || a.type === 'punch') ? torsoY : damp(rig.torso.rotation.y, torsoY, k, dt);
  rig.head.rotation.x = damp(rig.head.rotation.x, headX, k, dt);
  rig.body.position.y = damp(rig.body.position.y, bodyY, 20, dt);
  rig.body.rotation.y = rig.spin;
  if (rig.sword) {
    const swinging = a && (a.type === 'slice' || a.type === 'super');
    rig.sword.rotation.x = damp(rig.sword.rotation.x, swinging ? Math.PI * 0.97 : Math.PI / 2, 22, dt);
  }
  flash(rig, s.hit);
}

function flash(rig, h) {
  if (h > 0 || rig._flashing) {
    for (const m of rig.mats) {
      if (h > 0) {
        m.mat.emissive.copy(m.base).lerp(WHITE, h);
        m.mat.emissiveIntensity = Math.max(m.baseI, h * 1.5);
      } else {
        m.mat.emissive.copy(m.base);
        m.mat.emissiveIntensity = m.baseI;
      }
    }
    rig._flashing = h > 0;
  }
}
const WHITE = new THREE.Color('#ffffff');

export function disposeRig(rig) {
  rig.root.traverse((c) => {
    if (c.isMesh) {
      c.geometry.dispose();
      if (c.material.dispose) c.material.dispose();
    }
  });
  rig.root.removeFromParent();
}
