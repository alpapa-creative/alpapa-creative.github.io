/* alpapa creative サイト演出エンジン（素のJS・依存なし）
   純粋ロジックは logic.js（SiteLogic）側。ここはDOM操作と演出のみ。 */
'use strict';

/* =========================================================================
   調整用の定数（変更はここだけで完結させる）
   ========================================================================= */
const CONFIG = {
  // 問い合わせフォーム（ゲーム以外の相談窓口。alpapa.creative@gmail.com 名義のGoogleフォーム）
  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeGn24_kLcwJUFwSIALCem-8CCiHd-2NmWqWAHCuhEDRswkhQ/viewform',
  // 予備（現在の導線では未使用。将来メール導線を出すときに使う）
  CONTACT_EMAIL: 'alpapa.creative@gmail.com',
  COCONALA_URL: 'https://coconala.com/services/4311899',
  DEMO_PLAY_URL: 'https://alpapa-creative.github.io/jiiji-bike-journey/',

  // ステージ判定: data-stage 付きセクションの上端が「画面上から60%の線」を越えたら切替
  STAGE_LABELS: ['STAGE 1-1', 'STAGE 1-2', 'STAGE 1-3', 'STAGE 1-4', 'CLEAR!'],
  STAGE_RATIO: 0.6,
  // ステージ番号 → BGMパターン（タイトル/映像/Web=calm・ゲーム=adventure・CLEAR=clear）
  BGM_MAP: ['calm', 'adventure', 'calm', 'calm', 'clear'],
  BGM_VOL: { lead: 0.02, bass: 0.028, hat: 0.006 },
  COIN_FLY_MS: 600,          // ブロック→HUDへコインが飛ぶ時間
  TYPE_SPEED_MS: 34,         // タイプライターの1文字間隔
  TYPE_START_DELAY_MS: 250,  // ウィンドウ表示からタイプ開始までの間
  REVEAL_THRESHOLD: 0.25,    // IntersectionObserver の発火しきい値
  PARALLAX_MAX_SHIFT: 140,   // 視差の最大移動量(px)
  WALKER: {                  // E9 歩くドット絵キャラ
    SIZE: 36,                // 表示サイズ(px)
    MARGIN: 10,              // 左右マージン(px)
    FRAME_MS: 180,           // 歩行アニメの足踏み間隔
    JUMP_MS: 420,            // ステージ切替時のジャンプ時間
  },
  CONFETTI_COUNT: 80,        // 隠しコマンドの紙吹雪の数
  LOADER: { MIN_MS: 700, MAX_MS: 3000, FADE_MS: 450 }, // ローディング画面（最長3秒で必ず開ける）
  SECRET_TAPS: 7,            // モバイル用: コインHUDを連打する回数
  SECRET_TAP_WINDOW_MS: 3000,
  KONAMI: ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'],
};

const L = window.SiteLogic;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 共有ドット絵スプライト（ウォーカー / ローダーで使用） ----------
   16x16・2フレーム。0=透明 1=紺(服) 2=肌 3=金(リュック) 4=白 5=こげ茶(髪/靴) */
const SPRITE = {
  P: ['', '#20315e', '#f0c8a0', '#e9bd63', '#ffffff', '#4a3020'],
  F1: [
    '0000055555000000','0000555555500000','0000552222550000','0000522422250000',
    '0000522222250000','0000052222500000','0000331111330000','0003311111133000',
    '0003311111133000','0000331111330000','0000011111100000','0000011011000000',
    '0000110011000000','0000110001100000','0000550000550000','0005500000055000',
  ],
  F2: [
    '0000055555000000','0000555555500000','0000552222550000','0000522422250000',
    '0000522222250000','0000052222500000','0000331111330000','0003311111133000',
    '0003311111133000','0000331111330000','0000011111100000','0000011011000000',
    '0000011011000000','0000011011000000','0000005500000000','0000055550000000',
  ],
  draw(ctx, frame) {
    ctx.clearRect(0, 0, 16, 16);
    frame.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const c = SPRITE.P[+row[x]];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    });
  },
};

/* ---------- サウンド（WebAudio自作チップ音・素材ファイル不要） ---------- */
const Sound = {
  on: false,
  ctx: null,
  ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); return this.ctx; },
  beep(freq, dur, delay, type, vol) {
    if (!this.on) return;
    const ctx = this.ensure();
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.04, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur);
  },
  coin()   { this.beep(988, .09, 0); this.beep(1319, .22, .08); },
  item()   { this.beep(659, .1, 0); this.beep(784, .1, .09); this.beep(988, .1, .18); this.beep(1319, .25, .27); },
  clear()  { [523,659,784,1047].forEach((f,i)=>this.beep(f,.16,i*.11)); },
  secret() { [1047,988,880,784,880,988,1047,1319].forEach((f,i)=>this.beep(f,.09,i*.07,'triangle',.05)); },
};

/* ---------- BGM（WebAudioステップシーケンサ・完全自作＝ライセンスクリーン） ----------
   16ステップ=2小節をループ。ノート={s:ステップ, ch:チャンネル, m:MIDI, len:ステップ数}。
   パターンの切替はステージ変化時に予約し、次のループ先頭で反映（曲が途切れない）。 */
const Music = {
  PATTERNS: {
    calm: { stepDur: 0.26, notes: [ // しっとり探索系（Am・ゆったり）
      {s:0,ch:'bass',m:45,len:4},{s:4,ch:'bass',m:52,len:4},{s:8,ch:'bass',m:41,len:4},{s:12,ch:'bass',m:43,len:4},
      {s:2,ch:'lead',m:72,len:2},{s:6,ch:'lead',m:76,len:2},{s:10,ch:'lead',m:74,len:2},{s:14,ch:'lead',m:69,len:2},
    ]},
    adventure: { stepDur: 0.15, notes: [ // 冒険系（C・8分駆動。ハットは耳障りなノイズになるため不使用）
      {s:0,ch:'bass',m:48,len:1},{s:2,ch:'bass',m:48,len:1},{s:4,ch:'bass',m:43,len:1},{s:6,ch:'bass',m:43,len:1},
      {s:8,ch:'bass',m:45,len:1},{s:10,ch:'bass',m:45,len:1},{s:12,ch:'bass',m:41,len:1},{s:14,ch:'bass',m:43,len:1},
      {s:0,ch:'lead',m:72,len:2},{s:2,ch:'lead',m:74,len:1},{s:4,ch:'lead',m:76,len:2},{s:6,ch:'lead',m:79,len:2},
      {s:8,ch:'lead',m:76,len:1},{s:10,ch:'lead',m:74,len:1},{s:12,ch:'lead',m:72,len:2},{s:15,ch:'lead',m:67,len:1},
    ]},
    clear: { stepDur: 0.2, notes: [ // ファンファーレ風ループ（C分散和音）
      {s:0,ch:'bass',m:48,len:8},{s:8,ch:'bass',m:43,len:8},
      {s:0,ch:'lead',m:72,len:2},{s:2,ch:'lead',m:76,len:2},{s:4,ch:'lead',m:79,len:2},{s:6,ch:'lead',m:84,len:2},
      {s:8,ch:'lead',m:79,len:2},{s:10,ch:'lead',m:76,len:2},{s:12,ch:'lead',m:74,len:2},{s:14,ch:'lead',m:76,len:2},
    ]},
  },
  timer: null, step: 0, nextTime: 0, current: 'calm', pending: null, noiseBuf: null,

  start(stage) {
    if (this.timer) return;
    const ctx = Sound.ensure();
    if (ctx.state === 'suspended') ctx.resume();
    this.current = CONFIG.BGM_MAP[stage] || 'calm';
    this.pending = null;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 80);
  },
  stop() { clearInterval(this.timer); this.timer = null; },
  setStage(stage) {
    const p = CONFIG.BGM_MAP[stage] || 'calm';
    if (p !== this.current) this.pending = p; // 次のループ先頭で切替
  },
  tick() {
    const ctx = Sound.ctx;
    while (this.nextTime < ctx.currentTime + 0.3) {
      const pos = this.step % 16;
      if (pos === 0 && this.pending) { this.current = this.pending; this.pending = null; }
      const P = this.PATTERNS[this.current];
      for (const n of P.notes) if (n.s === pos) this.note(n, this.nextTime, P.stepDur);
      this.nextTime += P.stepDur;
      this.step++;
    }
  },
  note(n, t, stepDur) {
    const ctx = Sound.ctx, V = CONFIG.BGM_VOL;
    if (n.ch === 'hat') { // ノイズハット（現在未使用。使う場合もハイパス＋アタックでプツプツ音を防ぐ）
      if (!this.noiseBuf) {
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(V.hat, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(hp).connect(g).connect(ctx.destination); src.start(t); src.stop(t + 0.05);
      return;
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = n.ch === 'bass' ? 'triangle' : 'square';
    osc.frequency.value = L.midiToFreq(n.m);
    const dur = (n.len || 1) * stepDur * 0.9;
    const vol = n.ch === 'bass' ? V.bass : V.lead;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  },
};

/* ---------- 起動 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initLoader();
  injectLinks();
  initHud();
  initBlocks();
  initReveals();
  initTypewriters();
  if (!reduceMotion) initParallax();
  if (!reduceMotion) initWalker();
  initSecret();
});

/* ---------- ローディング画面 ----------
   実読み込み(window load)と連動しつつ、MIN_MS〜MAX_MSで必ず開ける。 */
function initLoader() {
  const loader = document.getElementById('loader');
  const fill = document.getElementById('loader-fill');
  const canvas = document.getElementById('loader-sprite');
  if (!loader) return;
  const T = CONFIG.LOADER;
  const t0 = performance.now();
  const ctx = canvas.getContext('2d');
  SPRITE.draw(ctx, SPRITE.F1);

  let flip = false;
  const stepTimer = reduceMotion ? 0 : setInterval(() => {
    flip = !flip;
    SPRITE.draw(ctx, flip ? SPRITE.F2 : SPRITE.F1); // その場で足踏み
  }, 180);

  // 疑似プログレス（実loadまでは90%止まり）
  let fake = 0;
  const progTimer = setInterval(() => {
    fake = Math.min(90, fake + 12 + Math.random() * 10);
    fill.style.width = fake + '%';
  }, 160);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const wait = Math.max(0, T.MIN_MS - (performance.now() - t0));
    setTimeout(() => {
      clearInterval(progTimer);
      fill.style.width = '100%';
      setTimeout(() => {
        loader.classList.add('done');
        setTimeout(() => { clearInterval(stepTimer); loader.remove(); }, T.FADE_MS + 50);
      }, reduceMotion ? 0 : 200);
    }, wait);
  };
  window.addEventListener('load', finish);
  setTimeout(finish, T.MAX_MS); // 読み込みが遅くても必ず開ける
}

/* ---------- リンク注入（実URLをHTMLに直書きしないための一元管理） ---------- */
function injectLinks() {
  document.querySelectorAll('[data-link="coconala"]').forEach(a => { a.href = CONFIG.COCONALA_URL; a.target = '_blank'; a.rel = 'noopener'; });
  document.querySelectorAll('[data-link="demo"]').forEach(a => { a.href = CONFIG.DEMO_PLAY_URL; a.target = '_blank'; a.rel = 'noopener'; });
  // フォーム（ゲーム以外の相談窓口）。URL未設定の間はボタンを出さず「準備中」を表示
  const formOk = CONFIG.FORM_URL && CONFIG.FORM_URL.indexOf('__') === -1;
  document.querySelectorAll('[data-link="form"]').forEach(a => {
    if (formOk) {
      a.href = CONFIG.FORM_URL; a.target = '_blank'; a.rel = 'noopener';
    } else {
      a.style.display = 'none';
      const pending = document.getElementById('form-pending');
      if (pending) pending.hidden = false;
    }
  });
}

/* ---------- HUD（進行ゲージ・STAGE表示・コイン・サウンド） ---------- */
let coinCount = 0;
let currentStage = -1;
let stageJumpCb = null; // ステージが変わったらウォーカーがジャンプ

function initHud() {
  const bar = document.getElementById('hud-bar');
  const label = document.getElementById('hud-stage');
  const soundBtn = document.getElementById('hud-sound');

  // ステージ境界 = data-stage 付きセクションの絶対Y座標（リサイズで再計測）
  const sections = [...document.querySelectorAll('[data-stage]')]
    .sort((a, b) => +a.getAttribute('data-stage') - +b.getAttribute('data-stage'));
  let tops = [];
  const measure = () => {
    tops = sections.map(s => s.getBoundingClientRect().top + window.scrollY);
  };
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure); // 画像・動画ロード後に高さが変わるため

  const update = (silent) => {
    const p = L.scrollProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight);
    bar.style.transform = 'scaleX(' + p + ')';
    const st = L.stageFromTops(tops, window.scrollY, window.innerHeight, CONFIG.STAGE_RATIO);
    if (st !== currentStage) {
      currentStage = st;
      label.textContent = L.labelForStage(st, CONFIG.STAGE_LABELS);
      Music.setStage(st);
      if (!silent && stageJumpCb) { Sound.coin(); stageJumpCb(); } // 境界通過の瞬間にジャンプ＋SE
    }
    window.__siteProgress = p; // walker が参照
  };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(() => { update(false); ticking = false; }); }
  }, { passive: true });
  update(true); // 初期表示はジャンプ・SEなしで状態だけ合わせる

  soundBtn.addEventListener('click', () => {
    Sound.on = !Sound.on;
    soundBtn.classList.toggle('is-on', Sound.on);
    soundBtn.setAttribute('aria-pressed', String(Sound.on));
    if (Sound.on) { Sound.coin(); Music.start(currentStage); }
    else { Music.stop(); }
  });
}

function addCoin() {
  coinCount++;
  const el = document.getElementById('hud-coins');
  el.textContent = '×' + String(coinCount).padStart(2, '0');
  el.parentElement.classList.remove('bump');
  void el.parentElement.offsetWidth; // reflowでアニメ再発火
  el.parentElement.classList.add('bump');
}

/* ---------- E2: ?ブロック（叩く→SE→コインがHUDへ飛ぶ→加算） ---------- */
function initBlocks() {
  const blocks = document.querySelectorAll('.qblock');
  if (!blocks.length) return;

  // 16x16 の?ブロックをドット絵で描画（0=透明 1=縁 2=金 3=明金 4=影 5=?の白）
  const P = ['', '#241a05', '#e9bd63', '#ffd98a', '#b9903f', '#fff6e0'];
  const ART = [
    '1111111111111111','1332222222222241','1322222222222241','1222225555222241',
    '1222255225522241','1222255225522241','1222222225522241','1222222255222241',
    '1222222552222241','1222222552222241','1222222222222241','1222222552222241',
    '1222222552222241','1222222222222241','1244444444444441','1111111111111111',
  ];
  const drawBlock = (canvas) => {
    const ctx = canvas.getContext('2d');
    ART.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const c = P[+row[x]];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    });
  };

  const hit = (block) => {
    // 叩かれた絵（バウンド）と音を同じ瞬間に出す
    block.classList.remove('bump');
    void block.offsetWidth;
    block.classList.add('bump');
    Sound.coin();
    if (stageJumpCb) stageJumpCb(); // ブロックを叩いた瞬間、キャラも必ずジャンプ（因果を統一）
    if (reduceMotion) { addCoin(); return; }
    // コインがブロックからHUDカウンタへ飛ぶ。着弾で加算
    const from = block.getBoundingClientRect();
    const to = document.getElementById('hud-coin-wrap').getBoundingClientRect();
    const c = document.createElement('i');
    c.className = 'fly-coin';
    c.style.left = (from.left + from.width / 2 - 8) + 'px';
    c.style.top = (from.top - 10) + 'px';
    document.body.appendChild(c);
    void c.offsetWidth;
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top - 10 + 8);
    c.style.transform = 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px) scale(.65)';
    c.style.opacity = '0.15';
    setTimeout(() => { c.remove(); addCoin(); }, CONFIG.COIN_FLY_MS);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      hit(e.target); // 画面に入った瞬間に1回叩かれる
    });
  }, { threshold: 0.6 }); // 0.9だと高速スクロール時に取りこぼしうるため緩めに

  blocks.forEach(b => {
    drawBlock(b);
    io.observe(b);
    b.addEventListener('click', () => hit(b)); // タップで何度でも叩ける
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(b); }
    });
  });
}

/* ---------- E5/汎用: 出現演出 ---------- */
function initReveals() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      io.unobserve(el);
      el.classList.add('revealed');
      const fx = el.getAttribute('data-fx');
      if (fx === 'item') { Sound.item(); }
      if (fx === 'clear') { Sound.clear(); }
    }
  }, { threshold: CONFIG.REVEAL_THRESHOLD });
  document.querySelectorAll('[data-fx]').forEach(el => {
    if (reduceMotion) { el.classList.add('revealed'); return; }
    io.observe(el);
  });
}

/* ---------- E3: RPGウィンドウのタイプライター ---------- */
function initTypewriters() {
  const targets = document.querySelectorAll('[data-type]');
  targets.forEach(el => {
    const text = el.getAttribute('data-type');
    el.setAttribute('aria-label', text.replace(/<br\s*\/?>/gi, ' '));
    if (reduceMotion) { render(el, L.typewriterChunks(text).length, L.typewriterChunks(text)); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        const chunks = L.typewriterChunks(text);
        let i = 0;
        setTimeout(function tick() {
          i++;
          render(el, i, chunks);
          if (i < chunks.length) setTimeout(tick, CONFIG.TYPE_SPEED_MS);
          else el.classList.add('type-done');
        }, CONFIG.TYPE_START_DELAY_MS);
      });
    }, { threshold: 0.6 });
    io.observe(el);
  });
  function render(el, count, chunks) {
    el.textContent = '';
    chunks.slice(0, count).forEach(c => {
      if (c === '\n') el.appendChild(document.createElement('br'));
      else el.appendChild(document.createTextNode(c));
    });
    if (count >= chunks.length) el.classList.add('type-done');
  }
}

/* ---------- E4: 視差 ---------- */
function initParallax() {
  const layers = [...document.querySelectorAll('[data-parallax]')].map(el => ({
    el,
    speed: parseFloat(el.getAttribute('data-parallax')) || 0.2,
    top: 0,
  }));
  if (!layers.length) return;
  const measure = () => layers.forEach(l => {
    const sec = l.el.closest('section') || l.el.parentElement;
    l.top = sec.getBoundingClientRect().top + window.scrollY;
  });
  measure();
  window.addEventListener('resize', measure);
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      layers.forEach(l => {
        const shift = L.parallaxShift(y, l.top, l.speed, CONFIG.PARALLAX_MAX_SHIFT);
        l.el.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0)';
      });
      ticking = false;
    });
  }, { passive: true });
}

/* ---------- E9: 歩くドット絵キャラ ---------- */
function initWalker() {
  const wrap = document.getElementById('walker');
  const canvas = document.getElementById('walker-canvas');
  if (!wrap || !canvas) return;
  const S = CONFIG.WALKER;
  const ctx = canvas.getContext('2d');
  canvas.width = 16; canvas.height = 16;
  canvas.style.width = S.SIZE + 'px';
  canvas.style.height = S.SIZE + 'px';

  const F1 = SPRITE.F1, F2 = SPRITE.F2;
  const draw = (frame) => SPRITE.draw(ctx, frame);

  /* 常時rAFは回さない（電池・描画負荷対策）。
     - 足踏み: スクロール中のみ FRAME_MS 間隔で切替（止まったら直立フレーム）
     - 位置: scroll/resize イベントで更新
     - ジャンプ: ステージ切替時だけ短命の rAF */
  let frameFlip = false, lastFrame = 0, jumpY = 0, idleTimer = 0;

  function place() {
    const p = window.__siteProgress || 0;
    const x = L.walkerX(p, window.innerWidth, S.SIZE, S.MARGIN);
    wrap.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + (-jumpY).toFixed(1) + 'px,0)';
  }
  function onScroll() {
    const now = performance.now();
    if (now - lastFrame > S.FRAME_MS) { frameFlip = !frameFlip; lastFrame = now; draw(frameFlip ? F1 : F2); }
    place();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => draw(F1), S.FRAME_MS * 2); // 停止したら直立
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', place);

  stageJumpCb = () => { // ジャンプのみ（SEは呼び出し側が鳴らす）
    const t0 = performance.now();
    (function hop(now) {
      const t = (now - t0) / S.JUMP_MS;
      jumpY = t < 1 ? Math.sin(t * Math.PI) * 14 : 0;
      place();
      if (t < 1) requestAnimationFrame(hop);
    })(t0);
  };

  draw(F1);
  place();
}

/* ---------- E8: 隠しコマンド ---------- */
function initSecret() {
  const keys = [];
  window.addEventListener('keydown', (e) => {
    keys.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (keys.length > 20) keys.shift();
    if (L.konamiMatch(keys, CONFIG.KONAMI)) { keys.length = 0; triggerSecret(); }
  });
  // モバイル: コインHUDを連打
  let taps = [];
  const coinHud = document.getElementById('hud-coin-wrap');
  coinHud.addEventListener('click', () => {
    const now = Date.now();
    taps = taps.filter(t => now - t < CONFIG.SECRET_TAP_WINDOW_MS);
    taps.push(now);
    if (taps.length >= CONFIG.SECRET_TAPS) { taps = []; triggerSecret(); }
  });
}

let secretDone = false;
function triggerSecret() {
  if (secretDone) return;
  secretDone = true;
  Sound.secret();
  confetti();
  const msg = document.getElementById('secret-msg');
  msg.classList.add('show');
  addCoin();
  setTimeout(() => msg.classList.remove('show'), 6000);
  setTimeout(() => { secretDone = false; }, 8000);
}

function confetti() {
  const colors = ['#e9bd63', '#8b7bf0', '#e88fb8', '#8ef0b8', '#f5efe4'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < CONFIG.CONFETTI_COUNT; i++) {
    const d = document.createElement('i');
    d.className = 'confetti';
    d.style.left = (Math.random() * 100) + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDelay = (Math.random() * .8) + 's';
    d.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
    d.addEventListener('animationend', () => d.remove());
    frag.appendChild(d);
  }
  document.body.appendChild(frag);
}
