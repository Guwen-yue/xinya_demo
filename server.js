const http = require('http');
const fs = require('fs');
const path = require('path');

// 依赖无关的 .env 加载：开发环境读取项目根 .env，部署环境用真实环境变量覆盖
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf-8');
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) return;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // 已存在的真实环境变量优先，不覆盖
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (e) { /* 读取失败时静默降级到纯环境变量 */ }
})();

const PORT = Number(process.env.PORT || 5173);
const API_BASE = process.env.MODEL_API_BASE || 'https://api.siliconflow.cn/v1';
const MODEL = process.env.TREEHOLE_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.QWEN_API_KEY || '';

// 百度语音识别（短语音 REST）。Secret Key 只在服务端使用，不下发浏览器。
const BAIDU_API_KEY = process.env.BAIDU_ASR_API_KEY || process.env.BAIDU_API_KEY || '';
const BAIDU_SECRET_KEY = process.env.BAIDU_ASR_SECRET_KEY || process.env.BAIDU_SECRET_KEY || '';

const ROOT = __dirname;
const isProd = process.env.NODE_ENV === 'production';

/* ---------- 安全基础设施 ---------- */

// 获取客户端真实 IP（兼容反向代理）
function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (xfwd) return String(xfwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 基于 IP 的内存频率限制
const rateLimiter = {
  windowMs: 60 * 1000,
  limits: { api: 20, asr: 10 },  // 每分钟：普通 API 20 次，ASR 10 次
  store: new Map(),               // ip -> { api: {count,resetAt}, asr: {count,resetAt} }

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
  },

  // 定期清理过期条目，防止内存泄漏
  cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      const allExpired = Object.values(entry).every(s => now > s.resetAt);
      if (allExpired) this.store.delete(ip);
    }
  }
};
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

// 来源验证：阻止非同源的 API 调用（防止跨域滥用）
function checkOrigin(req) {
  const host = (req.headers.host || '').split(':')[0];
  // Origin 头存在于跨域请求和同源 POST 中
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      // 允许同源（hostname 与 host 一致），允许 localhost（开发环境）
      if (url.hostname === host) return true;
      if (!isProd && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
      return false;
    } catch { return false; }
  }
  // 没有 Origin 头时，检查 Referer
  const referer = req.headers.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.hostname === host) return true;
      if (!isProd && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
      return false;
    } catch { return false; }
  }
  // 既无 Origin 也无 Referer：非浏览器请求，拒绝
  return false;
}

// 频率限制 + 来源验证中间件，返回 true 表示通过
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

// 安全的 JSON 解析
function safeJsonParse(str) {
  if (!str) return {};
  return JSON.parse(str);
}

// 进程异常兜底，防止崩溃
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const TREEHOLE_SYSTEM_PROMPT = `
你是“心芽守护”的 AI 暖心树洞，面向青少年学生提供情绪陪伴。

核心目标：
1. 认真倾听、温柔共情，帮助学生把情绪和压力源梳理清楚。
2. 给出低负担、可执行、非说教的小建议——必须具体到动作、时间或方法，不能空泛。
3. 不诊断疾病，不替代心理咨询、医疗、老师或家长。
4. 不索要姓名、学校、住址、联系方式、身份证号等隐私。
5. 不评价学生“矫情/脆弱/想太多”，不使用威胁、羞辱、命令式表达。
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
1. 共情认可（1-2 句）：真诚地回应对方具体说了什么，承认这种感受是合理的，不要泛泛地说“我理解你”。要点名对方话语里的具体情境。
2. 命名压力源（1 句）：帮对方把混乱的感受归拢成一两个清晰的来源，例如“你现在主要承受的是考前焦虑”。
3. 具体可执行的建议（2-3 条，每条都要有具体动作）：不能说“要调整心态”“要积极面对”这种空话。每条建议必须包含一个能立刻做的小动作，例如“今晚 22:30 放下手机”“把任务拆成 25 分钟一段，每段休息 5 分钟”“现在做一次 4-7-8 呼吸：吸气 4 秒、屏住 7 秒、呼气 8 秒”。

正文总长 150 到 260 字，中文，温柔、克制，像一个稳定可靠的倾听者。
不要说“我只是 AI”“作为语言模型”。
不要 Markdown 代码块，不要 JSON，不要多余解释。
不要承诺绝对保密；可以说“我会尽量保护你的表达，但如果你有危险，请先联系现实中的大人”。

示例（仅示意格式，不要照抄内容）：
强度:62|标签:考前焦虑,睡眠压力
我听到你了，复习到这个时候还睡不着，心里又急又累，换谁都会喘不过气——这份累是真实的。
你现在主要承受的是考前焦虑叠加睡眠不足，身体和心情都在抗议。
今晚可以先做一件小事：22:30 放下手机，做一次 4-7-8 呼吸（吸气 4 秒、屏住 7 秒、呼气 8 秒）让自己慢慢安静。明早把最难的复习拆成 25 分钟一段，每段之间休息 5 分钟。记得：你不需要复习完所有东西，只需要比昨天多记一点。
`.trim();

function sendJson(res, status, data) {
  // 生产环境脱敏：移除 detail 字段，不泄露上游 API 错误细节
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

function safeMessages(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
}

async function handleTreeholeChat(req, res) {
  if (!API_KEY) {
    sendJson(res, 500, { error: 'missing_api_key' });
    return;
  }

  let body;
  try {
    body = safeJsonParse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }
  const text = String(body.text || '').trim().slice(0, 1200);
  if (!text) {
    sendJson(res, 400, { error: 'empty_text' });
    return;
  }

  const localEmotion = body.localEmotion || {};
  const messages = [
    { role: 'system', content: TREEHOLE_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `前端本地规则初判：${JSON.stringify(localEmotion)}。这是辅助信息，不要机械照抄；如发现高风险，请按危机支持原则回复。`
    },
    ...safeMessages(body.history),
    { role: 'user', content: text }
  ];

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.55,
        top_p: 0.85,
        max_tokens: 512,
        stream: true
      })
    });
  } catch (e) {
    sendJson(res, 502, { error: 'upstream_unreachable', detail: String(e.message || e) });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    sendJson(res, upstream.status || 502, { error: 'model_request_failed', detail: detail.slice(0, 500) });
    return;
  }

  // SSE 透传：把上游 OpenAI 兼容的流式响应解析为简单 SSE 事件下发给前端
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let contentBuffer = '';      // 累积模型输出，用于解析第一行元信息
  let metaParsed = false;       // 是否已解析元信息行

  function emit(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  // 解析模型元信息：优先以空行（\n\n）作为元信息与正文的分界，
  // 从空行前的内容中提取强度和标签（容忍多行、| 缺失、中英文冒号）。
  // 也兼容单行格式 `强度:NN|标签:t1,t2` + 换行。
  function tryParseMeta() {
    // 1. 优先检测空行分界
    let sepIdx = contentBuffer.indexOf('\n\n');
    let sepLen = 2;
    if (sepIdx < 0) {
      sepIdx = contentBuffer.indexOf('\r\n\r\n');
      if (sepIdx >= 0) sepLen = 4;
    }
    if (sepIdx >= 0) {
      const metaPart = contentBuffer.slice(0, sepIdx);
      const rest = contentBuffer.slice(sepIdx + sepLen);
      const intensityMatch = metaPart.match(/强度\s*[:：]\s*(\d{1,3})/);
      if (intensityMatch) {
        const intensity = Math.max(0, Math.min(100, parseInt(intensityMatch[1], 10) || 0));
        const tagsMatch = metaPart.match(/标签\s*[:：]\s*([^\n\r]+)/);
        const tags = tagsMatch
          ? tagsMatch[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 3)
          : [];
        emit({ meta: { intensity, tags } });
        contentBuffer = rest.replace(/^[\r\n]+/, '');
        if (contentBuffer) emit({ delta: contentBuffer });
        contentBuffer = '';
        metaParsed = true;
        return true;
      }
      // 空行前没有强度信息，全部当正文透传
      emit({ delta: contentBuffer });
      contentBuffer = '';
      metaParsed = true;
      return true;
    }
    // 2. 兼容单行格式：强度:NN|标签:xxx + 换行（无空行分隔）
    const nlIdx = contentBuffer.indexOf('\n');
    if (nlIdx >= 0) {
      const firstLine = contentBuffer.slice(0, nlIdx).trim();
      const m = firstLine.match(/^强度\s*[:：]\s*(\d{1,3})\s*\|?\s*标签\s*[:：]\s*(.+)$/);
      if (m) {
        const intensity = Math.max(0, Math.min(100, parseInt(m[1], 10) || 0));
        const tags = m[2].split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 3);
        emit({ meta: { intensity, tags } });
        const rest = contentBuffer.slice(nlIdx + 1);
        contentBuffer = rest.replace(/^\s*[\r\n]+/, '');
        if (contentBuffer) emit({ delta: contentBuffer });
        contentBuffer = '';
        metaParsed = true;
        return true;
      }
    }
    // 还没检测到分界，继续缓冲
    return false;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && delta.content) {
            if (!metaParsed) {
              contentBuffer += delta.content;
              if (contentBuffer.indexOf('\n') >= 0) tryParseMeta();
            } else {
              emit({ delta: delta.content });
            }
          }
        } catch (e) { /* 跳过非 JSON 行 */ }
      }
    }
  } catch (e) {
    emit({ error: 'stream_interrupted', detail: String(e.message || e) });
  }

  // 流结束时若还有未处理内容（模型未输出换行符的情况）
  if (!metaParsed && contentBuffer) {
    emit({ delta: contentBuffer });
    contentBuffer = '';
  }

  emit({ done: true });
  res.write('data: [DONE]\n\n');
  res.end();
}

/* ---------- 好习惯计划：调用 LLM 生成具体步骤 ---------- */
const HABIT_PLAN_SYSTEM_PROMPT = `
你是"心芽守护"的好习惯计划助手。用户会给你一个小目标，你需要为 TA 生成一个温暖、可执行的每日习惯计划。

严格只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块、不要前后多余文字：
{"badge":"xxx","remind":"xxx","tasks":["步骤1","步骤2","步骤3","步骤4"]}

要求：
- badge：4-6 字的温暖小称号，要贴合目标主题，例如"稳定小芽""早睡小芽""行动小芽"。
- remind：一句温和的提醒，30 字以内，语气像朋友而非教官。
- tasks：4 个具体、可立即执行的步骤，每个步骤 15 字以内，必须包含具体动作或时间点，例如"22:30 放下手机""把任务拆成 25 分钟一段""先做 5 分钟再说"。不要空泛的"调整心态""积极面对"。
`.trim();

async function handleHabitPlan(req, res) {
  if (!API_KEY) {
    sendJson(res, 500, { error: 'missing_api_key' });
    return;
  }
  let body;
  try {
    body = safeJsonParse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }
  const goal = String(body.goal || '').trim().slice(0, 200);
  if (!goal) {
    sendJson(res, 400, { error: 'empty_goal' });
    return;
  }

  const messages = [
    { role: 'system', content: HABIT_PLAN_SYSTEM_PROMPT },
    { role: 'user', content: '我的小目标是：' + goal }
  ];

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.6,
        top_p: 0.9,
        max_tokens: 400,
        stream: false
      })
    });
  } catch (e) {
    sendJson(res, 502, { error: 'upstream_unreachable', detail: String(e.message || e) });
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    sendJson(res, upstream.status || 502, { error: 'model_request_failed', detail: detail.slice(0, 500) });
    return;
  }

  const data = await upstream.json().catch(() => ({}));
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  // 从模型输出中提取 JSON（兼容模型偶尔包裹代码块的情况）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    sendJson(res, 502, { error: 'invalid_model_output', detail: content.slice(0, 300) });
    return;
  }
  let plan;
  try {
    plan = JSON.parse(jsonMatch[0]);
    // 模型可能拼错 remind 字段名（remrem/reminder/rem 等）
    if (!plan.remind) plan.remind = plan.remrem || plan.reminder || plan.rem || '';
  } catch (e) {
    // JSON.parse 失败时，用正则容错提取字段（模型可能少逗号、拼错字段名）
    const badgeMatch = content.match(/"badge"\s*:\s*"([^"]+)"/);
    const remindMatch = content.match(/"rem\w*"\s*:\s*"([^"]+)"/i);
    const tasksMatch = content.match(/"tasks"\s*:\s*\[([\s\S]*?)\]/);
    const rawTasks = tasksMatch ? tasksMatch[1].match(/"([^"]+)"/g) : null;
    if (!rawTasks || !rawTasks.length) {
      sendJson(res, 502, { error: 'json_parse_failed', detail: content.slice(0, 300) });
      return;
    }
    plan = {
      badge: badgeMatch ? badgeMatch[1] : '成长小芽',
      remind: remindMatch ? remindMatch[1] : '',
      tasks: rawTasks.map(t => t.replace(/^"|"$/g, ''))
    };
  }
  if (!plan.tasks || !Array.isArray(plan.tasks) || !plan.tasks.length) {
    sendJson(res, 502, { error: 'invalid_plan', detail: 'missing tasks' });
    return;
  }
  // 规范化输出
  sendJson(res, 200, {
    badge: String(plan.badge || '成长小芽').slice(0, 20),
    remind: String(plan.remind || '').slice(0, 100),
    tasks: plan.tasks.filter(t => typeof t === 'string').map(t => t.slice(0, 60)).slice(0, 6)
  });
}

/* ---------- 百度语音识别（短语音 REST）：服务端代理，保护 Secret Key ---------- */
let baiduTokenCache = null; // { token, expiresAt }

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

async function handleAsr(req, res) {
  if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
    sendJson(res, 500, { error: 'missing_baidu_credentials' });
    return;
  }
  let audioBuffer;
  try {
    audioBuffer = await readRawBody(req, 5 * 1024 * 1024);
  } catch (e) {
    sendJson(res, 413, { error: 'audio_too_large', detail: String(e.message || e) });
    return;
  }
  if (!audioBuffer.length) {
    sendJson(res, 400, { error: 'empty_audio' });
    return;
  }

  let token;
  try {
    token = await getBaiduToken();
  } catch (e) {
    sendJson(res, 502, { error: 'baidu_token_failed', detail: String(e.message || e) });
    return;
  }

  const payload = {
    format: 'wav',
    rate: 16000,
    channel: 1,
    token,
    cuid: 'xinya-demo-' + (process.pid || 'local'),
    speech: audioBuffer.toString('base64'),
    len: audioBuffer.length
  };

  let baiduRes;
  try {
    baiduRes = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    sendJson(res, 502, { error: 'baidu_asr_unreachable', detail: String(e.message || e) });
    return;
  }

  const baiduData = await baiduRes.json().catch(() => ({}));
  if (baiduData.err_no && baiduData.err_no !== 0) {
    sendJson(res, 502, { error: 'baidu_asr_failed', detail: baiduData.err_msg || ('err_no=' + baiduData.err_no) });
    return;
  }
  const text = Array.isArray(baiduData.result) ? baiduData.result.join('') : (baiduData.result || '');
  sendJson(res, 200, { text });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 阻止访问服务器端敏感文件（防止 .env、server.js 等被下载泄露密钥）
  const BLOCKED_FILES = new Set([
    '.env', '.env.example', '.gitignore', '.gitattributes',
    'server.js', 'package.json', 'package-lock.json'
  ]);
  const filename = path.basename(filePath);
  if (filename.startsWith('.') || BLOCKED_FILES.has(filename)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url && req.url.startsWith('/api/treehole-chat')) {
      if (!apiGuard(req, res, 'api')) return;
      await handleTreeholeChat(req, res);
      return;
    }
    if (req.method === 'POST' && req.url && req.url.startsWith('/api/habit-plan')) {
      if (!apiGuard(req, res, 'api')) return;
      await handleHabitPlan(req, res);
      return;
    }
    if (req.method === 'POST' && req.url && req.url.startsWith('/api/asr')) {
      if (!apiGuard(req, res, 'asr')) return;
      await handleAsr(req, res);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res);
      return;
    }
    res.writeHead(405);
    res.end('Method Not Allowed');
  } catch (e) {
    sendJson(res, 500, { error: 'server_error', detail: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`心芽守护 demo running at http://0.0.0.0:${PORT} (访问请用实际域名/IP)`);
  console.log(`环境: ${isProd ? 'production' : 'development'} | 来源验证: ${isProd ? '严格同源' : '开发模式(允许localhost)'}`);
  console.log(`频率限制: API ${rateLimiter.limits.api}次/分, ASR ${rateLimiter.limits.asr}次/分`);
  console.log(`Treehole model: ${MODEL}`);
  console.log(`API key: ${API_KEY ? '已加载 (length=' + API_KEY.length + ')' : '未配置，将回退本地规则'}`);
  console.log(`百度 ASR: ${BAIDU_API_KEY && BAIDU_SECRET_KEY ? '已配置' : '未配置，语音倾诉将不可用'}`);
  if (!isProd) console.log('提示: 部署时请设置 NODE_ENV=production 启用安全脱敏和严格来源验证');
});
