import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HEROES, ECONOMY } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Combat } from './combat.js';
import { Effects } from './effects.js';
import { Pickups } from './pickups.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { loadSave, writeSave, resetSave } from './save.js';

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.save = loadSave();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2500);

    this.audio = new AudioSys();
    this.audio.musicVol = this.save.musicVol;
    this.audio.sfxVol = this.save.sfxVol;
    this.input = new Input(canvas);

    this.world = new World(this.scene, renderer);
    this.cam = new CameraRig(this.camera, this.world);
    this.effects = new Effects(this);
    this.combat = new Combat(this);
    this.player = new Player(this);
    this.player.pos.copy(this.world.spawn);
    this.player.setHero(this.save.current);
    this.enemies = new EnemyManager(this);
    this.pickups = new Pickups(this);
    this.ui = new UI(this);
    this.ui.refreshHero();

    this._setupComposer();
    this.applyQuality();

    this.state = 'title';
    this.titleT = 0;
    this.activeBoss = null;
    this.saveTimer = 0;
    this.dirty = false;

    window.addEventListener('resize', () => this._resize());
    // iOS rarely fires beforeunload for home-screen apps, so also save whenever we're hidden.
    window.addEventListener('beforeunload', () => this.persist());
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      this.persist();
      if (this.state === 'playing') this.pause();
    });
    this.input.onKey = (code) => this._onKey(code);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this._ignoreUnlock) this.pause();
      this._ignoreUnlock = false;
    };
    document.getElementById('game').addEventListener('click', () => {
      if (this.state === 'playing') this.input.lock();
    });
    const play = document.getElementById('playBtn');
    play.addEventListener('click', () => this.start());
    document.getElementById('loading').textContent = '';
    play.disabled = false;

    this.timer = new THREE.Timer();
    renderer.setAnimationLoop(() => this._tick());
  }

  _setupComposer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.35, 2.4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  applyQuality() {
    const fast = this.save.quality === 'fast';
    const pr = fast ? 1 : Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloom.enabled = !fast;
    this.world.grass.geometry.instanceCount = fast ? 35000 : 90000;
    const sm = fast ? 1024 : 2048;
    if (this.world.sun.shadow.mapSize.x !== sm) {
      this.world.sun.shadow.mapSize.set(sm, sm);
      if (this.world.sun.shadow.map) {
        this.world.sun.shadow.map.dispose();
        this.world.sun.shadow.map = null;
      }
    }
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // ---------------------------------------------------------------- state changes
  start() {
    this.audio.init();
    this.audio.setMusicVolume(this.save.musicVol);
    this.audio.setSfxVolume(this.save.sfxVol);
    this.audio.play('click');
    this.ui.show('title', false);
    this.ui.showHUD(true);
    this.player.spawnAt(this.world.spawn);
    this.cam.yaw = 0;
    this.cam.pitch = 0.3;
    this.cam.initialized = false;
    this.state = 'playing';
    this.input.lock();
    this.ui.banner(`Go, ${this.player.hero.name}!`, '#4de1ff', 1.6);
    setTimeout(() => this.ui.toast('Smash the bad bots and collect coins! 🪙', 3), 1800);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.stopHum();
    const s = this.save;
    document.getElementById('stats').innerHTML = `Bad bots smashed: <b>${s.kills}</b><br/>Bosses beaten: <b>${s.bosses}</b><br/>Coins earned all-time: <b>${s.totalEarned}</b>`;
    this.ui.show('pause', true);
  }

  resume() {
    this.ui.show('pause', false);
    this.state = 'playing';
    if (this.player.superActive?.type === 'laserSuper') this.audio.startHum();
    this.audio.play('click');
    this.input.lock();
  }

  openShop() {
    if (this.state !== 'playing') return;
    this.state = 'shop';
    this._ignoreUnlock = this.input.locked;
    this.input.unlock();
    this.audio.play('click');
    this.ui.renderShop();
    this.ui.show('shop', true);
  }

  closeShop() {
    if (this.state !== 'shop') return;
    this.ui.show('shop', false);
    this.state = 'playing';
    this.audio.play('click');
    this.input.lock();
  }

  _onKey(code) {
    if (code === 'KeyM' && this.audio.ctx) {
      const on = this.audio.musicVol > 0;
      this._lastMusicVol = on ? this.audio.musicVol : this._lastMusicVol || 0.5;
      this.audio.setMusicVolume(on ? 0 : this._lastMusicVol);
      this.ui.toast(on ? '🔇 Music off' : '🎵 Music on', 1.2);
      return;
    }
    if (code === 'TouchPause') {
      if (this.state === 'playing') this.pause();
      return;
    }
    if (code === 'KeyB') {
      if (this.state === 'playing') this.openShop();
      else if (this.state === 'shop') this.closeShop();
    } else if (code === 'Escape' || code === 'KeyP') {
      if (this.state === 'shop') this.closeShop();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'playing' && code === 'KeyP') {
        this._ignoreUnlock = this.input.locked;
        this.input.unlock();
        this.pause();
      }
    } else if (code === 'Enter') {
      if (this.state === 'title') this.start();
      else if (this.state === 'dead') this.respawn();
    }
  }

  // ---------------------------------------------------------------- economy
  persist() {
    writeSave(this.save);
    this.dirty = false;
  }

  addCoins(v, pos) {
    this.save.coins += v;
    this.save.totalEarned += v;
    this.dirty = true;
    if (pos) this.effects.text(pos, `+${v}`, { color: '#ffd23f', size: 20, life: 0.7, rise: 2 });
  }

  buyHero(id) {
    const h = HEROES[id];
    if (this.save.owned.includes(id)) return;
    if (this.save.coins < h.cost) {
      this.audio.play('error');
      return;
    }
    this.save.coins -= h.cost;
    this.save.owned.push(id);
    this.audio.play('buy');
    this.selectHero(id);
    this.ui.banner(`🎉 You unlocked ${h.name}!`, h.color, 2.4);
  }

  selectHero(id) {
    if (!this.save.owned.includes(id)) return;
    this.save.current = id;
    this.player.setHero(id);
    this.player.hp = this.player.maxHp;
    this.enemies.rescale(HEROES[id]);
    this.ui.refreshHero();
    this.ui.renderShop();
    this.persist();
    this.audio.play('superReady');
  }

  resetProgress() {
    this.save = resetSave();
    this.selectHero('jimmy');
    this.persist();
    this.ui.lastCoins = -1;
    this.ui.toast('Fresh start! Good luck, Jimmy!');
  }

  // ---------------------------------------------------------------- events
  onEnemyKilled(e) {
    this.save.kills++;
    this.dirty = true;
    if (e.isBoss) {
      this.save.bosses++;
      this.audio.play('victory');
      this.ui.banner(`🏆 ${e.name} DEFEATED!`, '#ffd23f', 3);
      if (this.activeBoss === e) this.onBossReset(e);
      this.persist();
    }
  }

  onBossEngaged(e) {
    if (this.activeBoss === e) return;
    this.activeBoss = e;
    this.ui.showBoss(e);
    this.audio.setTrack('boss');
    this.audio.play('bossRoar');
    this.ui.banner(`⚠️ ${e.name}!`, '#ff5050', 2);
    setTimeout(() => {
      if (this.activeBoss === e && this.state === 'playing') this.ui.toast('Watch for RED circles and lines — jump or move out of the way!', 3.5);
    }, 1500);
  }

  onBossReset(e) {
    if (this.activeBoss !== e) return;
    this.activeBoss = null;
    this.ui.hideBoss();
    this.audio.setTrack('explore');
  }

  onPlayerDeath() {
    const lost = Math.floor(this.save.coins * ECONOMY.deathPenalty);
    this.save.coins -= lost;
    this.persist();
    this.audio.play('death');
    this.audio.stopHum();
    if (this.activeBoss) this.onBossReset(this.activeBoss);
    this.enemies.resetAggro();
    this.state = 'dying';
    setTimeout(() => {
      this.state = 'dead';
      this.input.unlock();
      this.ui.showDeath(this.player.hero.name, lost, this.save.coins);
    }, 1800);
    // Drop some of the lost coins on the floor as a visual (not collectable value).
    this.effects.burst(this.player.pos.clone().setY(this.player.pos.y + 1), { count: 20, color: '#ffd23f', speed: 8, size: 0.15, life: 1, gravity: 15, up: 1 });
  }

  respawn() {
    if (this.state !== 'dead') return;
    this.ui.show('death', false);
    this.combat.clear();
    this.player.spawnAt(this.world.spawn);
    this.cam.yaw = 0;
    this.state = 'playing';
    this.audio.play('superReady');
    this.input.lock();
    this.ui.banner(`${this.player.hero.name} is back!`, '#4de1ff', 1.4);
  }

  // ---------------------------------------------------------------- loop
  _tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    const st = this.state;
    if (st === 'playing' || st === 'dying') {
      this.player.update(dt);
      this.enemies.update(dt);
      this.combat.update(dt);
      this.pickups.update(dt);
      const pl = this.player;
      const fwd = this.input.down('KeyW') || this.input.down('ArrowUp') || this.input.stickY > 0.5;
      this.cam.update(dt, pl.pos, pl.hero.scale, this.input, fwd && pl.alive ? pl.facing : null);
    } else if (st === 'title') {
      this.titleT += dt;
      this.player.idle(dt);
      const a = this.titleT * 0.12 + 0.6;
      const p = this.player.pos;
      const dx = -Math.sin(a), dz = -Math.cos(a);
      this.camera.position.set(p.x - dx * 6.5, p.y + 2.2, p.z - dz * 6.5);
      // Look a little to the robot's right so it sits beside the title text.
      this.camera.lookAt(p.x - dz * 1.8, p.y + 1.4, p.z + dx * 1.8);
    } else {
      this.cam.update(dt, this.player.pos, this.player.hero.scale, null);
    }
    this.effects.update(dt, this.camera);
    this.world.update(dt, this.player.pos, this.camera);
    this.ui.update(dt);
    this.input.endFrame();

    this.saveTimer -= dt;
    if (this.dirty && this.saveTimer <= 0) {
      this.saveTimer = 3;
      this.persist();
    }
    this.composer.render();
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

window.addEventListener('DOMContentLoaded', () => {
  // Give the browser a frame to paint the title screen before the heavy world build.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      window.game = new Game();
    } catch (err) {
      console.error(err);
      document.getElementById('loading').textContent = `Oops, something broke: ${err.message}`;
    }
  }, 30));
});
