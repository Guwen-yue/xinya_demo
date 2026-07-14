const {
  API_BASE, MODEL, API_KEY,
  HABIT_PLAN_SYSTEM_PROMPT,
  sendJson, readBody, safeJsonParse, apiGuard
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
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, top_p: 0.9, max_tokens: 400, stream: false })
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
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    sendJson(res, 502, { error: 'invalid_model_output', detail: content.slice(0, 300) });
    return;
  }

  let plan;
  try {
    plan = JSON.parse(jsonMatch[0]);
    if (!plan.remind) plan.remind = plan.remrem || plan.reminder || plan.rem || '';
  } catch (e) {
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

  sendJson(res, 200, {
    badge: String(plan.badge || '成长小芽').slice(0, 20),
    remind: String(plan.remind || '').slice(0, 100),
    tasks: plan.tasks.filter(t => typeof t === 'string').map(t => t.slice(0, 60)).slice(0, 6)
  });
};
