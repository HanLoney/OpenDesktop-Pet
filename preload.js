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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 桌宠基础
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  windowDrag: (dx, dy) => ipcRenderer.send('window-drag', dx, dy),
  windowResize: (scale) => ipcRenderer.send('window-resize', scale),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  onPlayExpression: (cb) => ipcRenderer.on('play-expression', (_e, name) => cb(name)),
  onResetExpression: (cb) => ipcRenderer.on('reset-expression', () => cb()),
  onPlayMotion: (cb) => ipcRenderer.on('play-motion', (_e, index, name) => cb(index, name)),
  onStopMotion: (cb) => ipcRenderer.on('stop-motion', () => cb()),

  // 聊天
  chatSend: (message) => ipcRenderer.send('chat-send', message),
  chatSendWithImage: (message, imageBase64) => ipcRenderer.send('chat-send-with-image', message, imageBase64),
  onChatToken: (cb) => ipcRenderer.on('chat-token', (_e, token) => cb(token)),
  onChatDone: (cb) => ipcRenderer.on('chat-done', (_e, fullText) => cb(fullText)),
  onChatError: (cb) => ipcRenderer.on('chat-error', (_e, err) => cb(err)),

  // TTS 音频
  onTtsAudio: (cb) => ipcRenderer.on('tts-audio', (_e, buf) => cb(buf)),
  onTtsAudioEncoded: (cb) => ipcRenderer.on('tts-audio-encoded', (_e, buf) => cb(buf)),
  onTtsEnd: (cb) => ipcRenderer.on('tts-end', () => cb()),

  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // 角色配置（Profile）
  profileList: () => ipcRenderer.invoke('profile-list'),
  profileGet: (id) => ipcRenderer.invoke('profile-get', id),
  profileGetActive: () => ipcRenderer.invoke('profile-get-active'),
  profileSave: (id, data) => ipcRenderer.invoke('profile-save', id, data),
  profileCreate: (data) => ipcRenderer.invoke('profile-create', data),
  profileDelete: (id) => ipcRenderer.invoke('profile-delete', id),
  profileSwitch: (id) => ipcRenderer.invoke('profile-switch', id),
  onProfileSwitched: (cb) => ipcRenderer.on('profile-switched', (_e, data) => cb(data)),

  // 截屏
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // 主动交互
  onProactiveChatStart: (cb) => ipcRenderer.on('proactive-chat-start', () => cb()),

  // 记忆管理
  memoryGetInfo: () => ipcRenderer.invoke('memory-get-info'),
  memoryExport: () => ipcRenderer.invoke('memory-export'),
  memoryImport: () => ipcRenderer.invoke('memory-import'),
  memoryClear: () => ipcRenderer.invoke('memory-clear'),

  // 提示词导入导出
  promptExport: () => ipcRenderer.invoke('prompt-export'),
  promptImport: () => ipcRenderer.invoke('prompt-import'),

  // 自定义角色图片
  chooseCustomImage: () => ipcRenderer.invoke('choose-custom-image'),

  // 窗口自适应内容尺寸（上传图片或切换 Live2D 时调用）
  resizeToContent: (w, h) => ipcRenderer.invoke('resize-to-content', w, h),

  // 设置窗口
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  // 设置页通知主窗口：配置已保存
  notifyConfigSaved: (config) => ipcRenderer.send('notify-config-saved', config),
  // 设置页通知主窗口：气泡位置预览
  notifyBubblePreview: (pos) => ipcRenderer.send('notify-bubble-preview', pos),
  onBubblePreview: (cb) => ipcRenderer.on('bubble-preview', (_e, pos) => cb(pos)),
  // 设置页通知主窗口：切换图片 / 恢复 Live2D
  notifySetCustomImage: (url) => ipcRenderer.send('notify-set-custom-image', url),
  notifyClearCustomImage: () => ipcRenderer.send('notify-clear-custom-image'),
  // 主窗口接收通知
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, config) => cb(config)),
  onSetCustomImage: (cb) => ipcRenderer.on('set-custom-image', (_e, url) => cb(url)),
  onClearCustomImage: (cb) => ipcRenderer.on('clear-custom-image', () => cb()),

  // 摄像头
  captureCamera: (base64) => ipcRenderer.send('camera-frame', base64),
  onRequestCameraFrame: (cb) => ipcRenderer.on('request-camera-frame', () => cb()),

  // AI 交互开关
  aiToggle: (enabled) => ipcRenderer.send('ai-toggle', enabled),

  // 调试
  onDebugPrompt: (cb) => ipcRenderer.on('debug-prompt', (_e, data) => cb(data)),

  // 退出应用
  quitApp: () => ipcRenderer.send('quit-app'),
});
