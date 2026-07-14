const {
  BAIDU_API_KEY, BAIDU_SECRET_KEY,
  sendJson, readRawBody, apiGuard, getBaiduToken
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!apiGuard(req, res, 'asr')) return;
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
    cuid: 'xinya-demo-vercel',
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
};
