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
 * 记忆服务 - 短期上下文 + 长期摘要 + 结构化事实提取 + 持久化
 *
 * memory.json 结构：
 * {
 *   "summary": "...",
 *   "facts": [{ "key": "...", "value": "...", "ts": 0 }],
 *   "pendingHistory": [{ "role": "user"|"assistant", "content": "..." }],
 *   "lastSummaryAt": 0,
 *   "totalRounds": 0
 * }
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── 默认参数（可通过 setMemoryConfig 覆盖）─────────────────
let SUMMARY_TRIGGER   = 16;   // pendingHistory 条数达到此值时触发摘要压缩（= 上下文轮数 × 2）
let SUMMARY_AFTER_KEEP = 4;   // 压缩后保留最近几条
let SHORT_TERM_KEEP   = 20;   // 喂给 LLM 的最大短期条数（= 上下文轮数 × 2）
const MAX_SUMMARY_LEN   = 300;  // 摘要最大字数提示
// ──────────────────────────────────────────────────────────

/**
 * 动态更新记忆参数（由设置里的上下文轮数驱动）
 * @param {number} contextRounds  上下文轮数（默认10）
 */
function setMemoryConfig(contextRounds) {
  const rounds = Math.max(2, Math.min(50, contextRounds || 10));
  SHORT_TERM_KEEP   = rounds * 2;          // 短期上下文条数
  SUMMARY_TRIGGER   = rounds * 2;          // 触发摘要的条数阈值
  SUMMARY_AFTER_KEEP = Math.max(2, Math.floor(rounds / 2)); // 压缩后保留条数
}

let MEMORY_PATH = path.join(__dirname, '..', 'memory.json');

/**
 * 由 main.js 在 app ready 后调用，将数据文件指向 userData 目录
 * @param {string} dataDir  app.getPath('userData')
 */
function setDataDir(dataDir) {
  MEMORY_PATH = path.join(dataDir, 'memory.json');
}

/** 内存中的记忆状态 */
let mem = {
  summary: '',
  facts: [],
  pendingHistory: [],
  lastSummaryAt: 0,
  totalRounds: 0,
};

let _loaded = false;
let _summarizing = false; // 防止并发摘要

// ========================
//  读写
// ========================

function load() {
  if (_loaded) return;
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    mem = {
      summary: parsed.summary || '',
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      pendingHistory: Array.isArray(parsed.pendingHistory) ? parsed.pendingHistory : [],
      lastSummaryAt: parsed.lastSummaryAt || 0,
      totalRounds: parsed.totalRounds || 0,
    };
  } catch (_e) {
    // 文件不存在或损坏，从空记忆开始
    mem = { summary: '', facts: [], pendingHistory: [], lastSummaryAt: 0, totalRounds: 0 };
  }
  _loaded = true;
}

function save() {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Memory] save failed:', e.message);
  }
}

// ========================
//  公开接口
// ========================

/**
 * 获取注入 LLM 的 messages（不含当前用户消息）
 * @param {string} baseSystemPrompt 原始角色设定
 * @returns {Array<{role,content}>}
 */
function getContextMessages(baseSystemPrompt) {
  load();

  // 1. 系统消息：角色设定 + 长期记忆注入
  let systemContent = baseSystemPrompt || '你是一个桌宠助手，简短回复。';
  if (mem.summary) {
    systemContent += `\n\n【对话记忆】\n${mem.summary}`;
  }
  if (mem.facts.length > 0) {
    const factLines = mem.facts.map(f => `- ${f.key}：${f.value}`).join('\n');
    systemContent += `\n\n【关键信息】\n${factLines}`;
  }

  const messages = [{ role: 'system', content: systemContent }];

  // 2. 短期上下文（最近 SHORT_TERM_KEEP 条）
  const shortTerm = mem.pendingHistory.slice(-SHORT_TERM_KEEP);
  messages.push(...shortTerm);

  return messages;
}

/**
 * 对话完成后追加一轮记录
 * @param {string} userText  用户输入（截屏时传 '[截屏]'）
 * @param {string} assistantText  AI 回复
 * @param {object} llmConfig  用于触发摘要的 LLM 配置
 */
function appendRound(userText, assistantText, llmConfig) {
  load();

  mem.pendingHistory.push({ role: 'user', content: userText });
  mem.pendingHistory.push({ role: 'assistant', content: assistantText });
  mem.totalRounds += 1;
  save();

  // 异步触发摘要压缩（不阻塞主对话）
  if (mem.pendingHistory.length >= SUMMARY_TRIGGER && !_summarizing) {
    _triggerSummary(llmConfig).catch(e => console.error('[Memory] summary error:', e.message));
  }
}

/**
 * 导出记忆文件内容（JSON 字符串）
 */
function exportMemory() {
  load();
  return JSON.stringify(mem, null, 2);
}

/**
 * 导入记忆（JSON 字符串）
 * @param {string} jsonStr
 * @returns {{ ok: boolean, error?: string }}
 */
function importMemory(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    mem = {
      summary: parsed.summary || '',
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      pendingHistory: Array.isArray(parsed.pendingHistory) ? parsed.pendingHistory : [],
      lastSummaryAt: parsed.lastSummaryAt || 0,
      totalRounds: parsed.totalRounds || 0,
    };
    _loaded = true;
    save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 获取当前记忆摘要信息（供 UI 展示）
 */
function getMemoryInfo() {
  load();
  return {
    summary: mem.summary,
    facts: mem.facts,
    totalRounds: mem.totalRounds,
    pendingCount: mem.pendingHistory.length,
    lastSummaryAt: mem.lastSummaryAt,
  };
}

// ========================
//  内部：摘要压缩 + 事实提取
// ========================

async function _triggerSummary(llmConfig) {
  if (_summarizing) return;
  _summarizing = true;

  try {
    // 取出待压缩的历史（保留最后 SUMMARY_AFTER_KEEP 条不压缩）
    const toCompress = mem.pendingHistory.slice(0, -SUMMARY_AFTER_KEEP);
    if (toCompress.length === 0) return;

    const historyText = toCompress
      .map(m => `${m.role === 'user' ? '用户' : '小玄'}：${m.content}`)
      .join('\n');

    const oldSummary = mem.summary || '（暂无）';
    const oldFacts = mem.facts.length > 0
      ? mem.facts.map(f => `${f.key}：${f.value}`).join('；')
      : '（暂无）';

    const summaryPrompt = `你是一个记忆整理助手。请根据以下信息完成两项任务并以 JSON 格式返回。

【角色说明】
- 对话格式为 "用户：..." 和 "小玄：..."，"用户"是真实的人类，"小玄"是 AI 桌宠。
- 若用户在对话中告知自己的名字，记录为"用户名字"，切勿与桌宠名称混淆。
- 小玄的名字固定是"小玄"，用户若给桌宠起了昵称，单独记录为"桌宠昵称"。

任务1：将"新对话"与"已有摘要"合并，生成一段简洁的长期记忆摘要（${MAX_SUMMARY_LEN}字以内）。重点记录：对话中涉及的职业/爱好/情绪/话题/特殊互动。

任务2：从新对话中提取或更新结构化事实（如用户名字、职业、偏好等），与已有事实合并。每条事实格式：{ "key": "字段名", "value": "值" }，最多保留 15 条最重要的。

已有摘要：${oldSummary}
已有事实：${oldFacts}
新对话：
${historyText}

请严格返回如下 JSON（不要有其他文字）：
{
  "summary": "...",
  "facts": [{ "key": "...", "value": "..." }]
}`;

    const result = await _callLLMOnce(summaryPrompt, llmConfig);
    if (!result) return;

    // 解析返回的 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Memory] summary: no JSON found in response');
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.summary) {
      mem.summary = parsed.summary;
    }
    if (Array.isArray(parsed.facts)) {
      // 合并：用新值覆盖已有同名 key
      const factMap = new Map(mem.facts.map(f => [f.key, f]));
      for (const f of parsed.facts) {
        if (f.key && f.value) {
          factMap.set(f.key, { key: f.key, value: f.value, ts: Date.now() });
        }
      }
      mem.facts = Array.from(factMap.values()).slice(-15);
    }

    // 保留最后 SUMMARY_AFTER_KEEP 条
    mem.pendingHistory = mem.pendingHistory.slice(-SUMMARY_AFTER_KEEP);
    mem.lastSummaryAt = Date.now();
    save();

    console.log('[Memory] summary updated, facts:', mem.facts.length);
  } catch (e) {
    console.error('[Memory] _triggerSummary failed:', e.message);
    // 失败不影响正常聊天
  } finally {
    _summarizing = false;
  }
}

/**
 * 单次非流式调用 LLM（仅用于摘要，不影响 chatHistory）
 */
async function _callLLMOnce(prompt, config) {
  const { api_base, api_key, model } = config || {};
  if (!api_key || !api_base || !model) return null;

  const url = `${api_base.replace(/\/+$/, '')}/chat/completions`;
  const isDoubao = /doubao|seed/i.test(model);
  const extraBody = isDoubao ? { thinking: { type: 'disabled' } } : {};

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${api_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一个记忆管理助手，严格按照用户要求输出 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        stream: false,
        ...extraBody,
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (_e) {
    return null;
  }
}

/**
 * 强制触发一次摘要压缩（退出时调用），有 pending 内容才执行
 * 需要外部传入 llmConfig，返回 Promise
 */
async function flushSummary(llmConfig) {
  load();
  if (mem.pendingHistory.length < 2) return; // 不足一轮，跳过
  if (_summarizing) return;                   // 已在压缩中，等它自己完成
  await _triggerSummary(llmConfig);
}

/**
 * 清空所有记忆，恢复初始状态
 */
function clearMemory() {
  mem = { summary: '', facts: [], pendingHistory: [], lastSummaryAt: 0, totalRounds: 0 };
  _loaded = true;
  save();
}

module.exports = {
  load,
  setDataDir,
  getContextMessages,
  appendRound,
  exportMemory,
  importMemory,
  getMemoryInfo,
  clearMemory,
  setMemoryConfig,
  flushSummary,
};
