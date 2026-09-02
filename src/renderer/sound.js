'use strict';

// ============================================================
//  提示音系统：Web Audio API 合成（无音频资源文件，安装包零增量）
//  音效风格：短促电子音，配合工业主题（清脆，不刺耳）
//  - ok      成功上行双音（保存/复制成功）
//  - err     低频错误音（失败提示）
//  - click   轻点导航（tick）
//  - done    任务完成琶音（Agent 跑完/更新就绪）
//  - notify  中性提示（信息提示）
//  静音开关存 localStorage；首次用户交互后才能激活 AudioContext
// ============================================================

const SOUND_KEY = 'gradResume.soundOn';

const Sound = {
  _ctx: null,
  enabled: (localStorage.getItem(SOUND_KEY) !== '0'), // 默认开

  _ensure() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  },

  // 单音：freq(Hz)、时长(ms)、音量、类型、延迟(ms)
  _tone(freq, dur, vol, type, delay, slideTo) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0) / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur / 1000);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur / 1000 + 0.02);
  },

  play(kind) {
    if (!this.enabled) return;
    try {
      if (kind === 'ok') {           // 成功：上行双音
        this._tone(660, 90, 0.12, 'sine');
        this._tone(880, 120, 0.12, 'sine', 90);
      } else if (kind === 'err') {   // 失败：低频短震
        this._tone(220, 160, 0.14, 'square', 0, 160);
      } else if (kind === 'click') { // 导航轻点
        this._tone(1200, 35, 0.06, 'triangle');
      } else if (kind === 'done') {  // 完成：三连琶音
        this._tone(523, 90, 0.11, 'sine');
        this._tone(659, 90, 0.11, 'sine', 90);
        this._tone(784, 160, 0.12, 'sine', 180);
      } else if (kind === 'notify') { // 中性提示
        this._tone(740, 80, 0.09, 'triangle');
      }
    } catch (_) { /* 音频不可用时静默，不影响功能 */ } // eslint-disable-line no-empty
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(SOUND_KEY, this.enabled ? '1' : '0');
    if (this.enabled) this.play('ok'); // 开启时给个反馈
    return this.enabled;
  }
};

window.Sound = Sound;
