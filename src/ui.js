import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HEROES, HERO_ORDER, ABILITIES } from './config.js';
import { HERO_BUILDERS, animateRig, disposeRig } from './robotModels.js';
import { isTouch } from './input.js';

const $ = (id) => document.getElementById(id);

function renderPortraits() {
  const out = {};
  const size = 320;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight('#fff4e0', 2.5);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight('#7fb8ff', 2);
  rim.position.set(-3, 2, -3);
  scene.add(key, rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  for (const id of HERO_ORDER) {
    const rig = HERO_BUILDERS[id]();
    scene.add(rig.root);
    rig.root.rotation.y = 0.45;
    for (let i = 0; i < 30; i++) animateRig(rig, { speed: 0, time: 1 + i * 0.03, hit: 0 }, 0.05);
    const h = rig.height;
    cam.position.set(h * 0.55, h * 0.62, h * 2.2);
    cam.lookAt(0, h * 0.5, 0);
    r.render(scene, cam);
    const body = r.domElement.toDataURL('image/png');
    cam.position.set(h * 0.18, h * 0.86, h * 0.95);
    cam.lookAt(0, h * 0.8, 0);
    r.render(scene, cam);
    out[id] = { body, face: r.domElement.toDataURL('image/png') };
    disposeRig(rig);
  }
  pm.dispose();
  r.dispose();
  r.forceContextLoss();
  return out;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.portraits = renderPortraits();
    this.mini = game.world.buildMinimap(220);
    this.miniCtx = $('minimap').getContext('2d');
    this.miniTimer = 0;
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.boss = null;
    this.lastCoins = -1;

    $('shopBtn').addEventListener('click', () => game.openShop());
    $('shopClose').addEventListener('click', () => game.closeShop());
    $('resumeBtn').addEventListener('click', () => game.resume());
    $('respawnBtn').addEventListener('click', () => game.respawn());
    $('resetBtn').addEventListener('click', () => {
      if (confirm('Erase all coins and robots and start over?')) game.resetProgress();
    });
    const mv = $('musicVol'), sv = $('sfxVol'), q = $('quality');
    mv.value = game.save.musicVol;
    sv.value = game.save.sfxVol;
    q.value = game.save.quality;
    mv.addEventListener('input', () => { game.save.musicVol = +mv.value; game.audio.setMusicVolume(+mv.value); game.persist(); });
    sv.addEventListener('input', () => { game.save.sfxVol = +sv.value; game.audio.setSfxVolume(+sv.value); game.audio.play('coin'); game.persist(); });
    q.addEventListener('change', () => { game.save.quality = q.value; game.applyQuality(); game.persist(); });
  }

  showHUD(on) { $('hud').classList.toggle('hidden', !on); }
  show(id, on) { $(id).classList.toggle('hidden', !on); }

  refreshHero() {
    const p = this.game.player;
    const h = p.hero;
    $('heroPortrait').src = this.portraits[h.id].face;
    $('heroPortrait').style.background = `radial-gradient(circle, ${h.color}, #12243f)`;
    $('heroName').textContent = h.name;
    $('heroLevel').textContent = `LV ${h.level}`;
    $('heroTitle').textContent = h.title;
    $('superWrap').classList.toggle('hidden', !h.superAbility);
    const keys = { 0: 'Click', 1: 'R-Click', dash: 'Shift', super: 'E' };
    const list = $('abilities');
    list.innerHTML = '';
    this.abilityEls = [];
    const abil = [h.primary, h.secondary, 'dash'].filter(Boolean);
    abil.forEach((name, i) => {
      const a = ABILITIES[name];
      const el = document.createElement('div');
      el.className = 'ability';
      el.innerHTML = `<span class="label">${a.name}</span>${a.icon}<div class="cd"></div><span class="key">${name === 'dash' ? keys.dash : keys[i]}</span>`;
      list.appendChild(el);
      this.abilityEls.push({ name, el, cd: el.querySelector('.cd') });
    });
    const sup = document.createElement('div');
    sup.className = 'ability super' + (h.superAbility ? '' : ' locked');
    const sa = h.superAbility ? ABILITIES[h.superAbility] : { name: 'NO SUPER', icon: '🔒' };
    sup.innerHTML = `<span class="label">${sa.name}</span>${sa.icon}<div class="cd"></div><span class="key">E</span>`;
    list.appendChild(sup);
    this.superEl = { el: sup, cd: sup.querySelector('.cd') };

    $('tAttack').textContent = ABILITIES[h.primary].icon;
    $('tAttack2').classList.toggle('hidden', !h.secondary);
    if (h.secondary) $('tAttack2').textContent = ABILITIES[h.secondary].icon;
    $('tSuper').classList.toggle('locked', !h.superAbility);
    if (h.superAbility) $('tSuper').textContent = ABILITIES[h.superAbility].icon;
  }

  // ---------------------------------------------------------------- shop
  renderShop() {
    const game = this.game;
    const save = game.save;
    $('shopCoins').textContent = save.coins;
    const wrap = $('shopCards');
    wrap.innerHTML = '';
    const maxHp = 500, maxStr = 100, maxSpd = 9;
    for (const id of HERO_ORDER) {
      const h = HEROES[id];
      const owned = save.owned.includes(id);
      const current = save.current === id;
      const card = document.createElement('div');
      card.className = `card${current ? ' current' : ''}${owned ? '' : ' lockedCard'}`;
      card.style.setProperty('--c', h.color);
      const abil = [h.primary, h.secondary, 'dash'].filter(Boolean).map((a) => `${ABILITIES[a].icon} ${ABILITIES[a].name}`).join(' · ');
      const sup = h.superAbility ? `${ABILITIES[h.superAbility].icon} <b>${ABILITIES[h.superAbility].name}</b>` : '<i>No super power</i>';
      const stat = (label, v, max, color) => `<div class="stat"><span>${label}</span><div class="sb"><div style="width:${Math.min(100, (v / max) * 100)}%;background:${color}"></div></div><span>${v}</span></div>`;
      let btn;
      if (current) btn = '<button disabled>✔ Playing</button>';
      else if (owned) btn = `<button class="play" data-play="${id}">▶ Play as ${h.name}</button>`;
      else if (save.coins >= h.cost) btn = `<button class="buy" data-buy="${id}">Buy for ${h.cost} 🪙</button>`;
      else btn = `<button disabled>🔒 ${h.cost} 🪙 (need ${h.cost - save.coins} more)</button>`;
      card.innerHTML = `
        <img src="${this.portraits[id].body}" alt="${h.name}" />
        <h3>${h.name} <span class="lvl">LV ${h.level}</span></h3>
        <div class="ctitle">"${h.title}"</div>
        <div class="blurb">${h.blurb}</div>
        ${stat('❤️ Health', h.health, maxHp, '#4dd96b')}
        ${stat('💪 Strength', h.strength, maxStr, '#ff7a4d')}
        ${stat('⚡ Speed', h.speed, maxSpd, '#4dc3ff')}
        <div class="abil">${abil}<br/>Super: ${sup}</div>
        ${btn}`;
      wrap.appendChild(card);
    }
    wrap.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => game.buyHero(b.dataset.buy)));
    wrap.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => game.selectHero(b.dataset.play)));
  }

  // ---------------------------------------------------------------- messages
  banner(text, color = '#ffd23f', dur = 1.8) {
    const b = $('banner');
    b.textContent = text;
    b.style.color = color;
    b.classList.add('show');
    this.bannerTimer = dur;
  }

  toast(text, dur = 2.2) {
    const t = $('toast');
    if (t.classList.contains('show') && t.textContent === text) { this.toastTimer = dur; return; }
    t.textContent = text;
    t.classList.add('show');
    this.toastTimer = dur;
  }

  hurtFlash() {
    const h = $('hurt');
    h.style.transition = 'none';
    h.style.opacity = 1;
    requestAnimationFrame(() => {
      h.style.transition = 'opacity 0.5s';
      h.style.opacity = 0;
    });
  }

  showBoss(e) {
    this.boss = e;
    $('bossName').textContent = `👑 ${e.name}`;
    this.show('bossBar', true);
  }

  hideBoss() {
    this.boss = null;
    this.show('bossBar', false);
  }

  showDeath(heroName, lost, kept) {
    $('deathTitle').textContent = `Oh no! ${heroName} got smashed!`;
    $('deathText').innerHTML = lost > 0
      ? `You dropped <b style="color:#ffd23f">${lost} coins</b>…<br/>but you still have <b style="color:#ffd23f">${kept}</b>! 💪`
      : 'Good thing you had no coins to drop! 😄';
    this.show('death', true);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const game = this.game;
    const p = game.player;
    const save = game.save;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) $('banner').classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.remove('show');
    }
    if (!p.hero) return;

    const hpFrac = Math.max(0, p.hp / p.maxHp);
    $('hpFill').style.width = `${hpFrac * 100}%`;
    $('hpText').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    $('hpFill').parentElement.classList.toggle('low', hpFrac < 0.3);
    if (p.hero.superAbility) {
      $('superFill').style.width = `${p.superCharge}%`;
      const ready = p.superCharge >= 100;
      $('superWrap').classList.toggle('ready', ready);
      $('superText').textContent = p.superActive ? 'SUPER!' : ready ? 'SUPER READY! ' + (isTouch ? 'Tap ⭐' : 'Press E') : `SUPER ${Math.floor(p.superCharge)}%`;
    }
    if (this.abilityEls) {
      for (const a of this.abilityEls) {
        const cd = p.cooldowns[a.name] ?? 0;
        a.cd.style.height = `${(cd / ABILITIES[a.name].cooldown) * 100}%`;
      }
      if (p.hero.superAbility) {
        this.superEl.cd.style.height = `${100 - p.superCharge}%`;
        this.superEl.el.classList.toggle('ready', p.superCharge >= 100);
        $('tSuper').classList.toggle('ready', p.superCharge >= 100);
      }
    }

    if (save.coins !== this.lastCoins) {
      $('coinCount').textContent = save.coins;
      if (this.lastCoins >= 0 && save.coins > this.lastCoins) {
        const box = $('coinBox');
        box.classList.remove('pop');
        void box.offsetWidth;
        box.classList.add('pop');
      }
      this.lastCoins = save.coins;
      const next = HERO_ORDER.map((id) => HEROES[id]).find((h) => !save.owned.includes(h.id));
      const ng = $('nextGoal');
      if (next) {
        const pct = Math.min(100, (save.coins / next.cost) * 100);
        ng.innerHTML = save.coins >= next.cost
          ? `🎉 You can buy <b>${next.name}</b>! ${isTouch ? 'Tap 🛒 Shop' : 'Press <kbd>B</kbd>'}`
          : `Next robot: <b>${next.name}</b> — ${save.coins} / ${next.cost}<div class="mini"><div style="width:${pct}%"></div></div>`;
      } else {
        ng.innerHTML = '🏆 You own ALL the robots!';
      }
    }

    if (this.boss) $('bossFill').style.width = `${Math.max(0, this.boss.hp / this.boss.maxHp) * 100}%`;

    // Near the shop?
    const near = p.pos.distanceTo(game.world.shopSpot) < 7 && game.state === 'playing';
    $('hint').classList.toggle('hidden', !near);
    if (near) $('hint').innerHTML = `🛒 Robot Shop! ${isTouch ? 'Tap the 🛒 Shop button' : 'Press <kbd>B</kbd>'} to go shopping`;
    $('clickHint').classList.toggle('hidden', game.input.locked || game.state !== 'playing');

    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.08;
      this.drawMinimap();
    }
  }

  drawMinimap() {
    const ctx = this.miniCtx;
    const { canvas, R } = this.mini;
    const S = 220;
    const game = this.game;
    const toMap = (x, z) => [(x / R / 2 + 0.5) * S, (z / R / 2 + 0.5) * S];
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(canvas, 0, 0);
    // Shop.
    const [gx, gy] = toMap(game.world.garagePos.x, game.world.garagePos.z);
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛒', gx, gy);
    const pl = game.player;
    for (const e of game.enemies.list) {
      if (!e.alive) {
        if (e.isBoss) {
          const [x, y] = toMap(e.home.x, e.home.z);
          ctx.globalAlpha = 0.5;
          ctx.fillText('💤', x, y);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      const [x, y] = toMap(e.pos.x, e.pos.z);
      if (e.isBoss) {
        ctx.font = '18px sans-serif';
        ctx.fillText('👑', x, y);
        ctx.font = '14px sans-serif';
      } else if (Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z) < 70) {
        ctx.fillStyle = e.state === 'chase' || e.state === 'windup' ? '#ff3030' : '#ff9a50';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Player arrow pointing where the camera looks.
    const [px, py] = toMap(pl.pos.x, pl.pos.z);
    const yaw = game.cam.yaw;
    ctx.translate(px, py);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}
