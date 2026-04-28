/*
 * Copyright 2025 Loney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * TTS 服务工厂 - 支持多引擎
 *  - volcengine  : 火山引擎 V3 双向流式 WebSocket（原有实现）
 *  - openai      : OpenAI TTS / 兼容接口（REST，MP3 → PCM）
 *  - edge        : Edge TTS（微软免费，无需 Key）
 *  - cosyvoice   : CosyVoice 本地 HTTP 服务 / 通用 HTTP TTS
 */
'use strict';

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// ============================================================
//  火山引擎 V3
// ============================================================
const TTS_WS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

const EV_START_CONN     = 1;
const EV_FINISH_CONN    = 2;
const EV_CONN_STARTED   = 50;
const EV_START_SESSION  = 100;
const EV_CANCEL_SESSION = 101;
const EV_FINISH_SESSION = 102;
const EV_SESS_STARTED   = 150;
const EV_SESS_CANCELED  = 151;
const EV_SESS_FINISHED  = 152;
const EV_SESS_FAILED    = 153;
const EV_TASK_REQUEST   = 200;
const EV_TTS_RESPONSE   = 352;

const CLIENT_HDR = Buffer.from([0x11, 0x14, 0x10, 0x00]);
const MIN_CHUNK_LEN = 4;

function ttsPack(event, sessionId, payloadDict) {
  const payload = Buffer.from(JSON.stringify(payloadDict), 'utf-8');
  const parts = [CLIENT_HDR];

  const evBuf = Buffer.alloc(4);
  evBuf.writeUInt32BE(event);
  parts.push(evBuf);

  if (sessionId !== null && sessionId !== undefined) {
    const sidBuf = Buffer.from(sessionId, 'utf-8');
    const sidLen = Buffer.alloc(4);
    sidLen.writeUInt32BE(sidBuf.length);
    parts.push(sidLen, sidBuf);
  }

  const pLen = Buffer.alloc(4);
  pLen.writeUInt32BE(payload.length);
  parts.push(pLen, payload);

  return Buffer.concat(parts);
}

function ttsParse(data) {
  if (data.length < 4) return { event: null, audio: null };

  const msgType = (data[1] >> 4) & 0x0f;
  const flags   = data[1] & 0x0f;
  let pos = (data[0] & 0x0f) * 4;

  if (msgType === 0xf) {
    const event = data.length >= pos + 4 ? data.readUInt32BE(pos) : null;
    return { event, audio: null };
  }

  let event = null;
  if ((flags & 0x4) && data.length >= pos + 4) {
    event = data.readUInt32BE(pos);
    pos += 4;
  }

  if (data.length >= pos + 4) {
    const sidLen = data.readUInt32BE(pos);
    pos += 4 + sidLen;
  }

  if (data.length < pos + 4) return { event, audio: null };
  const payloadLen = data.readUInt32BE(pos);
  pos += 4;
  const payload = data.slice(pos, pos + payloadLen);

  if (msgType === 0xb) {
    return { event, audio: payload.length > 0 ? payload : null };
  }
  return { event, audio: null };
}

class VolcengineTTS {
  constructor() {
    this._ws = null;
    this._connected = false;
    this._sessionId = '';
    this._buf = '';
    this._activeRound = 0;
    this._onAudio = null;
    this._onEnd = null;
    this._config = null;
    this._connectPromise = null;
  }

  async connect(config) {
    if (this._connected && this._ws?.readyState === WebSocket.OPEN) return;
    this._config = config;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      const headers = {
        'X-Api-App-Key':     config.app_id || '',
        'X-Api-Access-Key':  config.access_token || '',
        'X-Api-Resource-Id': config.resource_id || 'seed-icl-2.0',
      };

      this._ws = new WebSocket(TTS_WS_URL, { headers });
      const timeout = setTimeout(() => {
        reject(new Error('TTS WebSocket 连接超时'));
        this._connectPromise = null;
      }, 10000);

      this._ws.on('open', () => {
        this._ws.send(ttsPack(EV_START_CONN, null, {}));
      });

      this._ws.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const { event, audio } = ttsParse(buf);

        if (event === EV_CONN_STARTED && !this._connected) {
          this._connected = true;
          clearTimeout(timeout);
          this._connectPromise = null;
          resolve();
          return;
        }

        if (audio && this._onAudio) this._onAudio(this._activeRound, audio);

        if (event === EV_SESS_FINISHED || event === EV_SESS_FAILED) {
          if (this._onEnd) this._onEnd(this._activeRound);
        }
      });

      this._ws.on('error', (err) => {
        console.error('[TTS:volcengine] error:', err.message);
        clearTimeout(timeout);
        this._connected = false;
        this._connectPromise = null;
        reject(err);
      });

      this._ws.on('close', () => {
        this._connected = false;
        this._connectPromise = null;
      });
    });

    return this._connectPromise;
  }

  start(onAudio, onEnd) {
    const oldSid = this._sessionId;
    this._activeRound += 1;
    this._sessionId = uuidv4();
    this._buf = '';
    this._onAudio = onAudio;
    this._onEnd = onEnd;

    if (oldSid && this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(ttsPack(EV_CANCEL_SESSION, oldSid, {}));
    }

    const config = this._config || {};
    const payload = {
      user: { uid: 'desktop_pet_user' },
      event: EV_START_SESSION,
      req_params: {
        speaker: config.voice_type || 'S_9CQRiGHL1',
        audio_params: {
          format: 'pcm',
          sample_rate: config.sample_rate || 24000,
          speech_rate: config.speech_rate ?? 13,
        },
        additions: JSON.stringify({
          explicit_language: 'zh',
          disable_markdown_filter: true,
          use_tag_parser: true,
        }),
      },
    };

    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(ttsPack(EV_START_SESSION, this._sessionId, payload));
    }

    return this._activeRound;
  }

  sendText(fragment) {
    this._buf += fragment;
    if (this._buf.length >= MIN_CHUNK_LEN) this._flush();
  }

  finish() {
    if (this._buf) this._flush();
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(ttsPack(EV_FINISH_SESSION, this._sessionId, {}));
    }
  }

  _flush() {
    if (this._ws?.readyState === WebSocket.OPEN && this._buf) {
      this._ws.send(ttsPack(EV_TASK_REQUEST, this._sessionId, {
        event: EV_TASK_REQUEST,
        req_params: { text: this._buf },
      }));
    }
    this._buf = '';
  }

  get activeRound() { return this._activeRound; }

  close() {
    if (this._ws?.readyState === WebSocket.OPEN) {
      try { this._ws.send(ttsPack(EV_FINISH_CONN, null, {})); } catch (_e) {}
      this._ws.close();
    }
    this._ws = null;
    this._connected = false;
  }
}

// ============================================================
//  OpenAI TTS（REST，MP3 → PCM via ffmpeg 或直接发 MP3 给渲染层）
//  渲染层已有 AudioContext 能解码 MP3，所以发原始 ArrayBuffer 即可
// ============================================================
class OpenAITTS {
  constructor() {
    this._config = null;
    this._activeRound = 0;
    this._onAudio = null;
    this._onEnd = null;
    this._buf = '';
    this._aborted = false;
  }

  async connect(config) {
    this._config = config;
  }

  start(onAudio, onEnd) {
    this._activeRound += 1;
    this._buf = '';
    this._aborted = false;
    this._onAudio = onAudio;
    this._onEnd = onEnd;
    return this._activeRound;
  }

  sendText(fragment) {
    this._buf += fragment;
  }

  finish() {
    const text = this._buf.trim();
    this._buf = '';
    if (!text) {
      if (this._onEnd) this._onEnd(this._activeRound);
      return;
    }

    const round = this._activeRound;
    const cfg = this._config || {};
    const apiBase = (cfg.openai_api_base || cfg.api_base || 'https://api.openai.com').replace(/\/$/, '');
    const url = `${apiBase}/v1/audio/speech`;
    const body = JSON.stringify({
      model: cfg.openai_model || cfg.model || 'tts-1',
      input: text,
      voice: cfg.openai_voice || cfg.voice || 'alloy',
      response_format: 'mp3',
      speed: cfg.openai_speed || cfg.speed || 1.0,
    });

    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.openai_api_key || cfg.api_key || ''}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => {
      if (this._aborted || round !== this._activeRound) return;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (this._aborted || round !== this._activeRound) return;
        const mp3 = Buffer.concat(chunks);
        if (this._onAudio) this._onAudio(round, mp3);
        if (this._onEnd) this._onEnd(round);
      });
    });

    req.on('error', (err) => {
      console.error('[TTS:openai] request error:', err.message);
      if (this._onEnd) this._onEnd(round);
    });

    req.write(body);
    req.end();
  }

  get activeRound() { return this._activeRound; }

  close() {
    this._aborted = true;
  }
}

// ============================================================
//  Edge TTS（调用系统 edge-tts 命令行，输出 MP3 流）
//  需要 pip install edge-tts 或系统已有 edge-tts 可执行文件
// ============================================================
class EdgeTTS {
  constructor() {
    this._config = null;
    this._activeRound = 0;
    this._onAudio = null;
    this._onEnd = null;
    this._buf = '';
    this._proc = null;
  }

  async connect(config) {
    this._config = config;
  }

  start(onAudio, onEnd) {
    if (this._proc) {
      try { this._proc.kill(); } catch (_e) {}
      this._proc = null;
    }
    this._activeRound += 1;
    this._buf = '';
    this._onAudio = onAudio;
    this._onEnd = onEnd;
    return this._activeRound;
  }

  sendText(fragment) {
    this._buf += fragment;
  }

  finish() {
    const text = this._buf.trim();
    this._buf = '';
    if (!text) {
      if (this._onEnd) this._onEnd(this._activeRound);
      return;
    }

    const round = this._activeRound;
    const cfg = this._config || {};
    const voice  = cfg.edge_voice  || cfg.voice  || 'zh-CN-XiaoxiaoNeural';
    const rate   = cfg.edge_rate   || cfg.rate   || '+0%';
    const volume = cfg.edge_volume || cfg.volume || '+0%';

    // edge-tts --text "..." --voice zh-CN-XiaoxiaoNeural --write-media -
    const args = [
      '--text', text,
      '--voice', voice,
      '--rate', rate,
      '--volume', volume,
      '--write-media', '-',
    ];

    let proc;
    try {
      proc = spawn('edge-tts', args);
    } catch (e) {
      console.error('[TTS:edge] spawn error:', e.message);
      if (this._onEnd) this._onEnd(round);
      return;
    }

    this._proc = proc;
    const chunks = [];

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.on('close', (code) => {
      this._proc = null;
      if (round !== this._activeRound) return;
      if (chunks.length > 0) {
        const mp3 = Buffer.concat(chunks);
        if (this._onAudio) this._onAudio(round, mp3);
      }
      if (this._onEnd) this._onEnd(round);
    });
    proc.on('error', (err) => {
      console.error('[TTS:edge] error:', err.message);
      if (this._onEnd) this._onEnd(round);
    });
  }

  get activeRound() { return this._activeRound; }

  close() {
    if (this._proc) {
      try { this._proc.kill(); } catch (_e) {}
      this._proc = null;
    }
  }
}

// ============================================================
//  CosyVoice / 通用 HTTP TTS
//  POST {api_base}/inference_sft  body: { tts_text, spk_id }
//  返回 wav 二进制 → 直接发给渲染层
// ============================================================
class CosyVoiceTTS {
  constructor() {
    this._config = null;
    this._activeRound = 0;
    this._onAudio = null;
    this._onEnd = null;
    this._buf = '';
    this._aborted = false;
  }

  async connect(config) {
    this._config = config;
  }

  start(onAudio, onEnd) {
    this._activeRound += 1;
    this._buf = '';
    this._aborted = false;
    this._onAudio = onAudio;
    this._onEnd = onEnd;
    return this._activeRound;
  }

  sendText(fragment) {
    this._buf += fragment;
  }

  finish() {
    const text = this._buf.trim();
    this._buf = '';
    if (!text) {
      if (this._onEnd) this._onEnd(this._activeRound);
      return;
    }

    const round = this._activeRound;
    const cfg = this._config || {};
    const apiBase  = (cfg.cosyvoice_api_base || cfg.api_base || 'http://127.0.0.1:50000').replace(/\/$/, '');
    const endpoint = cfg.cosyvoice_endpoint || cfg.endpoint || '/inference_sft';
    const url = `${apiBase}${endpoint}`;
    const body = JSON.stringify({
      tts_text: text,
      spk_id: cfg.cosyvoice_spk_id || cfg.spk_id || 'default',
    });

    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => {
      if (this._aborted || round !== this._activeRound) return;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (this._aborted || round !== this._activeRound) return;
        const wav = Buffer.concat(chunks);
        if (this._onAudio) this._onAudio(round, wav);
        if (this._onEnd) this._onEnd(round);
      });
    });

    req.on('error', (err) => {
      console.error('[TTS:cosyvoice] request error:', err.message);
      if (this._onEnd) this._onEnd(round);
    });

    req.write(body);
    req.end();
  }

  get activeRound() { return this._activeRound; }

  close() {
    this._aborted = true;
  }
}

// ============================================================
//  工厂：TTSService
// ============================================================
class TTSService {
  constructor() {
    this._impl = null;
    this._provider = null;
  }

  /**
   * connect 时根据 config.provider 选择实现
   * @param {object} config  tts 配置，含 provider 字段
   */
  async connect(config) {
    const provider = (config.provider || 'volcengine').toLowerCase();

    // provider 变了就重建
    if (this._provider !== provider) {
      if (this._impl) { try { this._impl.close(); } catch (_e) {} }
      switch (provider) {
        case 'openai':     this._impl = new OpenAITTS();     break;
        case 'edge':       this._impl = new EdgeTTS();       break;
        case 'cosyvoice':  this._impl = new CosyVoiceTTS();  break;
        default:           this._impl = new VolcengineTTS(); break;
      }
      this._provider = provider;
    }

    return this._impl.connect(config);
  }

  start(onAudio, onEnd)  { return this._impl ? this._impl.start(onAudio, onEnd) : 0; }
  sendText(fragment)     { if (this._impl) this._impl.sendText(fragment); }
  finish()               { if (this._impl) this._impl.finish(); }
  get activeRound()      { return this._impl ? this._impl.activeRound : 0; }

  close() {
    if (this._impl) { this._impl.close(); this._impl = null; }
    this._provider = null;
  }
}

module.exports = { TTSService };
