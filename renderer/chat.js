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
 * 聊天 UI 逻辑 + TTS 音频播放 + 口型同步
 */
'use strict';

// ========================
//  DOM 引用
// ========================
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const chatBubble = document.getElementById('chat-bubble');
const bubbleContent = document.getElementById('bubble-content');


// 气泡显示开关
let showBubble = true;
// TTS 启用状态（与配置同步，用于 onChatToken 判断是否自动显示气泡）
let ttsEnabled = true;

function showChatBubble() {
  if (showBubble) chatBubble.classList.add('visible');
}
const windowDragHandle = document.getElementById('window-drag-handle');
const windowZoomIn = document.getElementById('window-zoom-in');
const windowZoomOut = document.getElementById('window-zoom-out');

// ========================
//  窗口缩放按钮
// ========================
let _scaleLabelTimer = null;
const windowScaleLabel = document.getElementById('window-scale-label');

function showScaleLabel() {
  windowScaleLabel.textContent = Math.round(windowScale * 100) + '%';
  windowScaleLabel.classList.add('visible');
  if (_scaleLabelTimer) clearTimeout(_scaleLabelTimer);
  _scaleLabelTimer = setTimeout(() => windowScaleLabel.classList.remove('visible'), 1500);
}

function hideHandles() {
  if (_handleHideTimer) { clearTimeout(_handleHideTimer); _handleHideTimer = null; }
  windowDragHandle.classList.remove('visible');
  windowZoomIn.classList.remove('visible');
  windowZoomOut.classList.remove('visible');
}

// ========================
//  窗口拖动手柄
// ========================
let _handleHideTimer = null;
let _handleDragging = false;

// 供 pet-controller 在点击模型时调用
window.showWindowDragHandle = function() {
  windowDragHandle.classList.add('visible');
  windowZoomIn.classList.add('visible');
  windowZoomOut.classList.add('visible');
  if (_handleHideTimer) clearTimeout(_handleHideTimer);
  _handleHideTimer = setTimeout(() => {
    if (!_handleDragging) {
      windowDragHandle.classList.remove('visible');
      windowZoomIn.classList.remove('visible');
      windowZoomOut.classList.remove('visible');
    }
  }, 2000);
};

windowDragHandle.addEventListener('mouseenter', () => {
  window._windowDragHandleHover = true;
  window.electronAPI.setIgnoreMouse(false);
});
windowDragHandle.addEventListener('mouseleave', () => {
  window._windowDragHandleHover = false;
});

[windowZoomIn, windowZoomOut].forEach((btn) => {
  btn.addEventListener('mouseenter', () => {
    window._windowDragHandleHover = true;
    window.electronAPI.setIgnoreMouse(false);
    if (_handleHideTimer) { clearTimeout(_handleHideTimer); _handleHideTimer = null; }
  });
  btn.addEventListener('mouseleave', () => {
    window._windowDragHandleHover = false;
    _handleHideTimer = setTimeout(() => {
      if (!_handleDragging) {
        windowDragHandle.classList.remove('visible');
        windowZoomIn.classList.remove('visible');
        windowZoomOut.classList.remove('visible');
      }
    }, 1500);
  });
});

windowDragHandle.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  _handleDragging = true;
  window._windowDragActive = true;
  if (_handleHideTimer) { clearTimeout(_handleHideTimer); _handleHideTimer = null; }
  window.electronAPI.setIgnoreMouse(false);

  let lastX = e.screenX, lastY = e.screenY;

  function onMove(ev) {
    const dx = ev.screenX - lastX;
    const dy = ev.screenY - lastY;
    lastX = ev.screenX; lastY = ev.screenY;
    window.electronAPI.windowDrag(dx, dy);
  }
  function onUp() {
    _handleDragging = false;
    window._windowDragActive = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    _handleHideTimer = setTimeout(() => {
      windowDragHandle.classList.remove('visible');
      windowZoomIn.classList.remove('visible');
      windowZoomOut.classList.remove('visible');
    }, 1500);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ========================
//  窗口缩放 (+/-)
// ========================
const WIN_SCALE_MIN = 0.6;
const WIN_SCALE_MAX = 1.8;
const WIN_SCALE_STEP = 1.1;
let windowScale = 1.0;

function updateZoomButtonsState() {
  windowZoomIn.disabled = windowScale >= WIN_SCALE_MAX - 1e-6;
  windowZoomOut.disabled = windowScale <= WIN_SCALE_MIN + 1e-6;
}

async function setWindowScale(next) {
  const clamped = Math.max(WIN_SCALE_MIN, Math.min(WIN_SCALE_MAX, next));
  if (Math.abs(clamped - windowScale) < 1e-6) {
    updateZoomButtonsState();
    return;
  }
  windowScale = clamped;
  window.electronAPI.windowResize(windowScale);
  updateZoomButtonsState();
  try {
    const config = await window.electronAPI.getConfig();
    config.window = { ...(config.window || {}), scale: windowScale };
    await window.electronAPI.saveConfig(config);
  } catch (_e) {}
}

async function loadWindowScale() {
  try {
    const config = await window.electronAPI.getConfig();
    const s = Number(config.window?.scale);
    if (isFinite(s)) windowScale = Math.max(WIN_SCALE_MIN, Math.min(WIN_SCALE_MAX, s));
  } catch (_e) {}
  updateZoomButtonsState();
}

windowZoomIn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setWindowScale(windowScale * WIN_SCALE_STEP).then(() => { showScaleLabel(); hideHandles(); });
});
windowZoomOut.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setWindowScale(windowScale / WIN_SCALE_STEP).then(() => { showScaleLabel(); hideHandles(); });
});

loadWindowScale();

// 窗口大小变化时触发 L2D 重绘（pet-controller 已监听 window.resize）
// Electron 的 setSize 会自动触发浏览器 resize 事件，这里无需额外处理

// ========================
//  气泡位置/大小
// ========================
// 存储单位：百分比（相对 ui-layer 宽高）
let bubblePos = { left: 62, top: 8, width: 36 }; // left%, top%, width%

function applyBubblePos() {
  chatBubble.style.left = bubblePos.left + '%';
  chatBubble.style.top = bubblePos.top + '%';
  chatBubble.style.width = bubblePos.width + '%';
}

async function loadBubblePos() {
  const config = await window.electronAPI.getConfig();
  if (config.bubble) {
    bubblePos = { ...bubblePos, ...config.bubble };
  }
  applyBubblePos();
}

loadBubblePos();

// 初始化时同步 ttsEnabled、showBubble、custom_image
window.electronAPI.getConfig().then(cfg => {
  ttsEnabled = (cfg.tts?.enabled !== false);
  showBubble = (cfg.ui?.show_bubble !== false);
  // 应用主题色
  const initTheme = cfg.ui?.theme_color || '#5B8CFF';
  const initThemeMode = cfg.ui?.theme_color_mode || 'solid';
  const initTheme2 = initThemeMode === 'gradient' ? (cfg.ui?.theme_color2 || initTheme) : null;
  applyTheme(initTheme, initTheme2);
  const customImg = cfg.ui?.custom_image || '';
  if (customImg) {
    // pet-controller 可能尚未初始化，延迟一帧确保 DOM 已准备好
    window._customImageUrl = customImg;
    requestAnimationFrame(() => {
      if (typeof window.setCustomImage === 'function') window.setCustomImage(customImg);
    });
  }
});

// 操作气泡文字
function setBubbleText(text) {
  bubbleContent.textContent = text;
}
function appendBubbleText(text) {
  bubbleContent.textContent += text;
  bubbleContent.scrollTop = bubbleContent.scrollHeight;
}

// ========================
//  聊天功能
// ========================
let isChatting = false;
let bubbleHideTimer = null;

// ── 逐句打字机 ──
let sentenceQueue = [];   // 已切好的完整句子
let sentenceBuf = '';      // 正在拼接的不完整句子
let typewriterTimer = null;     // 打字机定时器
let sentenceTimer = null;  // 句间停留定时器
let chatDone = false;      // 流是否已结束
let waitingForSentence = false; // 队列空，等待新句子

function resetSentenceQueue() {
  sentenceQueue = [];
  sentenceBuf = '';
  chatDone = false;
  waitingForSentence = false;
  if (typewriterTimer) { clearTimeout(typewriterTimer); typewriterTimer = null; }
  if (sentenceTimer) { clearTimeout(sentenceTimer); sentenceTimer = null; }
}

// 句子分隔符：中文句号、感叹号、问号，英文 . ! ?，换行
const SENTENCE_SEP = /([。！？!?\n])/;

function enqueueSentences() {
  const parts = sentenceBuf.split(SENTENCE_SEP);
  // parts: [text, sep, text, sep, ..., remainder]
  // 每两个元素拼成一个完整句子
  while (parts.length >= 2) {
    const text = parts.shift();
    const sep = parts.shift();
    const sentence = (text + sep).trim();
    if (sentence) sentenceQueue.push(sentence);
  }
  // 剩余不完整部分留在 buf
  sentenceBuf = parts.join('');
}

// 打字机效果显示一句话
function showNextSentence() {
  if (sentenceQueue.length === 0) {
    if (chatDone) {
      // 全部显示完毕，启动隐藏计时器
      bubbleHideTimer = setTimeout(() => {
        chatBubble.classList.remove('visible');
      }, 10000);
      return;
    }
    // 队列空但流未结束，等待
    waitingForSentence = true;
    return;
  }

  waitingForSentence = false;
  const sentence = sentenceQueue.shift();
  let charIdx = 0;
  setBubbleText('');

  // 逐字打出
  const TYPE_INTERVAL = 50; // 每字 50ms
  function typeChar() {
    if (charIdx < sentence.length) {
      bubbleContent.textContent += sentence[charIdx];
      charIdx++;
      typewriterTimer = setTimeout(typeChar, TYPE_INTERVAL);
    } else {
      typewriterTimer = null;
      // 停留一段时间后切下一句
      const stay = Math.max(1500, Math.min(5000, sentence.length * 100));
      sentenceTimer = setTimeout(() => {
        sentenceTimer = null;
        showNextSentence();
      }, stay);
    }
  }
  typeChar();
}

async function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg || isChatting || !aiActive) return;

  isChatting = true;
  sendBtn.disabled = true;
  chatInput.value = '';
  aiReplyStarted = false;
  resetSentenceQueue();

  bubbleContent.textContent = '';
  setBubbleText('你：' + msg);
  showChatBubble();
  if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }

  // 检查是否开启了对话截屏
  const config = await window.electronAPI.getConfig();
  if (config.proactive && config.proactive.chat_screenshot) {
    const result = await window.electronAPI.captureScreen();
    if (result.ok) {
      window.electronAPI.chatSendWithImage(msg, result.base64);
      return;
    }
  }

  window.electronAPI.chatSend(msg);
}

// 发送按钮 / Enter
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 截屏按钮
screenshotBtn.addEventListener('click', async () => {
  if (isChatting) return;

  isChatting = true;
  sendBtn.disabled = true;
  screenshotBtn.disabled = true;
  aiReplyStarted = false;
  resetSentenceQueue();

  bubbleContent.textContent = '';
  setBubbleText('正在截屏...');
  showChatBubble();
  if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }

  const result = await window.electronAPI.captureScreen();
  if (!result.ok) {
    setBubbleText('截屏失败: ' + result.error);
    isChatting = false;
    sendBtn.disabled = false;
    screenshotBtn.disabled = false;
    bubbleHideTimer = setTimeout(() => { chatBubble.classList.remove('visible'); }, 5000);
    return;
  }

  // 截屏成功，带上用户输入（如有）发送给 LLM
  const userMsg = chatInput.value.trim() || '请看看我的屏幕，说说你看到了什么吧~';
  chatInput.value = '';
  bubbleContent.textContent = '';

  window.electronAPI.chatSendWithImage(userMsg, result.base64);
});

// 让输入区域不触发点击穿透
const chatArea = document.getElementById('chat-area');
chatArea.addEventListener('mouseenter', () => {
  window._chatAreaHover = true;
  window.electronAPI.setIgnoreMouse(false);
});
chatArea.addEventListener('mouseleave', () => {
  window._chatAreaHover = false;
  // 不立即穿透，让 pet-controller 的 mousemove 处理
});

// LLM 回调
let aiReplyStarted = false;
window.electronAPI.onChatToken((token) => {
  if (!aiReplyStarted) {
    aiReplyStarted = true;
    bubbleContent.textContent = '';
    if (!ttsEnabled && !chatBubble.classList.contains('visible')) {
      showChatBubble();
    }
  }
  // 逐句打字机：token 进入缓冲，切分句子
  sentenceBuf += token;
  const prevLen = sentenceQueue.length;
  enqueueSentences();
  // 首句入队或等待中有新句子，启动显示
  if (sentenceQueue.length > 0 && (waitingForSentence || (!typewriterTimer && !sentenceTimer))) {
    showNextSentence();
  }
});

window.electronAPI.onChatDone((fullText) => {
  isChatting = false;
  sendBtn.disabled = false;
  screenshotBtn.disabled = false;
  // 将缓冲区剩余文字作为最后一句入队
  const last = sentenceBuf.trim();
  sentenceBuf = '';
  if (last) sentenceQueue.push(last);
  chatDone = true;
  if (waitingForSentence) {
    showNextSentence();
  }
});

window.electronAPI.onChatError((err) => {
  isChatting = false;
  sendBtn.disabled = false;
  screenshotBtn.disabled = false;
  resetSentenceQueue();
  setBubbleText('出错了: ' + err);
  showChatBubble();
  bubbleHideTimer = setTimeout(() => {
    chatBubble.classList.remove('visible');
  }, 5000);
});

// 主动交互开始：显示气泡 + 播放随机表情
window.electronAPI.onProactiveChatStart(() => {
  // 如果用户正在聊天或 AI 已关闭，忽略
  if (isChatting || !aiActive) return;

  isChatting = true;
  sendBtn.disabled = true;
  screenshotBtn.disabled = true;
  aiReplyStarted = false;
  resetSentenceQueue();

  bubbleContent.textContent = '';
  showChatBubble();
  if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }

});

// ========================
//  TTS 音频播放 + 口型同步
// ========================
let audioCtx = null;
let nextPlayTime = 0;
let analyserNode = null;
let lipSyncAnimId = null;
const SAMPLE_RATE = 24000; // 默认，与 config.tts.sample_rate 一致

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    // 创建 AnalyserNode 用于实时口型检测
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 实时口型同步：音量驱动嘴型，无排队音频且静音足够长后停止
let silentFrames = 0;
const SILENT_FRAMES_THRESHOLD = 60; // 无排队音频后~1秒静音才停
let currentLipLevel = 0; // 用于平滑过渡

function startLipSyncLoop() {
  if (lipSyncAnimId) return;
  silentFrames = 0;
  const buf = new Uint8Array(analyserNode.frequencyBinCount);

  function tick() {
    analyserNode.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const target = Math.min(1.0, rms * 6.0);
    // 平滑过渡：上升快，下降慢
    currentLipLevel += (target - currentLipLevel) * (target > currentLipLevel ? 0.2 : 0.08);

    if (typeof window.setLipSync === 'function') {
      window.setLipSync(currentLipLevel);
    }

    const hasQueuedAudio = audioCtx && nextPlayTime > audioCtx.currentTime + 0.05;

    if (rms < 0.01 && !hasQueuedAudio) {
      silentFrames++;
    } else {
      silentFrames = 0;
    }

    if (silentFrames < SILENT_FRAMES_THRESHOLD) {
      lipSyncAnimId = requestAnimationFrame(tick);
    } else {
      if (typeof window.setLipSync === 'function') window.setLipSync(0);
      lipSyncAnimId = null;
    }
  }

  lipSyncAnimId = requestAnimationFrame(tick);
}

window.electronAPI.onTtsAudio((buf) => {
  const ctx = ensureAudioCtx();
  const pcm = new Uint8Array(buf);

  // PCM Int16 → Float32
  const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  // 创建 AudioBuffer 并播放（通过 AnalyserNode 以实现实时口型检测）
  const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
  audioBuffer.getChannelData(0).set(float32);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyserNode); // 连到 analyser → destination

  const now = ctx.currentTime;
  if (nextPlayTime < now) nextPlayTime = now;
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;

  // 启动实时口型同步循环
  startLipSyncLoop();
});

window.electronAPI.onTtsEnd(() => {
  // lip sync loop 会在音频播完后自动关闭嘴巴，不在这里重置 nextPlayTime
  // 否则 nextPlayTime=0 会导致 loop 提前停止，后半段音频无嘴型
});

// MP3 / WAV 编码音频（OpenAI / Edge / CosyVoice）
window.electronAPI.onTtsAudioEncoded((buf) => {
  const ctx = ensureAudioCtx();
  const arrayBuffer = new Uint8Array(buf).buffer;
  ctx.decodeAudioData(arrayBuffer, (audioBuffer) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyserNode);

    const now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;

    startLipSyncLoop();
  }, (err) => {
    console.warn('[TTS] decodeAudioData failed:', err);
  });
});

// ========================
//  设置面板
// ========================

// ========================
//  自定义确认弹窗
// ========================
function showConfirm(msg) {
  return new Promise((resolve) => {
    const mask = document.getElementById('custom-confirm-mask');
    const msgEl = document.getElementById('custom-confirm-msg');
    // 用 cloneNode 替换按钮，彻底清除所有旧监听器
    const oldOk = document.getElementById('custom-confirm-ok');
    const oldCancel = document.getElementById('custom-confirm-cancel');
    const okBtn = oldOk.cloneNode(true);
    const cancelBtn = oldCancel.cloneNode(true);
    oldOk.parentNode.replaceChild(okBtn, oldOk);
    oldCancel.parentNode.replaceChild(cancelBtn, oldCancel);
    msgEl.textContent = msg;
    mask.classList.add('visible');
    function cleanup(result) {
      mask.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ========================
//  设置窗口（独立子窗口）
// ========================
settingsBtn.addEventListener('click', () => {
  window.electronAPI.openSettingsWindow();
});

// 设置窗口保存后，主窗口收到通知，同步更新 UI 状态
window.electronAPI.onConfigUpdated((config) => {
  const ui = config.ui || {};
  showBubble = ui.show_bubble !== false;
  ttsEnabled = (config.tts || {}).enabled !== false;
  if (!showBubble) chatBubble.classList.remove('visible');
  applyFontSize(ui.font_size || 13);
  applyBarSize(ui.bar_size || 28);
  applyTheme(ui.theme_color || '#5B8CFF',
    ui.theme_color_mode === 'gradient' ? (ui.theme_color2 || ui.theme_color || '#5B8CFF') : null);
  // 角色图片同步
  if (ui.custom_image) {
    if (typeof window.setCustomImage === 'function') window.setCustomImage(ui.custom_image);
  } else {
    if (typeof window.clearCustomImage === 'function') window.clearCustomImage();
  }
  // 摄像头开关同步
  syncCameraStream(config.camera?.enabled, config.camera?.device_id);
});

// ========================
//  摄像头采集（隐藏 video，响应主进程截图请求）
// ========================
let _cameraStream = null;
let _cameraVideo = null;

async function syncCameraStream(enabled, deviceId) {
  if (!enabled) {
    if (_cameraStream) {
      _cameraStream.getTracks().forEach(t => t.stop());
      _cameraStream = null;
    }
    return;
  }
  // 已有相同设备的流则复用
  const currentDeviceId = _cameraStream?.getVideoTracks()[0]?.getSettings()?.deviceId;
  if (_cameraStream && (!deviceId || currentDeviceId === deviceId)) return;
  // 切换设备
  if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; }
  try {
    const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true };
    _cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!_cameraVideo) {
      _cameraVideo = document.createElement('video');
      _cameraVideo.autoplay = true;
      _cameraVideo.playsInline = true;
      _cameraVideo.muted = true;
      _cameraVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(_cameraVideo);
    }
    _cameraVideo.srcObject = _cameraStream;
  } catch (err) {
    console.warn('[Camera] 打开摄像头失败:', err.message);
    _cameraStream = null;
  }
}

// 响应主进程的截图请求
window.electronAPI.onRequestCameraFrame(() => {
  if (!_cameraStream || !_cameraVideo || _cameraVideo.readyState < 2) {
    window.electronAPI.captureCamera(null);
    return;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = _cameraVideo.videoWidth  || 640;
    canvas.height = _cameraVideo.videoHeight || 480;
    canvas.getContext('2d').drawImage(_cameraVideo, 0, 0, canvas.width, canvas.height);
    // 去掉 data:image/jpeg;base64, 前缀
    const b64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    window.electronAPI.captureCamera(b64);
  } catch (err) {
    console.warn('[Camera] 截图失败:', err.message);
    window.electronAPI.captureCamera(null);
  }
});

// 初始化时同步摄像头状态
window.electronAPI.getConfig().then(cfg => {
  if (cfg.camera?.enabled) syncCameraStream(true, cfg.camera?.device_id);
});

// 设置窗口拖滑块时实时预览气泡位置
let _bubblePreviewTimer = null;
window.electronAPI.onBubblePreview((pos) => {
  if (pos.left  !== undefined) bubblePos.left  = pos.left;
  if (pos.top   !== undefined) bubblePos.top   = pos.top;
  if (pos.width !== undefined) bubblePos.width = pos.width;
  applyBubblePos();
  setBubbleText('气泡预览 ~ 拖动滑块调整位置');
  showChatBubble();
  if (_bubblePreviewTimer) clearTimeout(_bubblePreviewTimer);
  _bubblePreviewTimer = setTimeout(() => {
    chatBubble.classList.remove('visible');
  }, 2000);
});

// 设置窗口通知切换图片/恢复 Live2D
window.electronAPI.onSetCustomImage((url) => {
  if (typeof window.setCustomImage === 'function') window.setCustomImage(url);
});
window.electronAPI.onClearCustomImage(() => {
  if (typeof window.clearCustomImage === 'function') window.clearCustomImage();
});

// 角色切换通知：更新图片、清空气泡
window.electronAPI.onProfileSwitched((profile) => {
  // 切换角色图片
  if (profile.custom_image) {
    if (typeof window.setCustomImage === 'function') window.setCustomImage(profile.custom_image);
  } else {
    if (typeof window.clearCustomImage === 'function') window.clearCustomImage();
  }
  // 清空聊天气泡
  bubbleContent.textContent = '';
  chatBubble.classList.remove('visible');
});


function applyFontSize(size) {
  document.documentElement.style.setProperty('--fs', size + 'px');
}

function applyBarSize(size) {
  document.documentElement.style.setProperty('--bar', size + 'px');
}

// 根据主色（+ 可选副色）自动推算衍生色并应用
function applyTheme(hex1, hex2) {
  if (!hex1 || !/^#[0-9a-fA-F]{6}$/.test(hex1)) return;
  // hex2 缺省或无效时，退化为单色
  const useGradient = hex2 && /^#[0-9a-fA-F]{6}$/.test(hex2) && hex2.toLowerCase() !== hex1.toLowerCase();
  const r = parseInt(hex1.slice(1,3), 16);
  const g = parseInt(hex1.slice(3,5), 16);
  const b = parseInt(hex1.slice(5,7), 16);
  // 浅色：主色混白 50%
  const lr = Math.round(r * 0.5 + 255 * 0.5);
  const lg = Math.round(g * 0.5 + 255 * 0.5);
  const lb = Math.round(b * 0.5 + 255 * 0.5);
  const themeLight = `rgb(${lr},${lg},${lb})`;
  // 背景色：主色混白 88%
  const br2 = Math.round(r * 0.12 + 255 * 0.88);
  const bg2 = Math.round(g * 0.12 + 255 * 0.88);
  const bb2 = Math.round(b * 0.12 + 255 * 0.88);
  const themeBg = `rgb(${br2},${bg2},${bb2})`;
  // 深色：主色降亮 18%
  const dr = Math.round(r * 0.82);
  const dg = Math.round(g * 0.82);
  const db = Math.round(b * 0.82);
  const themeDark = `rgb(${dr},${dg},${db})`;

  const gradient = useGradient
    ? `linear-gradient(135deg, ${hex1}, ${hex2})`
    : `linear-gradient(135deg, ${hex1}, ${hex1})`;

  const root = document.documentElement;
  root.style.setProperty('--theme', hex1);
  root.style.setProperty('--theme2', useGradient ? hex2 : hex1);
  root.style.setProperty('--theme-gradient', gradient);
  root.style.setProperty('--theme-light', themeLight);
  root.style.setProperty('--theme-bg', themeBg);
  root.style.setProperty('--theme-dark', themeDark);
  root.style.setProperty('--theme-shadow', `rgba(${r},${g},${b},0.4)`);

  root.style.setProperty('--theme-shadow-soft', `rgba(${r},${g},${b},0.18)`);
}


// ========================
//  AI 交互开关
// ========================
const aiToggleBtn = document.getElementById('ai-toggle-btn');
let aiActive = true; // 默认开启

function setAiActive(active) {
  aiActive = active;
  if (active) {
    aiToggleBtn.classList.remove('ai-off');
    aiToggleBtn.title = '关闭 AI 交互';
    chatInput.disabled = false;
    sendBtn.disabled = false;
    screenshotBtn.disabled = false;
  } else {
    aiToggleBtn.classList.add('ai-off');
    aiToggleBtn.title = '开启 AI 交互';
    chatInput.disabled = true;
    sendBtn.disabled = true;
    screenshotBtn.disabled = true;
    chatBubble.classList.remove('visible');
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
  }
  window.electronAPI.aiToggle(active);
}

aiToggleBtn.addEventListener('click', () => {
  setAiActive(!aiActive);
});
