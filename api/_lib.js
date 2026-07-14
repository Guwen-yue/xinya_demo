/**
 * 心芽守护 — Vercel Serverless Functions 共享模块
 * 本地开发时由 server.js 提供同源服务；Vercel 部署时由 /api/ 下各端点引用。
 */

// ---- 环境变量（Vercel 控制台注入，本地通过 server.js .env 加载） ----
const API_BASE = process.env.MODEL_API_BASE || 'https://api.siliconflow.cn/v1';
const MODEL = process.env.TREEHOLE_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.QWEN_API_KEY || '';
const BAIDU_API_KEY = process.env.BAIDU_ASR_API_KEY || process.env.BAIDU_API_KEY || '';
const BAIDU_SECRET_KEY = process.env.BAIDU_ASR_SECRET_KEY || process.env.BAIDU_SECRET_KEY || '';
const isProd = process.env.NODE_ENV === 'production';

// ---- 系统提示词 ----
const TREEHOLE_SYSTEM_PROMPT = `
你是"心芽守护"的 AI 暖心树洞，面向青少年学生提供情绪陪伴。

核心目标：
1. 认真倾听、温柔共情，帮助学生把情绪和压力源梳理清楚。
2. 给出低负担、可执行、非说教的小建议——必须具体到动作、时间或方法，不能空泛。
3. 不诊断疾病，不替代心理咨询、医疗、老师或家长。
4. 不索要姓名、学校、住址、联系方式、身份证号等隐私。
5. 不评价学生"矫情/脆弱/想太多"，不使用威胁、羞辱、命令式表达。
6. 面对疑似自伤、自杀、被伤害、暴力、性侵、严重霸凌等危机场景，必须优先鼓励立刻联系身边可信任的大人、学校心理老师、当地紧急电话或危机干预热线。

【输出格式——严格遵守】
你的回复必须分为两部分：

第一行是情绪分析元信息，格式严格为：
强度:NN|标签:t1,t2,t3
其中 NN 是 0 到 100 的整数，表示你判断的情绪强度。请认真根据用户表达的痛苦程度评估，不要随意给低分：
  0-20 仅随口提及、几乎无情绪波动；
  21-45 有些低落或轻度焦虑，但还能应付；
  46-65 明显的焦虑、压力、难过、失眠（用户提到睡不着/压力大/很累/焦虑时至少 50）；
  66-80 较强痛苦，影响日常生活，有无力感；
  81-100 高风险，出现自伤、轻生、被伤害等危机信号。
标签是 1 到 3 个完整的词（不要单字），用逗号分隔，从以下选取或自拟：考前焦虑,睡眠压力,亲子冲突,人际压力,孤独,自我否定,被孤立,情绪低落,拖延,适应困难,危机。

第一行之后空一行，再写回复正文。正文必须包含三段，每段都要落到实处：
1. 共情认可（1-2 句）：真诚地回应对方具体说了什么，承认这种感受是合理的，不要泛泛地说"我理解你"。要点名对方话语里的具体情境。
2. 命名压力源（1 句）：帮对方把混乱的感受归拢成一两个清晰的来源，例如"你现在主要承受的是考前焦虑"。
3. 具体可执行的建议（2-3 条，每条都要有具体动作）：不能说"要调整心态""要积极面对"这种空话。每条建议必须包含一个能立刻做的小动作，例如"今晚 22:30 放下手机""把任务拆成 25 分钟一段，每段休息 5 分钟""现在做一次 4-7-8 呼吸：吸气 4 秒、屏住 7 秒、呼气 8 秒"。

正文总长 150 到 260 字，中文，温柔、克制，像一个稳定可靠的倾听者。
不要说"我只是 AI""作为语言模型"。
不要 Markdown 代码块，不要 JSON，不要多余解释。
不要承诺绝对保密；可以说"我会尽量保护你的表达，但如果你有危险，请先联系现实中的大人"。

示例（仅示意格式，不要照抄内容）：
强度:62|标签:考前焦虑,睡眠压力
我听到你了，复习到这个时候还睡不着，心里又急又累，换谁都会喘不过气——这份累是真实的。
你现在主要承受的是考前焦虑叠加睡眠不足，身体和心情都在抗议。
今晚可以先做一件小事：22:30 放下手机，做一次 4-7-8 呼吸（吸气 4 秒、屏住 7 秒、呼气 8 秒）让自己慢慢安静。明早把最难的复习拆成 25 分钟一段，每段之间休息 5 分钟。记得：你不需要复习完所有东西，只需要比昨天多记一点。
`.trim();

const HABIT_PLAN_SYSTEM_PROMPT = `
你是"心芽守护"的好习惯计划助手。用户会给你一个小目标，你需要为 TA 生成一个温暖、可执行的每日习惯计划。

严格只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块、不要前后多余文字：
{"badge":"xxx","remind":"xxx","tasks":["步骤1","步骤2","步骤3","步骤4"]}

要求：
- badge：4-6 字的温暖小称号，要贴合目标主题，例如"稳定小芽""早睡小芽""行动小芽"。
- remind：一句温和的提醒，30 字以内，语气像朋友而非教官。
- tasks：4 个具体、可立即执行的步骤，每个步骤 15 字以内，必须包含具体动作或时间点，例如"22:30 放下手机""把任务拆成 25 分钟一段""先做 5 分钟再说"。不要空泛的"调整心态""积极面对"。
`.trim();

// ---- 工具函数 ----

function sendJson(res, status, data) {
  if (isProd && data && data.detail) {
    data = { error: data.error || 'server_error' };
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('audio body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeJsonParse(str) {
  if (!str) return {};
  return JSON.parse(str);
}

function safeMessages(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
}

// ---- 安全：频率限制 + 来源验证 ----

function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (xfwd) return String(xfwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const rateLimiter = {
  windowMs: 60 * 1000,
  limits: { api: 20, asr: 10 },
  store: new Map(),

  check(ip, type) {
    const max = this.limits[type] || 20;
    const now = Date.now();
    let entry = this.store.get(ip);
    if (!entry) {
      entry = {};
      this.store.set(ip, entry);
    }
    let slot = entry[type];
    if (!slot || now > slot.resetAt) {
      slot = { count: 1, resetAt: now + this.windowMs };
      entry[type] = slot;
      return { allowed: true, remaining: max - 1 };
    }
    slot.count++;
    if (slot.count > max) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((slot.resetAt - now) / 1000) };
    }
    return { allowed: true, remaining: max - slot.count };
  }
};

function checkOrigin(req) {
  const host = (req.headers.host || '').split(':')[0];
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.hostname === host) return true;
      if (!isProd && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
      return false;
    } catch { return false; }
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.hostname === host) return true;
      if (!isProd && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
      return false;
    } catch { return false; }
  }
  return false;
}

function apiGuard(req, res, type) {
  if (!checkOrigin(req)) {
    sendJson(res, 403, { error: 'forbidden_origin' });
    return false;
  }
  const ip = getClientIp(req);
  const rl = rateLimiter.check(ip, type);
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    sendJson(res, 429, { error: 'rate_limited', retryAfter: rl.retryAfter || 60 });
    return false;
  }
  return true;
}

// ---- 百度 ASR Token 缓存（warm start 时复用，冷启动重新获取） ----
let baiduTokenCache = null;

async function getBaiduToken() {
  if (baiduTokenCache && baiduTokenCache.expiresAt > Date.now() + 60 * 1000) {
    return baiduTokenCache.token;
  }
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(BAIDU_API_KEY)
    + '&client_secret=' + encodeURIComponent(BAIDU_SECRET_KEY);
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('baidu_token_failed: ' + JSON.stringify(data).slice(0, 300));
  }
  baiduTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 2592000) * 1000
  };
  return baiduTokenCache.token;
}

module.exports = {
  API_BASE, MODEL, API_KEY, BAIDU_API_KEY, BAIDU_SECRET_KEY, isProd,
  TREEHOLE_SYSTEM_PROMPT, HABIT_PLAN_SYSTEM_PROMPT,
  sendJson, readBody, readRawBody, safeJsonParse, safeMessages,
  getClientIp, rateLimiter, checkOrigin, apiGuard,
  getBaiduToken
};
