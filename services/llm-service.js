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
 * LLM 服务 - OpenAI 兼容 API 流式调用（接入记忆服务）
 */
'use strict';

const memoryService = require('./memory-service');

/**
 * 流式调用 LLM，通过回调逐 token 返回
 * @param {string} userMessage 用户消息
 * @param {object} config llm 配置
 * @param {function} onToken (token: string) => void
 * @param {function} onDone (fullText: string) => void
 * @param {function} onError (err: Error) => void
 * @param {string|null} imageBase64 可选的截屏 base64 图片
 * @param {function|null} onDebugPrompt (data: {messages, model, ts}) => void  调试回调
 */
async function chatStream(userMessage, config, onToken, onDone, onError, imageBase64, onDebugPrompt, extraImages) {
  const { api_base, api_key, model, temperature, system_prompt } = config;

  if (!api_key) {
    onError(new Error('请先在设置中配置 API Key'));
    return;
  }

  // 构建用户消息内容（支持图文混合，支持多图）
  let userContent;
  const allImages = [];
  if (imageBase64) allImages.push(imageBase64);
  if (Array.isArray(extraImages)) allImages.push(...extraImages.filter(Boolean));

  if (allImages.length > 0) {
    userContent = [
      ...allImages.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
      { type: 'text', text: userMessage || '请描述你看到的内容，用口语化的方式简短回复。' },
    ];
  } else {
    userContent = userMessage;
  }

  // 三层记忆构建：[system+长期记忆] + [短期上下文] + [当前用户消息]
  const messages = [
    ...memoryService.getContextMessages(system_prompt),
    { role: 'user', content: userContent },
  ];

  // 调试回调：推送本轮完整提示词（图片内容替换为占位符，避免数据过大）
  if (typeof onDebugPrompt === 'function') {
    const debugMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        return {
          ...m,
          content: m.content.map(c =>
            c.type === 'image_url' ? { type: 'image_url', image_url: { url: '[图片 base64 已省略]' } } : c
          ),
        };
      }
      return m;
    });
    onDebugPrompt({ messages: debugMessages, model, ts: Date.now() });
  }

  // doubao/seed 模型关闭深度思考
  const isDoubao = /doubao|seed/i.test(model);
  const extraBody = isDoubao ? { thinking: { type: 'disabled' } } : {};

  const body = {
    model,
    messages,
    temperature: temperature || 0.8,
    stream: true,
    ...extraBody,
  };

  const url = `${api_base.replace(/\/+$/, '')}/chat/completions`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      onError(new Error(`LLM API ${resp.status}: ${errText.slice(0, 200)}`));
      return;
    }

    const reader = resp.body;
    if (!reader) {
      onError(new Error('无法获取响应流'));
      return;
    }

    let fullText = '';
    let inThink = false;
    let buffer = '';

    const decoder = new TextDecoder();
    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          let token = parsed.choices?.[0]?.delta?.content || '';
          if (!token) continue;

          // 过滤 <think>...</think>
          if (token.includes('<think>')) {
            inThink = true;
            token = token.split('<think>')[0];
          }
          if (inThink) {
            if (token.includes('</think>')) {
              inThink = false;
              token = token.split('</think>').pop() || '';
            } else {
              continue;
            }
          }
          if (!token) continue;

          fullText += token;
          onToken(token);
        } catch (_e) {
          // 忽略解析错误
        }
      }
    }

    // 追加到记忆（不存图片原始数据，避免历史膨胀）
    // 截屏时：用 AI 回复首句作为图片内容摘要，保留细节
    let memUserText;
    if (imageBase64) {
      const firstSentence = fullText.split(/[。！？!?\n]/)[0].slice(0, 60);
      memUserText = `[截屏] ${firstSentence}`;
    } else {
      memUserText = userMessage;
    }
    memoryService.appendRound(memUserText, fullText, config);

    onDone(fullText);
  } catch (err) {
    onError(err);
  }
}

/**
 * 非流式单次调用，支持 function call（用于决策场景）
 * @param {Array}  messages   完整 messages 数组
 * @param {object} config     llm 配置（api_base / api_key / model / temperature）
 * @param {Array}  tools      OpenAI tools 定义数组
 * @returns {Promise<{text: string|null, toolCall: {name:string, args:object}|null}>}
 */
async function callOnce(messages, config, tools) {
  const { api_base, api_key, model, temperature } = config;
  const url = `${api_base.replace(/\/+$/, '')}/chat/completions`;

  const isDoubao = /doubao|seed/i.test(model);
  const extraBody = isDoubao ? { thinking: { type: 'disabled' } } : {};

  const body = {
    model,
    messages,
    temperature: temperature || 0.5,
    stream: false,
    ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
    ...extraBody,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${api_key}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  const msg = choice?.message;

  // function call 响应
  if (msg?.tool_calls?.length) {
    const tc = msg.tool_calls[0];
    let args = {};
    try { args = JSON.parse(tc.function.arguments); } catch (_e) {}
    return { text: null, toolCall: { name: tc.function.name, args } };
  }

  return { text: msg?.content || '', toolCall: null };
}

module.exports = { chatStream, callOnce };
