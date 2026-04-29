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

const { app, BrowserWindow, ipcMain, Menu, Tray, screen, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 修复 Windows 控制台中文乱码
if (process.platform === 'win32') {
  process.stdout.reconfigure?.({ encoding: 'utf8' });
  process.stderr.reconfigure?.({ encoding: 'utf8' });
}

// GPU 兼容性：忽略 GPU 驱动黑名单，允许在更多机器上启用 WebGL
// 不完全禁用 GPU（否则 Live2D WebGL 无法渲染）
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
const { chatStream, callOnce } = require('./services/llm-service');
const memoryService = require('./services/memory-service');
const { TTSService } = require('./services/tts-service');

let mainWindow = null;
let tray = null;
let ttsService = null;
let proactiveTimer = null;
let debugWindow = null;
let settingsWindow = null;

/**
 * 判断 TTS 配置是否足够启动，根据 provider 检查不同的必填字段
 */
function isTtsConfigured(ttsConfig) {
  const provider = (ttsConfig.provider || 'volcengine').toLowerCase();
  switch (provider) {
    case 'volcengine':
      return !!(ttsConfig.app_id && ttsConfig.access_token);
    case 'openai':
      return !!(ttsConfig.api_key);
    case 'edge':
      return true; // 无需任何 Key
    case 'cosyvoice':
      return !!(ttsConfig.api_base);
    default:
      return !!(ttsConfig.app_id && ttsConfig.access_token);
  }
}

const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 800;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.8;

// ========================
//  数据目录：打包后用 userData，开发时用 __dirname
// ========================
function getDataDir() {
  // app.getPath 在 app ready 前也可调用
  try {
    return app.getPath('userData');
  } catch (_e) {
    return __dirname;
  }
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

// ========================
//  角色配置（Profile）管理
// ========================
function getProfilesDir() {
  return path.join(getDataDir(), 'profiles');
}

function getProfileDir(id) {
  return path.join(getProfilesDir(), id);
}

function loadProfile(id) {
  try {
    const p = path.join(getProfileDir(id), 'profile.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_e) {
    return { name: id, system_prompt: '', proactive_system_prompt: '', decision_prompt: '', custom_image: '' };
  }
}

function saveProfile(id, data) {
  const dir = getProfileDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(data, null, 2), 'utf-8');
}

function listProfiles() {
  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const profile = loadProfile(d.name);
      return { id: d.name, name: profile.name || d.name };
    });
}

function createProfile(data) {
  // 生成 id：用时间戳保证唯一
  const id = 'profile-' + Date.now();
  const profile = {
    name: data.name || '新角色',
    system_prompt: data.system_prompt || '',
    proactive_system_prompt: data.proactive_system_prompt || '',
    decision_prompt: data.decision_prompt || '',
    custom_image: data.custom_image || '',
  };
  const dir = getProfileDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
  // 创建空记忆文件
  fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify({
    summary: '', facts: [], pendingHistory: [], lastSummaryAt: 0, totalRounds: 0
  }, null, 2), 'utf-8');
  return { id, name: profile.name };
}

function deleteProfile(id) {
  const config = loadConfig();
  if ((config.activeProfile || 'default') === id) {
    return { ok: false, error: '不能删除当前激活的角色' };
  }
  if (id === 'default') {
    return { ok: false, error: '不能删除默认角色' };
  }
  const dir = getProfileDir(id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { ok: true };
}

function switchProfile(id) {
  const dir = getProfileDir(id);
  if (!fs.existsSync(dir)) {
    return { ok: false, error: '角色不存在' };
  }
  // 保存当前记忆
  memoryService.save();
  // 更新配置中的 activeProfile
  const config = loadConfig();
  config.activeProfile = id;
  saveConfigFile(config);
  // 切换记忆目录
  memoryService.setDataDir(dir);
  memoryService.reload();
  // 加载新 profile 数据
  const profile = loadProfile(id);
  // 通知渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('profile-switched', profile);
  }
  return { ok: true, profile };
}

/**
 * 从当前激活的 profile 读取提示词
 */
function getActivePrompts() {
  const config = loadConfig();
  const profileId = config.activeProfile || 'default';
  const profile = loadProfile(profileId);
  return {
    system_prompt: profile.system_prompt || config.llm?.system_prompt || '',
    proactive_system_prompt: profile.proactive_system_prompt || config.proactive?.system_prompt || '',
    decision_prompt: profile.decision_prompt || config.proactive?.decision_prompt || '',
  };
}

/**
 * 首次启动迁移：将现有配置迁移到 profiles/default
 */
function ensureProfiles() {
  const profilesDir = getProfilesDir();
  const defaultDir = path.join(profilesDir, 'default');
  if (fs.existsSync(defaultDir)) return; // 已迁移过

  fs.mkdirSync(defaultDir, { recursive: true });
  const config = loadConfig();

  // 提取提示词到 profile
  const profile = {
    name: '默认角色',
    system_prompt: config.llm?.system_prompt || '',
    proactive_system_prompt: config.proactive?.system_prompt || '',
    decision_prompt: config.proactive?.decision_prompt || '',
    custom_image: config.ui?.custom_image || '',
  };
  fs.writeFileSync(path.join(defaultDir, 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8');

  // 复制记忆文件
  const memSrc = path.join(getDataDir(), 'memory.json');
  const memDst = path.join(defaultDir, 'memory.json');
  if (fs.existsSync(memSrc)) {
    fs.copyFileSync(memSrc, memDst);
  } else {
    fs.writeFileSync(memDst, JSON.stringify({
      summary: '', facts: [], pendingHistory: [], lastSummaryAt: 0, totalRounds: 0
    }, null, 2), 'utf-8');
  }

  // 写入 activeProfile
  config.activeProfile = 'default';
  saveConfigFile(config);
  console.log('[Profile] 首次迁移完成，已创建默认角色配置');
}

/** 首次启动时，把项目内示例配置复制到 userData/config.json */
function ensureConfigFile() {
  const dest = getConfigPath();
  if (!fs.existsSync(dest)) {
    const candidates = [
      path.join(__dirname, 'config.json'),
      path.join(__dirname, 'config.example.json'),
    ];
    const src = candidates.find(p => fs.existsSync(p));
    if (src) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`[Config] 首次启动，已复制默认配置到 ${dest}`);
    }
  }
}

function clampScale(s) {
  const n = Number(s);
  if (!isFinite(n)) return 1.0;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
}

// ========================
//  配置读写
// ========================
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
  } catch (_e) {
    return { llm: {}, tts: {} };
  }
}

function saveConfigFile(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// ========================
//  应用启动
// ========================
app.whenReady().then(() => {
  ensureConfigFile();
  ensureProfiles();
  const config = loadConfig();
  const profileId = config.activeProfile || 'default';
  const profileDir = getProfileDir(profileId);
  memoryService.setDataDir(profileDir);
  memoryService.setMemoryConfig(config.memory?.context_rounds ?? 10);
  createWindow();
  createTray();
  startProactiveTimer();
});

function createWindow() {
  const config = loadConfig();
  const scale = clampScale(config.window?.scale ?? 1.0);
  const baseW = config.window?.baseWidth  || DEFAULT_WIDTH;
  const baseH = config.window?.baseHeight || DEFAULT_HEIGHT;
  const w = Math.round(baseW * scale);
  const h = Math.round(baseH * scale);

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    useContentSize: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(screenW - w - 20, screenH - h - 20);
  // macOS 上使用更高窗口层级，确保置顶于其他应用
  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (ttsService) { ttsService.close(); ttsService = null; }
  });
}

// ========================
//  IPC: 桌宠基础（点击穿透、拖拽、右键菜单）
// ========================

ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (mainWindow) mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('window-drag', (_event, deltaX, deltaY) => {
  if (mainWindow) {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
  }
});

ipcMain.on('window-resize', (_event, scale) => {
  if (!mainWindow) return;
  const s = clampScale(scale);
  const config = loadConfig();
  // 以保存的基准尺寸为基准，fallback 到默认尺寸
  const baseW = config.window?.baseWidth  || DEFAULT_WIDTH;
  const baseH = config.window?.baseHeight || DEFAULT_HEIGHT;
  const w = Math.round(baseW * s);
  const h = Math.round(baseH * s);
  mainWindow.setResizable(true);
  mainWindow.setContentSize(w, h);
  mainWindow.setResizable(false);
  if (!config.window) config.window = {};
  config.window.scale = s;
  saveConfigFile(config);
});

// 根据内容（图片或 Live2D）自适应窗口大小，并保存为新的基准尺寸
ipcMain.handle('resize-to-content', (_event, contentWidth, contentHeight) => {
  if (!mainWindow) return { ok: false };
  try {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

    // 最小 / 最大限制
    const MIN_W = 280, MIN_H = 360;
    const MAX_W = Math.min(700, Math.round(screenW * 0.55));
    const MAX_H = Math.min(900, Math.round(screenH * 0.80));

    let targetW, targetH;

    if (contentWidth > 0 && contentHeight > 0) {
      // 等比缩放：先按最大宽度算，再按最大高度校正
      const ratio = contentWidth / contentHeight;
      targetW = Math.round(Math.min(MAX_W, contentWidth));
      targetH = Math.round(targetW / ratio);
      if (targetH > MAX_H) {
        targetH = MAX_H;
        targetW = Math.round(targetH * ratio);
      }
      // 最小保障
      if (targetW < MIN_W) { targetW = MIN_W; targetH = Math.round(targetW / ratio); }
      if (targetH < MIN_H) { targetH = MIN_H; targetW = Math.round(targetH * ratio); }
    } else {
      // 无尺寸信息（Live2D 恢复），回到默认
      targetW = DEFAULT_WIDTH;
      targetH = DEFAULT_HEIGHT;
    }

    // 保存新基准，scale 重置为 1.0
    const config = loadConfig();
    if (!config.window) config.window = {};
    config.window.baseWidth  = targetW;
    config.window.baseHeight = targetH;
    config.window.scale = 1.0;
    saveConfigFile(config);

    // 调整窗口大小，保持右下角位置不变
    const [oldX, oldY] = mainWindow.getPosition();
    const [oldW, oldH] = mainWindow.getContentSize();
    const newX = oldX + (oldW - targetW);
    const newY = oldY + (oldH - targetH);
    mainWindow.setResizable(true);
    mainWindow.setContentSize(targetW, targetH);
    mainWindow.setResizable(false);
    mainWindow.setPosition(Math.max(0, newX), Math.max(0, newY));

    return { ok: true, width: targetW, height: targetH };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('show-context-menu', (event) => {
  const template = [
    {
      label: '表情',
      submenu: [
        { label: '脸红', click: () => event.sender.send('play-expression', 'lianhong') },
        { label: '哭哭', click: () => event.sender.send('play-expression', 'kuku') },
        { label: '黑脸', click: () => event.sender.send('play-expression', 'heilian') },
        { label: '摸头', click: () => event.sender.send('play-expression', 'head pat') },
        { label: '闭眼', click: () => event.sender.send('play-expression', 'miyan') },
        { label: 'OO',   click: () => event.sender.send('play-expression', 'OO') },
        { label: '撒娇', click: () => event.sender.send('play-expression', 'SAJIAO') },
        { type: 'separator' },
        { label: '重置表情', click: () => event.sender.send('reset-expression') },
      ],
    },
    {
      label: '动作',
      submenu: [
        { label: '摸头', click: () => event.sender.send('play-motion', 0, 'head pat') },
        { label: '哭泣', click: () => event.sender.send('play-motion', 1, 'cry') },
        { label: '转圈', click: () => event.sender.send('play-motion', 2, 'roll') },
        { label: '晕',   click: () => event.sender.send('play-motion', 3, 'yun') },
        { type: 'separator' },
        { label: '停止动作', click: () => event.sender.send('stop-motion') },
      ],
    },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: mainWindow ? mainWindow.isAlwaysOnTop() : true,
      click: (item) => {
        if (!mainWindow) return;
        if (process.platform === 'darwin') {
          mainWindow.setAlwaysOnTop(item.checked, 'screen-saver');
        } else {
          mainWindow.setAlwaysOnTop(item.checked);
        }
      },
    },
    {
      label: '重置位置',
      click: () => {
        if (!mainWindow) return;
        const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
        const [ww, wh] = mainWindow.getContentSize();
        mainWindow.setPosition(sw - ww - 20, sh - wh - 20);
      },
    },
    { type: 'separator' },
    { label: '调试窗口', click: () => openDebugWindow() },
    { label: '退出', click: () => app.quit() },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});

// ========================
//  IPC: 配置
// ========================

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (_event, config) => {
  try {
    // 保留 activeProfile 字段
    const existing = loadConfig();
    if (existing.activeProfile) config.activeProfile = existing.activeProfile;
    saveConfigFile(config);
    // 同步记忆参数
    memoryService.setMemoryConfig(config.memory?.context_rounds ?? 10);
    // 重连 TTS（配置可能变了）
    if (ttsService) { ttsService.close(); ttsService = null; }
    // 重启主动交互定时器
    startProactiveTimer();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ========================
//  IPC: 角色配置（Profile）
// ========================

ipcMain.handle('profile-list', () => listProfiles());

ipcMain.handle('profile-get', (_event, id) => loadProfile(id));

ipcMain.handle('profile-get-active', () => {
  const config = loadConfig();
  const id = config.activeProfile || 'default';
  return { id, profile: loadProfile(id) };
});

ipcMain.handle('profile-save', (_event, id, data) => {
  try {
    saveProfile(id, data);
    // 如果保存的是当前激活的 profile，通知渲染进程
    const config = loadConfig();
    if ((config.activeProfile || 'default') === id && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profile-switched', data);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('profile-create', (_event, data) => {
  try {
    return { ok: true, ...createProfile(data) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('profile-delete', (_event, id) => {
  return deleteProfile(id);
});

ipcMain.handle('profile-switch', (_event, id) => {
  return switchProfile(id);
});

// ========================
//  IPC: 截屏
// ========================

ipcMain.handle('capture-screen', async () => {
  try {
    const base64 = await captureScreenBase64();
    if (!base64) return { ok: false, error: '无法获取屏幕源' };
    return { ok: true, base64 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ========================
//  IPC: 聊天（LLM + TTS）
// ========================

let chatAbortController = null;

async function handleChat(event, message, imageBase64, extraImages) {
  const config = loadConfig();

  // 中断上一次请求
  if (chatAbortController) {
    try { chatAbortController.abort(); } catch (_e) {}
  }
  chatAbortController = new AbortController();

  const sender = event.sender;

  // 句子缓冲，用于 TTS 按句喂入
  let sentenceBuf = '';
  const sentenceDelimiters = /([。！？!?\n])/;

  // 初始化 TTS
  let ttsRoundId = null;
  const ttsConfig = config.tts || {};
  const hasTtsConfig = ttsConfig.enabled !== false && isTtsConfigured(ttsConfig);

  if (hasTtsConfig) {
    try {
      if (!ttsService) ttsService = new TTSService();
      await ttsService.connect(ttsConfig);
      const ttsProvider = (ttsConfig.provider || 'volcengine').toLowerCase();
      const ttsAudioEvent = ttsProvider === 'volcengine' ? 'tts-audio' : 'tts-audio-encoded';
      ttsRoundId = ttsService.start(
        // onAudio: 发送 PCM 或编码音频给渲染进程
        (roundId, audioBuffer) => {
          if (!sender.isDestroyed()) {
            sender.send(ttsAudioEvent, Buffer.from(audioBuffer));
          }
        },
        // onEnd
        (roundId) => {
          if (!sender.isDestroyed()) {
            sender.send('tts-end');
          }
        }
      );
    } catch (err) {
      console.error('[TTS] connect failed:', err.message);
    }
  }

  // 调用 LLM（使用 active profile 的系统提示词）
  const prompts = getActivePrompts();
  const llmConfigWithProfile = { ...config.llm, system_prompt: prompts.system_prompt };
  chatStream(
    message,
    llmConfigWithProfile,
    // onToken
    (token) => {
      if (!sender.isDestroyed()) {
        sender.send('chat-token', token);
      }
      // 喂给 TTS
      if (ttsRoundId !== null && ttsService) {
        sentenceBuf += token;
        const parts = sentenceBuf.split(sentenceDelimiters);
        if (parts.length >= 3) {
          let toSend = '';
          let remaining = '';
          for (let i = 0; i < parts.length; i++) {
            if (i < parts.length - 1) {
              toSend += parts[i];
            } else {
              remaining = parts[i];
            }
          }
          if (toSend) ttsService.sendText(toSend);
          sentenceBuf = remaining;
        }
      }
    },
    // onDone
    (fullText) => {
      chatAbortController = null;
      if (!sender.isDestroyed()) {
        sender.send('chat-done', fullText);
      }
      if (ttsRoundId !== null && ttsService) {
        if (sentenceBuf) ttsService.sendText(sentenceBuf);
        sentenceBuf = '';
        ttsService.finish();
      }
    },
    // onError
    (err) => {
      chatAbortController = null;
      if (!sender.isDestroyed()) {
        sender.send('chat-error', err.message);
      }
    },
    // imageBase64
    imageBase64 || null,
    // onDebugPrompt
    (data) => sendDebugPrompt(data),
    // extraImages（摄像头等）
    extraImages || []
  );
}

ipcMain.on('chat-send', async (event, message) => {
  startProactiveTimer();
  const config = loadConfig();
  let cameraBase64 = null;
  if (config.camera?.enabled && config.camera?.on_chat) {
    cameraBase64 = await captureCameraBase64();
  }
  handleChat(event, message, null, cameraBase64 ? [cameraBase64] : []);
});

ipcMain.on('chat-send-with-image', async (event, message, imageBase64) => {
  startProactiveTimer();
  const config = loadConfig();
  let cameraBase64 = null;
  if (config.camera?.enabled && config.camera?.on_chat) {
    cameraBase64 = await captureCameraBase64();
  }
  handleChat(event, message, imageBase64, cameraBase64 ? [cameraBase64] : []);
});

ipcMain.on('quit-app', () => app.quit());

// AI 交互总开关：关闭时停止主动交互定时器，开启时重新启动
ipcMain.on('ai-toggle', (_event, enabled) => {
  if (enabled) {
    console.log('[AI] 交互已开启');
    startProactiveTimer();
  } else {
    console.log('[AI] 交互已关闭');
    stopProactiveTimer();
    // 中止当前正在进行的 LLM 请求
    if (chatAbortController) {
      try { chatAbortController.abort(); } catch (_e) {}
      chatAbortController = null;
    }
    // 关闭 TTS
    if (ttsService) { ttsService.close(); ttsService = null; }
  }
});

// ========================
//  主动交互：定时截屏 + LLM
// ========================

const DEFAULT_PROACTIVE_PROMPT = '你是小玄，一个桌面宠物。你刚刚偷看了用户的屏幕，请根据屏幕内容像朋友一样主动发起一句简短互动（1-2句话）。语气可爱、自然、口语化。不要说"我看到你的屏幕"这种话，直接评论内容或关心用户。';

async function captureScreenBase64() {
  if (!mainWindow) return null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources || sources.length === 0) return null;
    return sources[0].thumbnail.toJPEG(80).toString('base64');
  } catch (_err) {
    return null;
  }
}

// 向渲染进程请求摄像头截图，超时 2s 返回 null
function captureCameraBase64() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve(null);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ipcMain.removeListener('camera-frame', handler); resolve(null); }
    }, 2000);
    function handler(_event, base64) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener('camera-frame', handler);
        resolve(base64 || null);
      }
    }
    ipcMain.once('camera-frame', handler);
    mainWindow.webContents.send('request-camera-frame');
  });
}

// 上次主动交互时间（毫秒时间戳）
let isProactiveChatting = false;
let lastProactiveAt = 0;

async function doProactiveInteraction() {
  if (!mainWindow || isProactiveChatting || chatAbortController) {
    console.log(`[Proactive] 跳过触发: mainWindow=${!!mainWindow}, isProactiveChatting=${isProactiveChatting}, chatAbortController=${!!chatAbortController}`);
    return;
  }

  console.log('[Proactive] 定时触发，开始截屏...');
  const config = loadConfig();
  const base64 = await captureScreenBase64();
  if (!base64) {
    console.warn('[Proactive] 截屏失败，跳过本次');
    return;
  }
  // 截屏成功后立即锁定，防止决策期间下一次定时并发触发
  isProactiveChatting = true;

  // 若开启摄像头且开启主动交互附带，同步采集一帧
  let cameraBase64 = null;
  if (config.camera?.enabled && config.camera?.on_proactive !== false) {
    cameraBase64 = await captureCameraBase64();
    if (cameraBase64) console.log('[Proactive] 摄像头截图成功');
    else console.log('[Proactive] 摄像头截图失败或超时，跳过');
  }
  console.log('[Proactive] 截屏成功，发起决策...');

  // ── Step 1: function call 决策 ──────────────────────────
  {
    const minutesSinceLast = lastProactiveAt
      ? Math.floor((Date.now() - lastProactiveAt) / 60000)
      : null;
    const sinceStr = minutesSinceLast !== null
      ? `距上次主动交互已过 ${minutesSinceLast} 分钟。`
      : '这是今天第一次主动检测。';

    const activePrompts = getActivePrompts();
    const rawDecisionPrompt = activePrompts.decision_prompt
      || config.proactive?.decision_prompt
      || '请观察用户当前屏幕状态。${sinceStr}\n判断：现在是否适合桌宠主动发起互动？\n如果用户在专注工作/开会/看视频/游戏，可以不打扰；如果用户在闲逛/发呆/做轻松任务，适合互动。';
    const decisionPromptText = rawDecisionPrompt.replace('${sinceStr}', sinceStr);

    const decisionMessages = [
      {
        role: 'system',
        content: '你是一个判断助手，根据用户当前屏幕和上下文，决定桌宠是否应该主动打招呼。',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          ...(cameraBase64 ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cameraBase64}` } }] : []),
          { type: 'text', text: decisionPromptText },
        ],
      },
    ];

    const DECISION_TOOL = [{
      type: 'function',
      function: {
        name: 'decide_interaction',
        description: '决定是否主动和用户互动',
        parameters: {
          type: 'object',
          properties: {
            should_interact: { type: 'boolean', description: '是否进行主动互动' },
            reason: { type: 'string', description: '判断理由（一句话）' },
          },
          required: ['should_interact', 'reason'],
        },
      },
    }];

    try {
      const decision = await callOnce(decisionMessages, config.llm, DECISION_TOOL);
      const args = decision.toolCall?.args;
      if (args) {
        console.log(`[Proactive] 决策结果: should_interact=${args.should_interact} | 理由: ${args.reason}`);
      } else {
        console.warn('[Proactive] 决策未返回 toolCall，直接互动');
      }
      if (!args?.should_interact) {
        console.log('[Proactive] 本次不互动，结束。');
        isProactiveChatting = false;
        return;
      }
    } catch (err) {
      console.warn('[Proactive] 决策调用失败，fallback 直接互动:', err.message);
    }
  }

  // ── Step 2: 正式互动 ────────────────────────────────────
  console.log('[Proactive] 决策通过，开始正式互动...');
  lastProactiveAt = Date.now();
  const sender = mainWindow.webContents;
  if (sender.isDestroyed()) { isProactiveChatting = false; return; }

  sender.send('proactive-chat-start');

  let sentenceBuf = '';
  const sentenceDelimiters = /([。！？!?\n])/;

  const ttsConfig = config.tts || {};
  const hasTtsConfig = ttsConfig.enabled !== false && isTtsConfigured(ttsConfig);
  let ttsRoundId = null;

  if (hasTtsConfig) {
    try {
      if (!ttsService) ttsService = new TTSService();
      await ttsService.connect(ttsConfig);
      const ttsProvider2 = (ttsConfig.provider || 'volcengine').toLowerCase();
      const ttsAudioEvent2 = ttsProvider2 === 'volcengine' ? 'tts-audio' : 'tts-audio-encoded';
      ttsRoundId = ttsService.start(
        (roundId, audioBuffer) => {
          if (!sender.isDestroyed()) sender.send(ttsAudioEvent2, Buffer.from(audioBuffer));
        },
        (roundId) => {
          if (!sender.isDestroyed()) sender.send('tts-end');
        }
      );
    } catch (err) {
      console.error('[Proactive] TTS connect failed:', err.message);
    }
  }

  const activePrompts = getActivePrompts();
  const proactivePrompt = activePrompts.proactive_system_prompt
    || (config.proactive && config.proactive.system_prompt)
    || DEFAULT_PROACTIVE_PROMPT;
  const llmConfig = { ...config.llm, system_prompt: proactivePrompt };

  chatStream(
    '请看看我的屏幕，主动和我互动吧',
    llmConfig,
    (token) => {
      if (!sender.isDestroyed()) sender.send('chat-token', token);
      if (ttsRoundId !== null && ttsService) {
        sentenceBuf += token;
        const parts = sentenceBuf.split(sentenceDelimiters);
        if (parts.length >= 3) {
          let toSend = '';
          let remaining = '';
          for (let i = 0; i < parts.length; i++) {
            if (i < parts.length - 1) toSend += parts[i];
            else remaining = parts[i];
          }
          if (toSend) ttsService.sendText(toSend);
          sentenceBuf = remaining;
        }
      }
    },
    (fullText) => {
      console.log(`[Proactive] 互动完成，回复: ${fullText.slice(0, 60)}${fullText.length > 60 ? '...' : ''}`);
      if (!sender.isDestroyed()) sender.send('chat-done', fullText);
      if (ttsRoundId !== null && ttsService) {
        if (sentenceBuf) ttsService.sendText(sentenceBuf);
        sentenceBuf = '';
        ttsService.finish();
      }
      isProactiveChatting = false;
    },
    (err) => {
      console.error('[Proactive] LLM 调用出错:', err.message);
      if (!sender.isDestroyed()) sender.send('chat-error', err.message);
      isProactiveChatting = false;
    },
    base64,
    (data) => sendDebugPrompt(data),
    cameraBase64 ? [cameraBase64] : []
  );
}

function scheduleNextProactive() {
  const config = loadConfig();
  const proactive = config.proactive || {};
  if (!proactive.enabled) return;

  const rawMin = Math.max(10, parseInt(proactive.interval_min_seconds) || proactive.interval_seconds || 60);
  const rawMax = Math.max(10, parseInt(proactive.interval_max_seconds) || rawMin);
  const minSec = Math.min(rawMin, rawMax);
  const maxSec = Math.max(rawMin, rawMax);
  const seconds = minSec === maxSec
    ? minSec
    : Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
  const ms = seconds * 1000;
  console.log(`[Proactive] 下次触发将在 ${seconds}s 后（区间 ${minSec}s ~ ${maxSec}s）`);
  proactiveTimer = setTimeout(async () => {
    await doProactiveInteraction();
    scheduleNextProactive();
  }, ms);
}

function startProactiveTimer() {
  stopProactiveTimer();
  const config = loadConfig();
  const proactive = config.proactive || {};
  if (!proactive.enabled) {
    console.log('[Proactive] 已禁用，不启动计时器');
    return;
  }
  console.log('[Proactive] 计时器已启动（随机区间模式）');
  scheduleNextProactive();
}

function stopProactiveTimer() {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
    console.log('[Proactive] 计时器已停止');
  }
}

// ========================
//  系统托盘
// ========================
function createTray() {
  // macOS 使用 PNG 图标，Windows 使用 ICO
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, 'icon', 'logo.png')
    : path.join(__dirname, 'build', 'icon.ico');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('OpenDesktopPet');
    tray.on('click', () => { if (mainWindow) mainWindow.show(); });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示', click: () => mainWindow?.show() },
      { label: '退出', click: () => app.quit() },
    ]));
  } catch (_e) {}
}

// ========================
//  调试窗口
// ========================

function openDebugWindow() {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.focus();
    return;
  }
  debugWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    title: '提示词调试器',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  debugWindow.loadFile(path.join(__dirname, 'renderer', 'debug.html'));
  debugWindow.on('closed', () => { debugWindow = null; });
}

function sendDebugPrompt(data) {
  if (!debugWindow || debugWindow.isDestroyed()) return;
  debugWindow.webContents.send('debug-prompt', data);
}

// ========================
//  设置窗口
// ========================

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    title: '设置 - OpenDesktopPet',
    backgroundColor: '#ffffff',
    frame: false,          // 自定义标题栏
    resizable: true,
    alwaysOnTop: true,     // 确保显示在主窗口上方
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

ipcMain.on('open-settings-window', () => {
  openSettingsWindow();
});

// 设置窗口保存配置后，通知主窗口刷新 UI，同时保存提示词到当前 profile
ipcMain.on('notify-config-saved', (_event, config) => {
  const activeId = config.activeProfile || loadConfig().activeProfile || 'default';
  const profile = loadProfile(activeId);
  profile.system_prompt = config.llm?.system_prompt || '';
  profile.proactive_system_prompt = config.proactive?.system_prompt || '';
  profile.decision_prompt = config.proactive?.decision_prompt || '';
  profile.custom_image = config.ui?.custom_image || '';
  saveProfile(activeId, profile);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-updated', config);
  }
});

// 设置窗口通知主窗口切换图片
ipcMain.on('notify-set-custom-image', (_event, url) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('set-custom-image', url);
  }
});

// 设置窗口通知主窗口恢复 Live2D
ipcMain.on('notify-clear-custom-image', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clear-custom-image');
  }
});

// ========================
//  IPC: 记忆管理
// ========================

ipcMain.handle('memory-get-info', () => {
  return memoryService.getMemoryInfo();
});

ipcMain.handle('memory-export', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: '导出记忆文件',
      defaultPath: 'memory.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, error: '已取消' };
    const content = memoryService.exportMemory();
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('memory-import', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '导入记忆文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { ok: false, error: '已取消' };
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    return memoryService.importMemory(content);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 提示词导出
ipcMain.handle('prompt-export', async () => {
  try {
    const activePrompts = getActivePrompts();
    const prompts = {
      llm_system_prompt: activePrompts.system_prompt || '',
      proactive_decision_prompt: activePrompts.decision_prompt || '',
      proactive_system_prompt: activePrompts.proactive_system_prompt || '',
    };
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: '导出提示词配置',
      defaultPath: 'prompts.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, error: '已取消' };
    fs.writeFileSync(filePath, JSON.stringify(prompts, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 提示词导入（兼容 flat 格式 和 嵌套格式）
ipcMain.handle('prompt-import', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '导入提示词配置',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { ok: false, error: '已取消' };
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));

    // 统一转为 flat 格式返回给渲染进程
    // 支持两种格式：
    //   flat: { llm_system_prompt, proactive_decision_prompt, proactive_system_prompt }
    //   嵌套: { llm: { system_prompt }, proactive: { decision_prompt, system_prompt } }
    const data = {
      llm_system_prompt:
        raw.llm_system_prompt !== undefined
          ? raw.llm_system_prompt
          : (raw.llm?.system_prompt ?? ''),
      proactive_decision_prompt:
        raw.proactive_decision_prompt !== undefined
          ? raw.proactive_decision_prompt
          : (raw.proactive?.decision_prompt ?? ''),
      proactive_system_prompt:
        raw.proactive_system_prompt !== undefined
          ? raw.proactive_system_prompt
          : (raw.proactive?.system_prompt ?? ''),
    };

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 自定义角色图片：弹出文件选择，返回 file:// 路径
ipcMain.handle('choose-custom-image', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '选择角色图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { ok: false, error: '已取消' };
    // 返回 file:// URL，渲染进程可直接用作 img src
    const fileUrl = 'file:///' + filePaths[0].replace(/\\/g, '/');
    return { ok: true, path: filePaths[0], url: fileUrl };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('memory-clear', async () => {
  try {
    memoryService.clearMemory();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.on('before-quit', async (e) => {
  // 如果已经在第二次（flushDone 标记），直接放行
  if (app._flushDone) return;
  e.preventDefault();
  app._flushDone = true;
  try {
    const config = loadConfig();
    await memoryService.flushSummary(config.llm);
  } catch (err) {
    console.error('[Memory] flush on quit failed:', err.message);
  }
  app.quit();
});

app.on('window-all-closed', () => {
  if (ttsService) { ttsService.close(); ttsService = null; }
  app.quit();
});
