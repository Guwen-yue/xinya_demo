/* =========================================================
 * 心芽守护 — 方案 A 纯前端交互逻辑
 * AI 能力为前端规则模拟，保留接口注释，后续可接 TRAE NLP / ASR / TTS。
 * 数据保存在 localStorage，异常时降级为内存变量，保证演示不中断。
 * ========================================================= */
(function () {
  'use strict';

  /* ---------- 安全存储（localStorage 异常时降级内存） ---------- */
  const memoryStore = {};
  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? def : JSON.parse(v);
      } catch (e) {
        return key in memoryStore ? memoryStore[key] : def;
      }
    },
    set(key, val) {
      memoryStore[key] = val;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
    },
    remove(key) {
      delete memoryStore[key];
      try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
    }
  };

  /* ---------- 工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const iconSvg = (name, fill) =>
    '<svg class="icon' + (fill ? ' icon-fill' : '') + '" aria-hidden="true"><use href="#icon-' + name + '"/></svg>';
  const todayStr = () => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const dateStrOffset = (off) => {
    const d = new Date();
    d.setDate(d.getDate() + off);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const theme = {
    text: '#26332d',
    soft: '#68766f',
    border: '#dfe8df',
    grid: '#edf3ed',
    primary: '#5f8f7b',
    primaryDeep: '#3f6d5b',
    accent: '#5e95b5',
    sun: '#e6b85c',
    danger: '#d75e59',
    plum: '#836c95'
  };
  let toastTimer = null;

  function toast(message) {
    const el = $('#toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* ---------- 数据：情绪关键词与回复库 ---------- */
  const HIGH_RISK_WORDS = ['讨厌自己', '没用', '不想活', '轻生', '自残', '消失', '撑不下去', '欺凌', '活着没意思', '想死', '了结', '解脱'];
  const EXAM_WORDS = ['考试', '复习', '成绩', '刷题', '期中', '期末', '考砸', '排名'];
  const RELATION_WORDS = ['吵架', '爸妈', '家长', '朋友', '同学', '父母', '妈妈', '爸爸', '冷战', '孤立'];
  const SLEEP_WORDS = ['睡不着', '失眠', '熬夜', '睡不好', '做梦', '惊醒'];

  const ENCOURAGEMENTS = [
    '你愿意把烦恼说出来，本身就很勇敢。今天的你，已经比昨天多照顾了自己一点。',
    '雨会停的，天会亮的。你不需要一下子变好，慢慢来就好。',
    '世界很大，烦恼很小。给你一个看不见的拥抱。',
    '你比你想象的更有力量。记得给自己一杯温水，好好呼吸。',
    '难过的时候，允许自己停下来休息。你值得被温柔对待。',
    '每一个难熬的夜晚都会过去。明天，又是新的一天。',
    '你不需要完美，你只需要做自己。加油呀，小芽。'
  ];
  const BAD_WORDS = ['辱骂', '暴力', '打人', '去死', '杀', '诱导伤害', '教唆'];

  const LESSONS = [
    { title: '考前减压', body: '考试前紧张是正常的身体反应，不是你不够好。试着把复习拆成 25 分钟一段，每段之间休息 5 分钟。睡前做一次 4-7-8 呼吸：吸气 4 秒，屏住 7 秒，呼气 8 秒。你不需要复习完所有东西，只需要比昨天多记住一点。' },
    { title: '亲子沟通', body: '当和爸妈有分歧时，先说出自己的感受，而不是指责对方。例如「我最近很累，我希望你能先听我说」。大人们有时也会焦虑，他们不是不爱你，只是表达方式不同。给彼此一点时间和耐心。' },
    { title: '接纳自己', body: '每个人都有不擅长的事，这不代表你没有价值。试着每天写下一件自己做得还不错的小事，哪怕只是「今天按时起床了」。你不需要和别人比较，你只需要成为更舒服的自己。' },
    { title: '拒绝冷暴力', body: '如果被孤立或嘲讽，那不是你的错。冷暴力是一种伤害，你不必独自承受。可以告诉一位你信任的大人，也可以在教师端匿名上报。你值得被尊重，也值得拥有安全的关系。' }
  ];

  const HABIT_TEMPLATES = {
    exam: {
      match: ['考试', '复习', '考前', '学习', '刷题'],
      icon: 'sprout',
      badge: '稳定小芽',
      remind: '今天的小芽提醒：复习不用贪多，专注 25 分钟就很棒。记得喝水、伸展一下。',
      tasks: ['25 分钟复习一个小知识点', '10 分钟错题复盘', '5 分钟呼吸放松', '睡前写下明天最重要的一件事']
    },
    sleep: {
      match: ['熬夜', '睡眠', '失眠', '早睡', '作息'],
      icon: 'moon',
      badge: '早睡小芽',
      remind: '今天的小芽提醒：今晚试着 22:30 前放下手机，让身体慢慢安静下来。',
      tasks: ['22:10 放下手机', '22:20 洗漱', '22:30 播放助眠白噪音', '睡前不刷短视频']
    },
    delay: {
      match: ['拖延', '效率', '专注', '懒'],
      icon: 'sparkles',
      badge: '行动小芽',
      remind: '今天的小芽提醒：先做 5 分钟试试，往往开始之后就没有那么难了。',
      tasks: ['把今天最难的事拆成 3 小步', '先做 5 分钟再说', '完成一步就给自己一个小奖励', '晚上复盘今天做到的一件事']
    }
  };

  /* ========================================================
   * 初始化模拟数据
   * ======================================================== */
  function initMockData() {
    if (store.get('xy_inited', false)) return;
    // 14 天心情数据
    const weathers = [
      { w: '晴天', s: 8 }, { w: '多云', s: 6 }, { w: '小雨', s: 4 }, { w: '暴雨', s: 2 }
    ];
    const mood = [];
    for (let i = 13; i >= 0; i--) {
      // 让数据有一些低落波动
      const low = (i >= 8 && i <= 11) || i === 4; // 几天偏低
      const w = low ? weathers[2 + (i % 2)] : weathers[i % 3];
      const stress = [];
      if (i % 2 === 0) stress.push('刷题');
      if (low) stress.push('熬夜');
      if (i % 5 === 0) stress.push('亲子争吵');
      if (i % 7 === 0) stress.push('同学关系');
      if (i % 4 === 0) stress.push('运动');
      if (stress.length === 0) stress.push('休息');
      mood.push({
        date: dateStrOffset(-i),
        weather: w.w,
        score: w.s,
        stress: stress,
        note: ''
      });
    }
    store.set('xy_mood', mood);
    store.set('xy_permission', { parentView: true });
    store.set('xy_inited', true);
  }

  /* ========================================================
   * 端口切换 / 模块切换
   * ======================================================== */
  function switchPort(port) {
    $$('.tab').forEach(t => {
      const active = t.dataset.port === port;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel-' + port);
    if (panel) panel.classList.add('active');
    // 进入对应端口时刷新其内容
    if (port === 'student') { renderMoodCharts(); renderCalendar(); }
    if (port === 'parent') renderParent();
    if (port === 'teacher') renderTeacher();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchModule(mod) {
    $$('.subtab').forEach(t => {
      const active = t.dataset.module === mod;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.sub-panel').forEach(p => p.classList.remove('active'));
    const sp = $('#mod-' + mod);
    if (sp) sp.classList.add('active');
    if (mod === 'mood') { renderMoodCharts(); renderCalendar(); }
    if (mod === 'relax') renderLessons();
  }

  /* ========================================================
   * 模块 1：AI 暖心树洞
   * ======================================================== */

  const TREEHOLE_INITIAL_MESSAGE = '你好呀，我是心芽。可以把今天不舒服的事写在这里，我会认真听。';
  let treeholeMessages = [];

  function startNewTreeholeConversation() {
    treeholeMessages = [];
    store.remove('xy_treehole');
    const log = $('#treehole-log');
    if (log) {
      log.innerHTML = '';
      appendBubble('ai', TREEHOLE_INITIAL_MESSAGE);
    }
    const emotionBox = $('#treehole-emotion');
    if (emotionBox) emotionBox.hidden = true;
  }

  // 情绪识别 + 风险分级（规则模拟，后续可替换为 TRAE NLP）
  function analyzeEmotion(text) {
    const has = (arr) => arr.some(w => text.indexOf(w) >= 0);

    if (has(HIGH_RISK_WORDS)) {
      return { level: 'high', tags: ['高风险', '需要支持'], intensity: 95, type: 'crisis' };
    }
    const tags = [];
    let type = 'normal';
    if (has(EXAM_WORDS)) { tags.push('考前焦虑'); type = 'exam'; }
    if (has(RELATION_WORDS)) { tags.push('人际/亲子压力'); type = type === 'normal' ? 'relation' : type; }
    if (has(SLEEP_WORDS)) { tags.push('睡眠压力'); type = type === 'normal' ? 'sleep' : type; }
    if (tags.length === 0) tags.push('情绪低落');

    // 中度低落：出现「难过/累/烦/没意思/孤独」且无明确压力源
    const midWords = ['难过', '好累', '很烦', '没意思', '孤独', '空虚', '想哭'];
    const isMid = has(midWords);
    const level = isMid ? 'mid' : 'normal';
    if (isMid) tags.push('情绪低落');
    const intensity = isMid ? 70 : (tags.length >= 2 ? 60 : 45);
    return { level, tags, intensity, type };
  }

  // 生成共情式回复（规则模拟）
  function generateSupportReply(emo) {
    const map = {
      exam: {
        empathy: '听起来你这段时间真的很累，复习压力压在心上，换谁都会喘不过气。',
        sort: '你现在主要承受的是考前焦虑——担心复习不完、担心结果不如预期。',
        tips: ['试试把任务拆成 25 分钟一段，每段之间休息 5 分钟。', '今晚先做一次 4-7-8 呼吸，让自己慢慢安静下来。', '记得：你不需要复习完所有东西，只需要比昨天多记一点。']
      },
      relation: {
        empathy: '被亲近的人不理解，是真的会很疼。我听到你了。',
        sort: '你现在主要承受的是人际或亲子之间的张力。',
        tips: ['可以先说出感受而不是指责，例如「我最近很累，希望你能先听我说」。', '给彼此一点时间和空间，不必立刻解决。', '如果沟通很难，写一张小纸条也是表达。']
      },
      sleep: {
        empathy: '睡不好的夜晚特别难熬，白天的疲惫也会让心情更沉。',
        sort: '你现在主要承受的是睡眠压力——身体没有休息好。',
        tips: ['睡前 30 分钟放下手机，让大脑慢下来。', '可以打开减压宝库里的雨声白噪音陪伴你。', '白天晒晒太阳、动一动，晚上会更容易入睡。']
      },
      normal: {
        empathy: '我听到你了，这段时间你一定不容易。',
        sort: '有些情绪暂时还说不清来源，那也没关系。',
        tips: ['先做一次深呼吸，把肩膀放下来。', '今天为自己做一件小事，比如喝杯温水。', '如果想多说一点，我一直在。']
      }
    };
    const mid = {
      empathy: '我能感觉到你最近有点低落，这种闷闷的感觉，真的很消耗人。',
      sort: '你现在的情绪偏低落，不算严重的危机，但值得被照顾。',
      tips: ['试试减压宝库里的 5 分钟呼吸练习。', '今天给自己定一个很小、一定能完成的目标。', '如果连续几天都提不起劲，可以告诉一位信任的大人。']
    };
    const base = emo.level === 'mid' ? mid : (map[emo.type] || map.normal);
    return base;
  }

  function appendBubble(role, text) {
    const log = $('#treehole-log');
    const b = document.createElement('div');
    b.className = 'bubble ' + (role === 'user' ? 'user' : 'ai');
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function renderEmotionBox(emo) {
    const box = $('#treehole-emotion');
    box.hidden = false;
    const tagsEl = $('#emotion-tags');
    tagsEl.innerHTML = '';
    emo.tags.forEach(tg => {
      const span = document.createElement('span');
      span.className = 'emotion-tag';
      span.textContent = tg;
      tagsEl.appendChild(span);
    });
    $('#intensity-fill').style.width = emo.intensity + '%';
    $('#intensity-text').textContent = emo.intensity + '/100';
    const sug = $('#emotion-suggestions');
    sug.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'suggestion-item';
    note.textContent = '我正在认真听你说，回复会一点点出现在下方气泡里。';
    sug.appendChild(note);
  }

  function scrollChatBottom() {
    const log = $('#treehole-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // 流式拉取模型回复：读取 SSE，每收到一个 delta 调用 onChunk(累计文本)
  // onMeta(meta) 在收到 LLM 情绪强度元信息时回调，用于同步进度条与标签
  async function streamModelReply(text, emo, onChunk, onMeta) {
    const history = treeholeMessages.slice(-8);
    const res = await fetch('/api/treehole-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, localEmotion: emo, history })
    });
    if (!res.ok || !res.body) throw new Error('treehole stream failed: ' + res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const evt = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = evt.split('\n').map(s => s.trim()).find(s => s.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.error) throw new Error(obj.error);
            if (obj.meta && onMeta) onMeta(obj.meta);
            if (obj.delta) { full += obj.delta; onChunk(full); }
          } catch (e) {
            if (e.message && e.message.indexOf('{') < 0) throw e;
          }
        }
      }
    } catch (e) {
      // Vercel Hobby 10s 强制断开或网络中断：已收到部分 LLM 内容则保留，不触发本地兜底覆盖
      if (full) return full;
      throw e;
    }
    return full;
  }

  async function handleSend(text) {
    text = (text || '').trim();
    if (!text) return;
    appendBubble('user', text);
    $('#treehole-input').value = '';
    $('#treehole-input').style.height = 'auto';
    treeholeMessages.push({ role: 'user', content: text });

    const emo = analyzeEmotion(text);
    const log = store.get('xy_treehole', []);
    log.push({ role: 'user', text, emotion: emo.tags, intensity: emo.intensity, ts: Date.now() });

    if (emo.level === 'high') {
      store.set('xy_treehole', log);
      showCrisisModal();
      const crisisReply = '我注意到你可能正在经历很强烈的痛苦。请先不要独自承受，上面弹窗里有一些可以帮到你的渠道。';
      appendBubble('ai', crisisReply);
      treeholeMessages.push({ role: 'assistant', content: crisisReply });
      return;
    }

    renderEmotionBox(emo);
    const pending = appendBubble('ai', '');
    pending.classList.add('typing');
    scrollChatBottom();

    let modelText = '';
    try {
      modelText = await streamModelReply(text, emo, (current) => {
        pending.textContent = current;
        scrollChatBottom();
      }, (meta) => {
        // LLM 识别的情绪强度和标签，同步到情绪盒子的进度条与标签
        if (meta.intensity != null) {
          emo.intensity = meta.intensity;
          const fill = $('#intensity-fill');
          const txt = $('#intensity-text');
          if (fill) fill.style.width = meta.intensity + '%';
          if (txt) txt.textContent = meta.intensity + '/100';
        }
        if (meta.tags && meta.tags.length) {
          emo.tags = meta.tags;
          const tagsEl = $('#emotion-tags');
          if (tagsEl) {
            tagsEl.innerHTML = '';
            meta.tags.forEach(tg => {
              const span = document.createElement('span');
              span.className = 'emotion-tag';
              span.textContent = tg;
              tagsEl.appendChild(span);
            });
          }
        }
      });
    } catch (e) {
      // 本地静态打开 / 未配置 API Key / 离线时，回退到规则话术，保证演示不中断
      console.warn('treehole model unavailable, fallback to local rule:', e);
    }

    if (!modelText) {
      const fallback = generateSupportReply(emo);
      modelText = fallback.empathy + '\n' + fallback.sort + '\n你可以参考上面的建议，慢慢来。';
      pending.textContent = modelText;
      scrollChatBottom();
    }

    pending.classList.remove('typing');
    treeholeMessages.push({ role: 'assistant', content: modelText });
    log.push({ role: 'ai', text: modelText, emotion: emo.tags, ts: Date.now() });
    store.set('xy_treehole', log);
  }

  function showCrisisModal() {
    $('#crisis-modal').hidden = false;
    $('#crisis-feedback').hidden = true;
  }
  function hideCrisisModal() { $('#crisis-modal').hidden = true; }

  function clearTreehole() {
    store.remove('xy_treehole');
    treeholeMessages = [];
    $('#treehole-log').innerHTML = '<div class="bubble ai">记录已清空。无论什么时候，我都在这里。</div>';
    $('#treehole-emotion').hidden = true;
    toast('树洞记录已清空');
  }

  /* ========================================================
   * 语音倾诉：Web Audio 录音 → 16kHz/16bit/mono WAV → /api/asr（百度 ASR）
   * Secret Key 留在服务端，前端只负责采集与回填。
   * ======================================================== */
  const voiceRecorder = {
    audioContext: null,
    mediaStream: null,
    processor: null,
    source: null,
    chunks: [],
    sampleRate: 0,
    recording: false,

    async start() {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctx();
      this.sampleRate = this.audioContext.sampleRate;
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.chunks = [];
      this.processor.onaudioprocess = (e) => {
        if (!this.recording) return;
        const input = e.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(input));
      };
      // ScriptProcessor 需连到 destination 才会触发 onaudioprocess；用 0 增益节点避免回声
      const mute = this.audioContext.createGain();
      mute.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(mute);
      mute.connect(this.audioContext.destination);
      this.recording = true;
    },

    stop() {
      this.recording = false;
      return new Promise((resolve) => {
        setTimeout(() => {
          const wav = this._encodeWav();
          this._cleanup();
          resolve(wav);
        }, 120);
      });
    },

    _encodeWav() {
      let total = 0;
      for (const c of this.chunks) total += c.length;
      const combined = new Float32Array(total);
      let off = 0;
      for (const c of this.chunks) { combined.set(c, off); off += c.length; }
      const targetRate = 16000;
      const samples = this._resample(combined, this.sampleRate, targetRate);
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const buffer = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(buffer);
      const ws = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
      ws(0, 'RIFF');
      view.setUint32(4, 36 + pcm.length * 2, true);
      ws(8, 'WAVE');
      ws(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ws(36, 'data');
      view.setUint32(40, pcm.length * 2, true);
      let pos = 44;
      for (let i = 0; i < pcm.length; i++) { view.setInt16(pos, pcm[i], true); pos += 2; }
      return new Blob([buffer], { type: 'audio/wav' });
    },

    _resample(data, fromRate, toRate) {
      if (!fromRate || fromRate === toRate) return data;
      const ratio = toRate / fromRate;
      const newLength = Math.round(data.length * ratio);
      const result = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i / ratio;
        const idx = Math.floor(srcIndex);
        const frac = srcIndex - idx;
        const a = data[idx] || 0;
        const b = data[idx + 1] !== undefined ? data[idx + 1] : a;
        result[i] = a + (b - a) * frac;
      }
      return result;
    },

    _cleanup() {
      try { if (this.processor) this.processor.disconnect(); } catch (e) {}
      try { if (this.source) this.source.disconnect(); } catch (e) {}
      try { if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { if (this.audioContext) this.audioContext.close(); } catch (e) {}
      this.audioContext = null; this.mediaStream = null; this.processor = null; this.source = null;
      this.chunks = [];
    }
  };

  let isRecording = false;
  let recordTimer = null;
  let recordSeconds = 0;
  const VOICE_MAX_SECONDS = 59;

  function resetVoiceBtn() {
    const btn = $('#btn-voice');
    btn.classList.remove('recording');
    btn.disabled = false;
    btn.textContent = '语音倾诉';
  }

  async function startVoice() {
    try {
      await voiceRecorder.start();
    } catch (e) {
      toast('无法访问麦克风：' + (e.message || '请检查浏览器权限'));
      return;
    }
    isRecording = true;
    recordSeconds = 0;
    const btn = $('#btn-voice');
    btn.classList.add('recording');
    btn.textContent = '录音中 0s（点击停止）';
    recordTimer = setInterval(() => {
      recordSeconds++;
      btn.textContent = '录音中 ' + recordSeconds + 's（点击停止）';
      if (recordSeconds >= VOICE_MAX_SECONDS) stopVoiceAndRecognize();
    }, 1000);
  }

  async function stopVoiceAndRecognize() {
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    isRecording = false;
    const btn = $('#btn-voice');
    btn.classList.remove('recording');
    btn.disabled = true;
    btn.textContent = '识别中…';
    try {
      const wavBlob = await voiceRecorder.stop();
      if (wavBlob.size < 1000) { toast('录音太短，请再说一次'); resetVoiceBtn(); return; }
      const res = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBlob
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('asr failed: ' + res.status));
      }
      const data = await res.json();
      const text = (data.text || '').trim();
      if (!text) { toast('没有识别到语音，请再说一次'); resetVoiceBtn(); return; }
      const input = $('#treehole-input');
      input.value = text;
      input.dispatchEvent(new Event('input'));
      toast('已识别语音：' + (text.length > 12 ? text.slice(0, 12) + '…' : text));
    } catch (e) {
      console.warn('ASR failed:', e);
      toast('语音识别失败：' + (e.message || '未知错误'));
    } finally {
      resetVoiceBtn();
    }
  }

  /* ========================================================
   * 模块 2：心情天气打卡与趋势
   * ======================================================== */
  let selectedWeather = null;
  const selectedStress = new Set();

  function saveMoodEntry() {
    if (!selectedWeather) {
      toast('请先选一个今天的心情天气～');
      return;
    }
    const note = $('#mood-note').value.trim();
    const mood = store.get('xy_mood', []);
    // 替换今天已有记录
    const today = todayStr();
    const idx = mood.findIndex(m => m.date === today);
    const entry = {
      date: today,
      weather: selectedWeather.w,
      score: parseInt(selectedWeather.s, 10),
      stress: Array.from(selectedStress),
      note: note
    };
    if (idx >= 0) mood[idx] = entry; else mood.push(entry);
    store.set('xy_mood', mood);

    // 更新本周观察
    updateObservation(mood);
    renderMoodCharts();
    renderCalendar();
    toast('已记录今天的心情天气：' + selectedWeather.w);
    // 重置选择
    selectedWeather = null;
    $$('.weather-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    selectedStress.clear();
    $$('.stress-tag').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    $('#mood-note').value = '';
  }

  function updateObservation(mood) {
    const recent = mood.slice(-7);
    const lowStress = {};
    recent.forEach(m => (m.stress || []).forEach(s => lowStress[s] = (lowStress[s] || 0) + 1));
    const top = Object.keys(lowStress).sort((a, b) => lowStress[b] - lowStress[a])[0];
    const lowDays = recent.filter(m => m.score < 5).length;
    let text = '最近一周情绪整体平稳，继续保持现在的节奏。';
    if (top === '刷题' || top === '熬夜') {
      text = '最近低落多集中在刷题和熬夜之后，可以尝试把复习任务拆成 25 分钟一段，并给自己留出休息。';
    } else if (top === '亲子争吵') {
      text = '最近情绪波动和亲子沟通有关，试试先说出感受而不是指责，给彼此一点时间。';
    } else if (top === '同学关系') {
      text = '最近和同学相处有些消耗，记得你不必讨好所有人，先照顾好自己的感受。';
    }
    if (lowDays >= 3) text += ' 如果连续几天都提不起劲，可以告诉一位信任的大人。';
    $('#mood-observation').textContent = text;
    // 同步给家长端观察（脱敏）
    store.set('xy_observation', text);
  }

  /* ---------- 图表渲染（ECharts 优先，离线降级 SVG） ---------- */
  function renderMoodCharts() {
    const mood = store.get('xy_mood', []);
    const recent = mood.slice(-14);
    const labels = recent.map(m => m.date);
    const scores = recent.map(m => m.score);
    renderLineChart('chart-mood-line', labels, scores, '情绪指数');
    // 压力来源饼图
    const stressCount = {};
    recent.forEach(m => (m.stress || []).forEach(s => stressCount[s] = (stressCount[s] || 0) + 1));
    renderPieChart('chart-mood-pie', stressCount);
  }

  function renderLineChart(containerId, labels, values, name) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (typeof echarts !== 'undefined') {
      const chart = echarts.getInstanceByDom(el) || echarts.init(el);
      chart.setOption({
        backgroundColor: 'transparent',
        grid: { left: 34, right: 18, top: 22, bottom: 30 },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisTick: { show: false },
          axisLabel: { fontSize: 10, color: theme.soft },
          axisLine: { lineStyle: { color: theme.border } }
        },
        yAxis: {
          type: 'value', min: 0, max: 10,
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: { fontSize: 10, color: theme.soft },
          splitLine: { lineStyle: { color: theme.grid } }
        },
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(36,53,45,0.94)',
          borderWidth: 0,
          textStyle: { color: '#fffefa', fontSize: 12 },
          axisPointer: { lineStyle: { color: theme.accent, type: 'dashed' } }
        },
        series: [{
          name: name, type: 'line', smooth: true, data: values,
          symbol: 'circle', symbolSize: 7,
          lineStyle: { color: theme.primary, width: 3 },
          itemStyle: { color: '#fffefa', borderColor: theme.primary, borderWidth: 2 },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(95,143,123,0.28)' }, { offset: 1, color: 'rgba(94,149,181,0.02)' }] }
          }
        }]
      });
      chart.resize();
    } else {
      el.innerHTML = svgLineChart(labels, values);
    }
  }

  function renderPieChart(containerId, dataObj) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const data = Object.keys(dataObj).map(k => ({ name: k, value: dataObj[k] }));
    if (data.length === 0) { el.innerHTML = '<div style="color:#68766f;font-size:12px;text-align:center;padding:40px 0">暂无数据</div>'; return; }
    if (typeof echarts !== 'undefined') {
      const chart = echarts.getInstanceByDom(el) || echarts.init(el);
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(36,53,45,0.94)',
          borderWidth: 0,
          textStyle: { color: '#fffefa', fontSize: 12 }
        },
        legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: theme.soft } },
        color: [theme.primary, theme.accent, theme.sun, theme.danger, theme.plum, '#92a86f'],
        series: [{
          type: 'pie', radius: ['46%', '68%'], center: ['50%', '43%'],
          padAngle: 2,
          itemStyle: { borderColor: '#fffefa', borderWidth: 2 },
          label: { fontSize: 11, color: theme.text },
          data: data
        }]
      });
      chart.resize();
    } else {
      el.innerHTML = svgBarChart(data);
    }
  }

  /* ---------- SVG 降级图表（离线可用） ---------- */
  function svgLineChart(labels, values) {
    const w = 300, h = 160, pad = 28;
    const max = 10, min = 0;
    const n = values.length || 1;
    const stepX = (w - pad * 2) / Math.max(n - 1, 1);
    const pts = values.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
      return [x, y];
    });
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#fffefa" stroke="#5f8f7b" stroke-width="2"/>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%"><path d="${path}" fill="none" stroke="#5f8f7b" stroke-width="3"/>${dots}</svg>`;
  }
  function svgBarChart(data) {
    const w = 300, h = 160, pad = 24;
    const max = Math.max.apply(null, data.map(d => d.value).concat([1]));
    const bw = (w - pad * 2) / data.length - 6;
    const bars = data.map((d, i) => {
      const bh = (d.value / max) * (h - pad * 2);
      const x = pad + i * ((w - pad * 2) / data.length) + 3;
      const y = h - pad - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="#5f8f7b"/><text x="${(x+bw/2).toFixed(1)}" y="${h-8}" font-size="9" fill="#68766f" text-anchor="middle">${d.name}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%">${bars}</svg>`;
  }

  /* ---------- 情绪日历 ---------- */
  function renderCalendar() {
    const el = $('#mood-calendar');
    if (!el) return;
    const mood = store.get('xy_mood', []);
    el.innerHTML = '';
    // 表头
    ['一', '二', '三', '四', '五', '六', '日'].forEach(d => {
      const c = document.createElement('div');
      c.className = 'cal-cell';
      c.style.opacity = '0.5';
      c.textContent = d;
      el.appendChild(c);
    });
    const map = {};
    mood.forEach(m => map[m.date] = m.score);
    for (let i = 13; i >= 0; i--) {
      const ds = dateStrOffset(-i);
      const c = document.createElement('div');
      c.className = 'cal-cell';
      if (ds in map) {
        c.classList.add('has', 's' + map[ds]);
        c.textContent = ds.split('/')[1];
      } else {
        c.textContent = ds.split('/')[1];
      }
      el.appendChild(c);
    }
  }

  /* ========================================================
   * 模块 3：AI 好习惯计划
   * ======================================================== */
  let currentHabit = null;

  // 根据目标关键词匹配本地图标（保持与 SVG 图标系统一致）
  function matchHabitIcon(goal) {
    for (const k in HABIT_TEMPLATES) {
      if (HABIT_TEMPLATES[k].match.some(m => goal.indexOf(m) >= 0)) {
        return { icon: HABIT_TEMPLATES[k].icon, key: k };
      }
    }
    return { icon: HABIT_TEMPLATES.exam.icon, key: 'exam' };
  }

  async function generateHabitPlan(goal) {
    goal = (goal || '').trim();
    if (!goal) { toast('请先输入一个小目标～'); return null; }

    // 图标由本地关键词匹配决定，保持与 SVG 图标系统一致
    const iconMatch = matchHabitIcon(goal);

    const btn = $('#btn-gen-habit');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '生成中…';

    let plan = null;
    // Vercel Hobby 10s 强制断开：前端 9s 主动 abort，快速走本地兜底
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch('/api/habit-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('habit-plan failed: ' + res.status);
      const data = await res.json();
      plan = {
        goal: goal,
        icon: iconMatch.icon,
        tasks: data.tasks.map(name => ({ name, done: false })),
        badge: data.badge,
        remind: data.remind,
        key: iconMatch.key
      };
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('habit-plan LLM unavailable, fallback to local template:', e);
    }

    // LLM 失败时回退本地模板
    if (!plan) {
      const tpl = HABIT_TEMPLATES[iconMatch.key] || HABIT_TEMPLATES.exam;
      plan = {
        goal: goal,
        icon: tpl.icon,
        tasks: tpl.tasks.map(name => ({ name, done: false })),
        badge: tpl.badge,
        remind: tpl.remind,
        key: iconMatch.key
      };
    }

    // 读取已有进度（同 key 复用，按任务名匹配已完成状态）
    const habits = store.get('xy_habits', []);
    const existing = habits.find(h => h.key === plan.key);
    if (existing) {
      plan.tasks.forEach(t => {
        const old = existing.tasks.find(et => et.name === t.name);
        if (old) t.done = old.done;
      });
    }

    currentHabit = plan;
    renderHabit();
    btn.disabled = false;
    btn.textContent = originalText;
    toast('计划已生成，今天先完成一小步');
    return plan;
  }

  function renderHabit() {
    if (!currentHabit) return;
    $('#habit-result').hidden = false;
    $('#habit-goal-title').textContent = '目标：' + currentHabit.goal;
    $('#habit-badge').innerHTML = iconSvg(currentHabit.icon) + ' ' + currentHabit.badge;
    const list = $('#habit-tasks');
    list.innerHTML = '';
    currentHabit.tasks.forEach((t, i) => {
      const item = document.createElement('label');
      item.className = 'task-item' + (t.done ? ' done' : '');
      item.innerHTML = `<input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span>${t.name}</span>`;
      list.appendChild(item);
    });
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', e => {
        const i = parseInt(e.target.dataset.i, 10);
        currentHabit.tasks[i].done = e.target.checked;
        e.target.closest('.task-item').classList.toggle('done', e.target.checked);
        updateHabitProgress();
        saveHabit();
      });
    });
    updateHabitProgress();
  }

  function updateHabitProgress() {
    const done = currentHabit.tasks.filter(t => t.done).length;
    const total = currentHabit.tasks.length;
    $('#habit-progress-text').textContent = `今日完成 ${done} / ${total}`;
    $('#habit-progress-fill').style.width = (total ? (done / total * 100) : 0) + '%';
    // 连续完成给治愈徽章
    const lit = done === total && total > 0;
    $('#habit-badge').innerHTML = iconSvg(lit ? 'star' : currentHabit.icon, lit) + ' ' + currentHabit.badge + (lit ? ' · 已点亮' : '');
  }

  function saveHabit() {
    if (!currentHabit) return;
    const habits = store.get('xy_habits', []);
    const idx = habits.findIndex(h => h.key === currentHabit.key);
    if (idx >= 0) habits[idx] = currentHabit; else habits.push(currentHabit);
    store.set('xy_habits', habits);
  }

  function habitRemind() {
    if (!currentHabit) return;
    const text = currentHabit.remind;
    const el = $('#habit-remind-text');
    el.innerHTML = iconSvg('bell') + ' ' + text;
    el.hidden = false;
    speak(text);
  }

  /* ---------- 语音播报（Web SpeechSynthesis，不支持则降级文字） ---------- */
  function speak(text) {
    // 后续可替换为 TRAE TTS
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = 0.95;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    } catch (e) { /* 忽略，文字已显示 */ }
  }

  /* ========================================================
   * 模块 4：减压宝库
   * ======================================================== */
  let noiseTimer = null;
  let noiseAudioCtx = null;
  let noiseSource = null;

  function renderLessons() {
    const list = $('#lesson-list');
    if (!list || list.childElementCount > 0) return;
    LESSONS.forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'lesson-item';
      item.innerHTML = `<div class="lesson-head"><span>${l.title}</span><span class="arrow">›</span></div><div class="lesson-body">${l.body}</div>`;
      item.querySelector('.lesson-head').addEventListener('click', () => item.classList.toggle('open'));
      list.appendChild(item);
    });
  }

  function startNoise(card, minutes) {
    // 停止已有
    stopNoise();
    $$('.noise-card').forEach(c => c.classList.remove('playing'));
    card.classList.add('playing');
    card.querySelector('.play-btn').textContent = '暂停';

    // 用 Web Audio 生成简化白噪音（无需音频文件）
    try {
      noiseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const bufferSize = 2 * noiseAudioCtx.sampleRate;
      const buffer = noiseAudioCtx.createBuffer(1, bufferSize, noiseAudioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      noiseSource = noiseAudioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      const gain = noiseAudioCtx.createGain();
      gain.gain.value = 0.08;
      noiseSource.connect(gain).connect(noiseAudioCtx.destination);
      noiseSource.start();
    } catch (e) { /* 不支持时仅倒计时 */ }

    // 倒计时
    let remain = minutes * 60;
    const cd = $('#noise-countdown');
    cd.hidden = false;
    const tick = () => {
      const m = Math.floor(remain / 60), s = remain % 60;
      $('#noise-time').textContent = m + ':' + (s < 10 ? '0' + s : s);
      if (remain <= 0) { stopNoise(); return; }
      remain--;
    };
    tick();
    noiseTimer = setInterval(tick, 1000);
  }

  function stopNoise() {
    if (noiseTimer) { clearInterval(noiseTimer); noiseTimer = null; }
    if (noiseSource) { try { noiseSource.stop(); } catch (e) {} noiseSource = null; }
    if (noiseAudioCtx) { try { noiseAudioCtx.close(); } catch (e) {} noiseAudioCtx = null; }
    $('#noise-countdown').hidden = true;
    $$('.noise-card').forEach(c => {
      c.classList.remove('playing');
      const b = c.querySelector('.play-btn');
      if (b) b.textContent = '播放';
    });
  }

  /* ---------- 涂鸦板 ---------- */
  function initDoodle() {
    const canvas = $('#doodle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let drawing = false, color = '#7FC8A9', lastX = 0, lastY = 0, sized = false;

    // 涂鸦板在隐藏的减压模块里，首次绘制时再按显示尺寸同步画布
    function syncSize() {
      const w = canvas.clientWidth || 320;
      const h = Math.round(w * (240 / 320));
      canvas.width = w;
      canvas.height = h;
      sized = true;
    }

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    }
    function start(e) { e.preventDefault(); if (!sized) syncSize(); drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; }
    function move(e) {
      if (!drawing) return; e.preventDefault();
      const p = pos(e);
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastX = p.x; lastY = p.y;
    }
    function end() { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    $$('.color-btn').forEach(b => b.addEventListener('click', () => {
      $$('.color-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      color = b.dataset.color;
    }));
    $('#btn-clear-doodle').addEventListener('click', () => {
      if (!sized) syncSize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }

  /* ---------- 漂流瓶 ---------- */
  function sendBottle() {
    const input = $('#bottle-input');
    const text = input.value.trim();
    if (!text) { toast('先写一句烦恼再投递吧～'); return; }
    // 敏感词过滤
    if (BAD_WORDS.some(w => text.indexOf(w) >= 0)) {
      input.value = '';
      const reply = $('#bottle-reply');
      reply.hidden = false;
      reply.textContent = '这句话可能会伤害别人，我们换一种更安全的表达吧。';
      return;
    }
    input.value = '';
    const reply = $('#bottle-reply');
    reply.hidden = false;
    reply.innerHTML = iconSvg('wave') + ' 收到回信：' + ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
  }

  /* ========================================================
   * 家长端
   * ======================================================== */
  function renderParent() {
    const perm = store.get('xy_permission', { parentView: true });
    $('#parent-permission-toggle').checked = !!perm.parentView;

    if (!perm.parentView) {
      $('#chart-parent-line').innerHTML = '<div style="color:#7A7A7A;font-size:12px;text-align:center;padding:40px 0">孩子已关闭家长查看权限<br>请给孩子保留空间</div>';
      $('#chart-parent-stress').innerHTML = '';
      $('#parent-low-days').textContent = '—';
      $('#parent-avg').textContent = '—';
      $('#parent-warning').hidden = true;
      $('#parent-suggestions').innerHTML = '<li>孩子暂时关闭了脱敏查看。这是他们保护自己的方式，建议先表达关心，而不是追问。</li>';
      return;
    }

    const mood = store.get('xy_mood', []);
    const recent = mood.slice(-14);
    const labels = recent.map(m => m.date);
    const scores = recent.map(m => m.score);
    renderLineChart('chart-parent-line', labels, scores, '情绪指数');

    const lowDays = recent.filter(m => m.score < 5).length;
    const avg = recent.length ? (recent.reduce((s, m) => s + m.score, 0) / recent.length).toFixed(1) : '0';
    $('#parent-low-days').textContent = lowDays;
    $('#parent-avg').textContent = avg;

    const stressCount = {};
    recent.forEach(m => (m.stress || []).forEach(s => stressCount[s] = (stressCount[s] || 0) + 1));
    renderPieChart('chart-parent-stress', stressCount);

    const warn = $('#parent-warning');
    if (lowDays >= 4) {
      warn.hidden = false;
      warn.textContent = '最近孩子可能压力偏高（近 14 天低落 ' + lowDays + ' 天），建议多用倾听式沟通，少评价、多陪伴。';
    } else {
      warn.hidden = true;
    }

    $('#parent-suggestions').innerHTML = [
      '<li>少问 <b>「你怎么又这样」</b>，容易让孩子关闭沟通。</li>',
      '<li>可以说 <b>「我看到你最近有点累，如果你愿意，我可以先听你说，不急着评价」</b>。</li>',
      '<li>给孩子保留独处和求助空间，不强行翻看手机或日记。</li>',
      '<li>如果孩子愿意，一起做一件轻松的小事，比如散步、做饭。</li>'
    ].join('');
  }

  /* ========================================================
   * 教师端
   * ======================================================== */
  function renderTeacher() {
    // 班级聚合趋势（模拟数据，基于学生数据做轻微聚合偏移）
    const mood = store.get('xy_mood', []);
    const recent = mood.slice(-14);
    const labels = recent.map(m => m.date);
    // 班级均值：在学生分数基础上做小幅波动
    const classScores = recent.map((m, i) => {
      const base = m.score;
      const wave = Math.sin(i * 0.9) * 0.6;
      return Math.max(1, Math.min(10, +(base + wave).toFixed(1)));
    });
    renderLineChart('chart-teacher-trend', labels, classScores, '班级均值');

    // 压力主题分布（模拟聚合）
    const topics = { '考前焦虑': 12, '人际关系': 7, '睡眠不足': 9, '自我压力': 6, '家庭沟通': 5 };
    renderPieChart('chart-teacher-topics', topics);

    $('#teacher-suggestions').innerHTML = [
      '<li><b>5 分钟呼吸放松</b>：班会开场带全班做一次 4-7-8 呼吸。</li>',
      '<li><b>考前任务拆解练习</b>：教学生把复习拆成 25 分钟一段。</li>',
      '<li><b>同伴支持小组讨论</b>：4 人一组分享一件最近的小压力，不评价、只倾听。</li>',
      '<li>关注近期情绪偏低的同学，私下表达关心，不强求倾诉。</li>'
    ].join('');
  }

  function submitReport() {
    const desc = $('#report-desc').value.trim();
    if (!desc) { toast('请简单描述一下情况，哪怕一句也好～'); return; }
    // 仅演示，不上传任何真实信息
    store.set('xy_reports', (store.get('xy_reports', [])).concat([{ ts: Date.now(), desc: desc }]));
    $('#report-time').value = ''; $('#report-place').value = ''; $('#report-desc').value = '';
    $('#report-contact').checked = false;
    const r = $('#report-result');
    r.hidden = false;
    r.textContent = '已匿名上报。老师会在保护你隐私的前提下关注此事。如果是紧急情况，请联系身边可信任的大人或拨打当地紧急电话。';
    toast('匿名上报已提交');
  }

  /* ========================================================
   * 演示流（7 个一键触发）
   * ======================================================== */
  function runDemo(index) {
    switch (index) {
      case 1: // 模拟考试焦虑倾诉
        switchPort('student');
        switchModule('treehole');
        $('#treehole-input').value = '我最近快考试了，总觉得自己复习不完，晚上也睡不好。';
        handleSend($('#treehole-input').value);
        break;
      case 2: // 生成情绪趋势报告
        switchPort('student');
        switchModule('mood');
        renderMoodCharts();
        renderCalendar();
        break;
      case 3: // 生成考前复习计划
        switchPort('student');
        switchModule('habit');
        $('#habit-goal').value = '稳定考前复习';
        generateHabitPlan('稳定考前复习');
        break;
      case 4: // 打开减压宝库
        switchPort('student');
        switchModule('relax');
        renderLessons();
        break;
      case 5: // 切换家长端
        switchPort('parent');
        break;
      case 6: // 触发高风险求助弹窗
        switchPort('student');
        switchModule('treehole');
        showCrisisModal();
        break;
      case 7: // 打开匿名上报
        switchPort('teacher');
        $('#report-desc').scrollIntoView({ behavior: 'smooth' });
        break;
    }
  }

  /* ========================================================
   * 事件绑定
   * ======================================================== */
  function bindEvents() {
    // 端口 Tab
    $$('.tab').forEach(t => t.addEventListener('click', () => switchPort(t.dataset.port)));
    // 学生端子 Tab
    $$('.subtab').forEach(t => t.addEventListener('click', () => switchModule(t.dataset.module)));

    // 树洞
    $('#btn-send').addEventListener('click', () => handleSend($('#treehole-input').value));
    $('#treehole-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend($('#treehole-input').value); }
    });
    $('#treehole-input').addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
    });
    $('#btn-voice').addEventListener('click', () => {
      if (isRecording) stopVoiceAndRecognize();
      else startVoice();
    });
    $('#btn-clear-treehole').addEventListener('click', clearTreehole);

    // 心情天气
    $$('.weather-btn').forEach(b => {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        $$('.weather-btn').forEach(x => {
          x.classList.remove('active');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
        selectedWeather = { w: b.dataset.w, s: b.dataset.score };
      });
    });
    $$('.stress-tag').forEach(b => {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        b.classList.toggle('active');
        b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
        const s = b.dataset.stress;
        if (selectedStress.has(s)) selectedStress.delete(s); else selectedStress.add(s);
      });
    });
    $('#btn-save-mood').addEventListener('click', saveMoodEntry);

    // 习惯
    $('#btn-gen-habit').addEventListener('click', () => generateHabitPlan($('#habit-goal').value));
    $('#btn-habit-remind').addEventListener('click', habitRemind);

    // 减压宝库
    $$('.noise-card').forEach(card => {
      card.querySelector('.play-btn').addEventListener('click', () => {
        if (card.classList.contains('playing')) { stopNoise(); }
        else { startNoise(card, 10); }
      });
      card.querySelectorAll('.timer-btn').forEach(tb => tb.addEventListener('click', () => {
        startNoise(card, parseInt(tb.dataset.min, 10));
      }));
    });
    $('#btn-bottle-send').addEventListener('click', sendBottle);

    // 家长端权限开关
    $('#parent-permission-toggle').addEventListener('change', e => {
      const perm = store.get('xy_permission', { parentView: true });
      perm.parentView = e.target.checked;
      store.set('xy_permission', perm);
      renderParent();
    });

    // 教师端上报
    $('#btn-submit-report').addEventListener('click', submitReport);

    // 演示流
    $$('.demo-btn').forEach(b => b.addEventListener('click', () => runDemo(parseInt(b.dataset.demo, 10))));

    // 一键求助
    $('#help-btn').addEventListener('click', () => { $('#help-modal').hidden = false; });
    $('#help-close').addEventListener('click', () => { $('#help-modal').hidden = true; });
    $('#help-modal').querySelector('.modal-mask').addEventListener('click', () => { $('#help-modal').hidden = true; });

    // 高风险弹窗
    $('#crisis-modal').querySelector('.modal-mask').addEventListener('click', hideCrisisModal);
    $$('.crisis-action').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.action;
      const fb = $('#crisis-feedback');
      fb.hidden = false;
      if (a === 'teacher') fb.textContent = '好的，建议尽快联系学校心理老师面谈。如果一时联系不上，也可以先找班主任或信任的老师。';
      else if (a === 'channel') { fb.textContent = '已为你打开求助渠道。'; $('#help-modal').hidden = false; }
      else { fb.textContent = '谢谢你告诉我。无论何时觉得撑不住，都可以再回来找我，或联系身边的人。'; setTimeout(hideCrisisModal, 1800); }
    }));
  }

  /* ========================================================
   * 启动
   * ======================================================== */
  function init() {
    initMockData();
    startNewTreeholeConversation();
    bindEvents();
    initDoodle();
    renderLessons();
    renderMoodCharts();
    renderCalendar();
    updateObservation(store.get('xy_mood', []));
    window.addEventListener('resize', () => {
      if (typeof echarts === 'undefined') return;
      $$('.chart').forEach(el => {
        const chart = echarts.getInstanceByDom(el);
        if (chart) chart.resize();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
