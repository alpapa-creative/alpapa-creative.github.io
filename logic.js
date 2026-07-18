/* 純粋関数のみ（DOM禁止）。Node単体テスト対象: tests/logic.test.cjs */
'use strict';

const SiteLogic = {
  /** 値を [min, max] に収める */
  clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  },

  /**
   * ページ全体のスクロール進行度(0〜1)を計算する。
   * scrollY: 現在のスクロール量 / docHeight: 文書全体の高さ / viewH: ビューポート高さ
   * スクロール余地がない場合は 0。
   */
  scrollProgress(scrollY, docHeight, viewH) {
    const max = docHeight - viewH;
    if (max <= 0) return 0;
    return SiteLogic.clamp(scrollY / max, 0, 1);
  },

  /**
   * セクション境界ベースのステージ判定。
   * tops: 各ステージセクションの絶対Y座標（昇順）/ 判定線 = scrollY + viewH*ratio。
   * 判定線を越えた最後のセクションの添字を返す（越えていなければ0）。
   */
  stageFromTops(tops, scrollY, viewH, ratio) {
    const line = scrollY + viewH * ratio;
    let idx = 0;
    for (let i = 0; i < tops.length; i++) if (tops[i] <= line) idx = i;
    return idx;
  },

  /** ステージ番号 → HUD表示ラベル。範囲外は端に丸める */
  labelForStage(stageIndex, labels) {
    if (!labels || !labels.length) return '';
    const i = SiteLogic.clamp(Math.floor(stageIndex), 0, labels.length - 1);
    return labels[i];
  },

  /** MIDIノート番号 → 周波数(Hz)。A4(69)=440 */
  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  },

  /**
   * タイプライター用に文字列を表示単位へ分割する。
   * サロゲートペア（絵文字等）を壊さない。<br> は改行トークンとして温存。
   */
  typewriterChunks(text) {
    const out = [];
    const parts = String(text).split(/(<br\s*\/?>)/i);
    for (const part of parts) {
      if (/^<br\s*\/?>$/i.test(part)) { out.push('\n'); continue; }
      for (const ch of part) out.push(ch); // for..of はコードポイント単位
    }
    return out;
  },

  /**
   * 視差量を計算する。sectionTop からの相対スクロール × speed。
   * 過剰な移動を maxShift で制限（レイアウト破壊防止）。
   */
  parallaxShift(scrollY, sectionTop, speed, maxShift) {
    const raw = (scrollY - sectionTop) * speed;
    return SiteLogic.clamp(raw, -maxShift, maxShift);
  },

  /**
   * 歩行キャラのX座標(px)。進行度に応じて左端 margin から右端 (trackWidth - margin - charW) まで。
   */
  walkerX(progress, trackWidth, charW, margin) {
    const usable = Math.max(0, trackWidth - margin * 2 - charW);
    return margin + usable * SiteLogic.clamp(progress, 0, 1);
  },

  /**
   * 隠しコマンド判定。入力履歴 keys の末尾が sequence と一致したら true。
   */
  konamiMatch(keys, sequence) {
    if (keys.length < sequence.length) return false;
    const tail = keys.slice(-sequence.length);
    return sequence.every((k, i) => tail[i] === k);
  },
};

/* ブラウザ / Node 両対応 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SiteLogic;
} else {
  window.SiteLogic = SiteLogic;
}
