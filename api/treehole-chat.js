const {
  API_BASE, MODEL, API_KEY,
  TREEHOLE_SYSTEM_PROMPT,
  sendJson, readBody, safeJsonParse, safeMessages, apiGuard
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!apiGuard(req, res, 'api')) return;
  if (!API_KEY) {
    sendJson(res, 500, { error: 'missing_api_key' });
    return;
  }

  // 兼容 Vercel 自动解析 req.body 和本地 readBody 流式读取
  let body;
  if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else {
    try {
      body = safeJsonParse(await readBody(req));
    } catch (e) {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
  }

  const text = String(body.text || '').trim().slice(0, 1200);
  if (!text) {
    sendJson(res, 400, { error: 'empty_text' });
    return;
  }

  const localEmotion = body.localEmotion || {};
  const messages = [
    { role: 'system', content: TREEHOLE_SYSTEM_PROMPT },
    { role: 'system', content: `前端本地规则初判：${JSON.stringify(localEmotion)}。这是辅助信息，不要机械照抄；如发现高风险，请按危机支持原则回复。` },
    ...safeMessages(body.history),
    { role: 'user', content: text }
  ];

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.55, top_p: 0.85, max_tokens: 512, stream: true })
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

  // SSE 流式输出
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let contentBuffer = '';
  let metaParsed = false;

  function emit(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  function tryParseMeta() {
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
        const tags = tagsMatch ? tagsMatch[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 3) : [];
        emit({ meta: { intensity, tags } });
        contentBuffer = rest.replace(/^[\r\n]+/, '');
        if (contentBuffer) emit({ delta: contentBuffer });
        contentBuffer = '';
        metaParsed = true;
        return true;
      }
      emit({ delta: contentBuffer });
      contentBuffer = '';
      metaParsed = true;
      return true;
    }
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

  if (!metaParsed && contentBuffer) {
    emit({ delta: contentBuffer });
    contentBuffer = '';
  }

  emit({ done: true });
  res.write('data: [DONE]\n\n');
  res.end();
};
