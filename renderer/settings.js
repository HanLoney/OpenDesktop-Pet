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

'use strict';

// ========================
//  工具：自定义确认弹窗
// ========================
function showConfirm(msg) {
  return new Promise((resolve) => {
    const mask = document.getElementById('custom-confirm-mask');
    const msgEl = document.getElementById('custom-confirm-msg');
    const inputEl = document.getElementById('custom-confirm-input');
    const oldOk = document.getElementById('custom-confirm-ok');
    const oldCancel = document.getElementById('custom-confirm-cancel');
    const okBtn = oldOk.cloneNode(true);
    const cancelBtn = oldCancel.cloneNode(true);
    oldOk.parentNode.replaceChild(okBtn, oldOk);
    oldCancel.parentNode.replaceChild(cancelBtn, oldCancel);
    msgEl.textContent = msg;
    if (inputEl) { inputEl.style.display = 'none'; inputEl.value = ''; }
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

/**
 * 带输入框的确认弹窗，返回输入的文字或 null
 */
function showPrompt(msg, placeholder) {
  return new Promise((resolve) => {
    const mask = document.getElementById('custom-confirm-mask');
    const msgEl = document.getElementById('custom-confirm-msg');
    const inputEl = document.getElementById('custom-confirm-input');
    const oldOk = document.getElementById('custom-confirm-ok');
    const oldCancel = document.getElementById('custom-confirm-cancel');
    const okBtn = oldOk.cloneNode(true);
    const cancelBtn = oldCancel.cloneNode(true);
    oldOk.parentNode.replaceChild(okBtn, oldOk);
    oldCancel.parentNode.replaceChild(cancelBtn, oldCancel);
    msgEl.textContent = msg;
    if (inputEl) {
      inputEl.style.display = 'block';
      inputEl.value = '';
      inputEl.placeholder = placeholder || '';
      setTimeout(() => inputEl.focus(), 50);
    }
    mask.classList.add('visible');
    function cleanup(result) {
      mask.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      if (inputEl) inputEl.style.display = 'none';
      resolve(result);
    }
    function onOk() { cleanup(inputEl ? inputEl.value.trim() : ''); }
    function onCancel() { cleanup(null); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ========================
//  主题应用
// ========================
function applyTheme(hex, hex2) {
  const root = document.documentElement;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighten = (v) => Math.round(v + (255 - v) * 0.45);
  const darken  = (v) => Math.round(v * 0.82);
  const themeLight = `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
  const themeBg    = `rgb(${lighten(lighten(r))},${lighten(lighten(g))},${lighten(lighten(b))})`;
  const themeDark  = `rgb(${darken(r)},${darken(g)},${darken(b)})`;
  const gradient = hex2 && hex2 !== hex
    ? `linear-gradient(135deg, ${hex}, ${hex2})`
    : hex;

  root.style.setProperty('--theme', hex);
  root.style.setProperty('--theme2', hex2 || hex);
  root.style.setProperty('--theme-gradient', gradient);
  root.style.setProperty('--theme-light', themeLight);
  root.style.setProperty('--theme-bg', themeBg);
  root.style.setProperty('--theme-dark', themeDark);
  root.style.setProperty('--theme-shadow', `rgba(${r},${g},${b},0.4)`);
  root.style.setProperty('--theme-shadow-soft', `rgba(${r},${g},${b},0.18)`);

  const preview = document.getElementById('theme-gradient-preview');
  if (preview) preview.style.background = gradient;
}

// ========================
//  主题预设
// ========================
const THEME_PRESETS_SOLID = [
  { color: '#5B8CFF', label: '默认蓝' },
  { color: '#7C6CFF', label: '紫罗兰' },
  { color: '#FF6B9D', label: '樱花粉' },
  { color: '#FF8C42', label: '橘橙' },
  { color: '#3CC97A', label: '翡翠绿' },
  { color: '#00B4D8', label: '天空蓝' },
  { color: '#E040FB', label: '梦幻紫' },
  { color: '#F5A623', label: '金黄' },
];
const THEME_PRESETS_GRADIENT = [
  { color: '#5B8CFF', color2: '#B06EFF', label: '蓝紫渐变' },
  { color: '#FF6B9D', color2: '#FF8C42', label: '粉橙渐变' },
  { color: '#3CC97A', color2: '#00B4D8', label: '绿蓝渐变' },
  { color: '#7C6CFF', color2: '#E040FB', label: '紫粉渐变' },
  { color: '#F5A623', color2: '#FF6B9D', label: '金粉渐变' },
  { color: '#00B4D8', color2: '#3CC97A', label: '天空渐变' },
  { color: '#FF8C42', color2: '#F5A623', label: '橘金渐变' },
  { color: '#5B8CFF', color2: '#3CC97A', label: '蓝绿渐变' },
];

(function initThemePresets() {
  const container = document.getElementById('theme-presets');
  const picker1   = document.getElementById('cfg-ui-theme-color');
  const picker2   = document.getElementById('cfg-ui-theme-color2');
  const color2Row = document.getElementById('theme-color2-row');
  const gradientPreview = document.getElementById('theme-gradient-preview');
  const color1Label = document.getElementById('theme-color1-label');
  const btnSolid    = document.getElementById('theme-mode-solid');
  const btnGradient = document.getElementById('theme-mode-gradient');
  if (!container || !picker1 || !picker2) return;

  let currentMode = 'solid';

  function setMode(mode, silent) {
    currentMode = mode;
    const isGrad = mode === 'gradient';
    btnSolid.classList.toggle('active', !isGrad);
    btnGradient.classList.toggle('active', isGrad);
    color2Row.style.display = isGrad ? 'flex' : 'none';
    gradientPreview.style.display = isGrad ? 'block' : 'none';
    color1Label.textContent = isGrad ? '起始色' : '颜色';
    const modeInput = document.getElementById('cfg-ui-theme-color-mode');
    if (modeInput) modeInput.value = mode;
    renderSwatches();
    if (!silent) {
      if (!isGrad) { picker2.value = picker1.value; applyTheme(picker1.value, null); }
      else { applyTheme(picker1.value, picker2.value); }
    }
  }

  function renderSwatches() {
    container.innerHTML = '';
    const presets = currentMode === 'gradient' ? THEME_PRESETS_GRADIENT : THEME_PRESETS_SOLID;
    presets.forEach(({ color, color2, label }) => {
      const c2 = color2 || color;
      const swatch = document.createElement('div');
      swatch.className = 'theme-preset-swatch';
      swatch.title = label;
      swatch.style.background = color === c2 ? color : `linear-gradient(135deg, ${color}, ${c2})`;
      swatch.dataset.color = color;
      swatch.dataset.color2 = c2;
      swatch.addEventListener('click', () => {
        picker1.value = color;
        picker2.value = c2;
        applyTheme(color, currentMode === 'gradient' ? c2 : null);
        updateSwatchActive(color, c2);
      });
      container.appendChild(swatch);
    });
  }

  function updateSwatchActive(hex1, hex2) {
    container.querySelectorAll('.theme-preset-swatch').forEach(s => {
      const match1 = s.dataset.color.toLowerCase() === hex1.toLowerCase();
      const match2 = currentMode === 'gradient'
        ? s.dataset.color2.toLowerCase() === (hex2 || hex1).toLowerCase()
        : true;
      s.classList.toggle('active', match1 && match2);
    });
  }

  btnSolid.addEventListener('click', () => setMode('solid'));
  btnGradient.addEventListener('click', () => setMode('gradient'));

  picker1.addEventListener('input', (e) => {
    applyTheme(e.target.value, currentMode === 'gradient' ? picker2.value : null);
    updateSwatchActive(e.target.value, picker2.value);
  });
  picker2.addEventListener('input', (e) => {
    applyTheme(picker1.value, e.target.value);
    updateSwatchActive(picker1.value, e.target.value);
  });

  renderSwatches();
  window._updateSwatchActive = updateSwatchActive;
  window._setThemeMode = setMode;
})();

// ========================
//  自定义图片
// ========================
let _customImageUrl = '';

function updateCustomImagePreview(url) {
  _customImageUrl = url || '';
  const wrap    = document.getElementById('custom-image-preview-wrap');
  const preview = document.getElementById('custom-image-preview');
  const nameEl  = document.getElementById('custom-image-name');
  if (!wrap || !preview) return;
  if (url) {
    preview.src = url;
    wrap.style.display = 'block';
    const filename = url.split('/').pop().split('\\').pop();
    if (nameEl) nameEl.textContent = decodeURIComponent(filename);
  } else {
    wrap.style.display = 'none';
    preview.src = '';
    if (nameEl) nameEl.textContent = '';
  }
}

function showCustomImageStatus(msg, isError) {
  const el = document.getElementById('custom-image-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 2500);
}

document.getElementById('custom-image-choose-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.chooseCustomImage();
  if (!result.ok) {
    if (result.error !== '已取消') showCustomImageStatus(result.error || '选择失败', true);
    return;
  }
  updateCustomImagePreview(result.url);
  // 通知主窗口切换图片并自适应窗口
  window.electronAPI.notifySetCustomImage(result.url);
  showCustomImageStatus('图片已加载，点击「保存设置」以持久化');
});

document.getElementById('custom-image-clear-btn').addEventListener('click', () => {
  updateCustomImagePreview('');
  // 通知主窗口恢复 Live2D
  window.electronAPI.notifyClearCustomImage();
  showCustomImageStatus('已恢复 Live2D 形象，点击「保存设置」以持久化');
});

// ========================
//  摄像头预览
// ========================
let _previewStream = null;

async function enumCameraDevices() {
  const sel = document.getElementById('cfg-camera-device');
  if (!sel) return;
  try {
    // 先申请一次权限，确保能枚举到设备标签
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
    if (tmp) tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    const prev = sel.value;
    sel.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `摄像头 ${i + 1}`;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
    if (!sel.value && cams.length) sel.value = cams[0].deviceId;
  } catch (err) {
    console.warn('[Settings] 枚举摄像头失败:', err.message);
  }
}

async function startCameraPreview(deviceId) {
  stopCameraPreview();
  const video = document.getElementById('camera-preview');
  const tip   = document.getElementById('camera-preview-tip');
  if (!video) return;
  try {
    const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true };
    _previewStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = _previewStream;
    if (tip) tip.style.display = 'none';
    showCameraStatus('摄像头已开启');
  } catch (err) {
    if (tip) { tip.style.display = 'flex'; tip.textContent = '无法访问摄像头：' + err.message; }
    showCameraStatus('无法访问摄像头：' + err.message, true);
  }
}

function stopCameraPreview() {
  if (_previewStream) {
    _previewStream.getTracks().forEach(t => t.stop());
    _previewStream = null;
  }
  const video = document.getElementById('camera-preview');
  const tip   = document.getElementById('camera-preview-tip');
  if (video) video.srcObject = null;
  if (tip) { tip.style.display = 'flex'; tip.textContent = '未开启预览'; }
}

function showCameraStatus(msg, isError) {
  const el = document.getElementById('camera-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 2500);
}

function initCameraSection(config) {
  const enabledEl  = document.getElementById('cfg-camera-enabled');
  const subEl      = document.getElementById('camera-sub');
  const deviceSel  = document.getElementById('cfg-camera-device');
  const refreshBtn = document.getElementById('camera-refresh-btn');
  if (!enabledEl) return;

  const cam = config.camera || {};
  enabledEl.checked = !!cam.enabled;
  subEl.style.display = cam.enabled ? '' : 'none';

  const onProactiveEl = document.getElementById('cfg-camera-on-proactive');
  const onChatEl      = document.getElementById('cfg-camera-on-chat');
  if (onProactiveEl) onProactiveEl.checked = cam.on_proactive !== false; // 默认 true
  if (onChatEl)      onChatEl.checked      = !!cam.on_chat;

  const syncSub = async () => {
    const on = enabledEl.checked;
    subEl.style.display = on ? '' : 'none';
    if (on) {
      await enumCameraDevices();
      if (cam.device_id) deviceSel.value = cam.device_id;
      startCameraPreview(deviceSel.value);
    } else {
      stopCameraPreview();
    }
  };

  enabledEl.addEventListener('change', syncSub);

  refreshBtn.addEventListener('click', async () => {
    await enumCameraDevices();
    if (enabledEl.checked) startCameraPreview(deviceSel.value);
  });

  deviceSel.addEventListener('change', () => {
    if (enabledEl.checked) startCameraPreview(deviceSel.value);
  });

  if (cam.enabled) {
    enumCameraDevices().then(() => {
      if (cam.device_id) deviceSel.value = cam.device_id;
      startCameraPreview(deviceSel.value);
    });
  }
}

// ========================
//  角色配置（Profile）管理
// ========================
let _currentProfileId = 'default';

function showProfileStatus(msg, isError) {
  const el = document.getElementById('profile-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 2500);
}

async function loadProfileList() {
  const select = document.getElementById('cfg-profile-select');
  if (!select) return;
  const profiles = await window.electronAPI.profileList();
  const { id: activeId } = await window.electronAPI.profileGetActive();
  _currentProfileId = activeId;
  select.innerHTML = '';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
  syncDeleteBtnLabel();
}

async function loadProfileIntoForm(profileId) {
  const profile = await window.electronAPI.profileGet(profileId);
  document.getElementById('cfg-llm-system-prompt').value = profile.system_prompt || '';
  document.getElementById('cfg-proactive-decision-prompt').value = profile.decision_prompt || '';
  document.getElementById('cfg-proactive-system-prompt').value = profile.proactive_system_prompt || '';
  updateCustomImagePreview(profile.custom_image || '');
}

function syncDeleteBtnLabel() {
  const select = document.getElementById('cfg-profile-select');
  const btn = document.getElementById('profile-delete-btn');
  if (!select || !btn) return;
  if (select.value === 'default') {
    btn.textContent = '恢复默认';
    btn.style.borderColor = 'var(--theme-light)';
    btn.style.color = 'var(--theme)';
  } else {
    btn.textContent = '删除角色';
    btn.style.borderColor = '#ffb3b3';
    btn.style.color = '#e05555';
  }
}

document.getElementById('cfg-profile-select').addEventListener('change', async () => {
  const select = document.getElementById('cfg-profile-select');
  const id = select.value;
  syncDeleteBtnLabel();
  if (!id || id === _currentProfileId) return;
  const result = await window.electronAPI.profileSwitch(id);
  if (result.ok) {
    _currentProfileId = id;
    await loadProfileIntoForm(id);
    loadMemoryInfo();
    showProfileStatus('已切换角色');
  } else {
    // 切换失败，恢复选择
    select.value = _currentProfileId;
    showProfileStatus(result.error || '切换失败', true);
  }
});

document.getElementById('profile-new-btn').addEventListener('click', () => {
  // 清空弹窗表单
  document.getElementById('profile-create-name').value = '';
  document.getElementById('profile-create-system-prompt').value = '';
  document.getElementById('profile-create-decision-prompt').value = '';
  document.getElementById('profile-create-proactive-prompt').value = '';
  _profileCreateImageUrl = '';
  document.getElementById('profile-create-image-preview-wrap').style.display = 'none';
  document.getElementById('profile-create-image-preview').src = '';
  document.getElementById('profile-create-image-clear-btn').style.display = 'none';
  document.getElementById('profile-create-status').textContent = '';
  // 显示弹窗
  document.getElementById('profile-create-mask').classList.add('visible');
});

// ========================
//  新建角��弹窗逻辑
// ========================
let _profileCreateImageUrl = '';

document.getElementById('profile-create-close').addEventListener('click', () => {
  document.getElementById('profile-create-mask').classList.remove('visible');
});

document.getElementById('profile-create-mask').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('profile-create-mask').classList.remove('visible');
  }
});

document.getElementById('profile-create-import-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.promptImport();
  if (!result.ok) return;
  const d = result.data || {};
  if (d.llm_system_prompt !== undefined)
    document.getElementById('profile-create-system-prompt').value = d.llm_system_prompt;
  if (d.proactive_decision_prompt !== undefined)
    document.getElementById('profile-create-decision-prompt').value = d.proactive_decision_prompt;
  if (d.proactive_system_prompt !== undefined)
    document.getElementById('profile-create-proactive-prompt').value = d.proactive_system_prompt;
  showProfileCreateStatus('提示词已导入');
});

document.getElementById('profile-create-image-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.chooseCustomImage();
  if (!result.ok) return;
  _profileCreateImageUrl = result.url;
  document.getElementById('profile-create-image-preview').src = result.url;
  document.getElementById('profile-create-image-preview-wrap').style.display = 'block';
  document.getElementById('profile-create-image-clear-btn').style.display = '';
});

document.getElementById('profile-create-image-clear-btn').addEventListener('click', () => {
  _profileCreateImageUrl = '';
  document.getElementById('profile-create-image-preview-wrap').style.display = 'none';
  document.getElementById('profile-create-image-preview').src = '';
  document.getElementById('profile-create-image-clear-btn').style.display = 'none';
});

function showProfileCreateStatus(msg, isError) {
  const el = document.getElementById('profile-create-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 2500);
}

document.getElementById('profile-create-save-btn').addEventListener('click', async () => {
  const name = document.getElementById('profile-create-name').value.trim();
  if (!name) {
    showProfileCreateStatus('请输入角色名称', true);
    return;
  }
  const data = {
    name,
    system_prompt: document.getElementById('profile-create-system-prompt').value.trim(),
    decision_prompt: document.getElementById('profile-create-decision-prompt').value.trim(),
    proactive_system_prompt: document.getElementById('profile-create-proactive-prompt').value.trim(),
    custom_image: _profileCreateImageUrl || '',
  };
  const result = await window.electronAPI.profileCreate(data);
  if (result.ok) {
    await loadProfileList();
    const select = document.getElementById('cfg-profile-select');
    select.value = result.id;
    // 自动切换到新创建的角色，加载完整配置
    const switchResult = await window.electronAPI.profileSwitch(result.id);
    if (switchResult.ok) {
      _currentProfileId = result.id;
      await loadProfileIntoForm(result.id);
      loadMemoryInfo();
      syncDeleteBtnLabel();
    }
    document.getElementById('profile-create-mask').classList.remove('visible');
    showProfileStatus(`角色「${name}」已创建`);
  } else {
    showProfileCreateStatus(result.error || '创建失败', true);
  }
});

document.getElementById('profile-delete-btn').addEventListener('click', async () => {
  const select = document.getElementById('cfg-profile-select');
  const id = select.value;
  if (!id) return;

  // 默认角色 → 恢复默认
  if (id === 'default') {
    const confirmed = await showConfirm('确定要恢复默认角色的初始设置吗？提示词和图片将被重置。');
    if (!confirmed) return;
    const resetData = {
      name: '默认角色',
      system_prompt: '你是小玄，一个可爱的桌宠。用口语化的方式简短回复，2-3句话以内。',
      decision_prompt: '请观察用户当前屏幕状态。${sinceStr}\n判断：现在是否适合桌宠主动打招呼？\n规则：\n1. 距上次互动不足3分钟，除非用户明显空闲，否则返回 false\n2. 用户在专注编码/开会/看视频/打游戏，返回 false\n3. 用户在闲逛/发呆/看图/聊天等轻松状态，返回 true\n4. 屏幕无明显内容变化（可能挂机），返回 false',
      proactive_system_prompt: '你是小玄，一个桌面宠物。你刚刚偷看了用户的屏幕，请根据屏幕内容像朋友一样主动发起一句简短互动（1-2句话）。语气可爱、自然、口语化。不要说\'我看到你的屏幕\'这种话，直接评论内容或关心用户。',
      custom_image: '',
    };
    await window.electronAPI.profileSave('default', resetData);
    await loadProfileIntoForm('default');
    showProfileStatus('默认角色已恢复初始设置');
    return;
  }

  // 非默认角色 → 删除
  const name = select.options[select.selectedIndex].textContent;
  const confirmed = await showConfirm(`确定要删除角色「${name}」吗？此操作不可恢复。`);
  if (!confirmed) return;
  // 如果要删除的是当前激活角色，先切回默认角色
  if (id === _currentProfileId) {
    const switchResult = await window.electronAPI.profileSwitch('default');
    if (!switchResult.ok) {
      showProfileStatus('切换默认角色失败', true);
      return;
    }
    _currentProfileId = 'default';
    await loadProfileIntoForm('default');
    loadMemoryInfo();
  }
  const result = await window.electronAPI.profileDelete(id);
  if (result.ok) {
    await loadProfileList();
    syncDeleteBtnLabel();
    showProfileStatus(`角色「${name}」已删除`);
  } else {
    showProfileStatus(result.error || '删除失败', true);
  }
});

// ========================
//  加载设置
// ========================
async function loadSettings() {
  const config = await window.electronAPI.getConfig();
  const llm = config.llm || {};
  const tts = config.tts || {};
  const proactive = config.proactive || {};
  const ui  = config.ui  || {};
  const memory = config.memory || {};

  // 加载角色配置列表
  await loadProfileList();

  // 加载当前激活角色的提示词到表单
  const { id: activeId, profile: activeProfile } = await window.electronAPI.profileGetActive();

  document.getElementById('cfg-llm-api-base').value = llm.api_base || '';
  document.getElementById('cfg-llm-api-key').value  = llm.api_key  || '';
  document.getElementById('cfg-llm-model').value    = llm.model    || '';
  document.getElementById('cfg-llm-temperature').value = llm.temperature ?? 0.8;
  document.getElementById('cfg-llm-temperature-val').textContent = llm.temperature ?? 0.8;
  // 提示词从 profile 加载
  document.getElementById('cfg-llm-system-prompt').value = activeProfile.system_prompt || llm.system_prompt || '';

  // TTS 火山
  document.getElementById('cfg-tts-app-id').value       = tts.app_id       || '';
  document.getElementById('cfg-tts-access-token').value = tts.access_token || '';
  document.getElementById('cfg-tts-voice-type').value   = tts.voice_type   || '';
  document.getElementById('cfg-tts-resource-id').value  = tts.resource_id  || '';
  document.getElementById('cfg-tts-sample-rate').value  = tts.sample_rate  || 24000;
  document.getElementById('cfg-tts-speech-rate').value  = tts.speech_rate  ?? 13;
  document.getElementById('cfg-tts-speech-rate-val').textContent = tts.speech_rate ?? 13;
  // OpenAI
  document.getElementById('cfg-tts-openai-api-base').value = tts.openai_api_base || '';
  document.getElementById('cfg-tts-openai-api-key').value  = tts.openai_api_key  || '';
  document.getElementById('cfg-tts-openai-model').value    = tts.openai_model    || 'tts-1';
  document.getElementById('cfg-tts-openai-voice').value    = tts.openai_voice    || 'alloy';
  const openaiSpeed = tts.openai_speed ?? 1.0;
  document.getElementById('cfg-tts-openai-speed').value = openaiSpeed;
  document.getElementById('cfg-tts-openai-speed-val').textContent = openaiSpeed;
  // Edge
  document.getElementById('cfg-tts-edge-voice').value  = tts.edge_voice  || 'zh-CN-XiaoxiaoNeural';
  document.getElementById('cfg-tts-edge-rate').value   = tts.edge_rate   || '+0%';
  document.getElementById('cfg-tts-edge-volume').value = tts.edge_volume || '+0%';
  // CosyVoice
  document.getElementById('cfg-tts-cosyvoice-api-base').value  = tts.cosyvoice_api_base  || 'http://127.0.0.1:50000';
  document.getElementById('cfg-tts-cosyvoice-endpoint').value  = tts.cosyvoice_endpoint  || '/inference_sft';
  document.getElementById('cfg-tts-cosyvoice-spk-id').value    = tts.cosyvoice_spk_id    || 'default';

  // provider + 面板切换
  const providerEl = document.getElementById('cfg-tts-provider');
  providerEl.value = tts.provider || 'volcengine';
  const syncTtsPanel = () => {
    const p = providerEl.value;
    document.getElementById('tts-panel-volcengine').style.display = p === 'volcengine' ? '' : 'none';
    document.getElementById('tts-panel-openai').style.display     = p === 'openai'     ? '' : 'none';
    document.getElementById('tts-panel-edge').style.display       = p === 'edge'       ? '' : 'none';
    document.getElementById('tts-panel-cosyvoice').style.display  = p === 'cosyvoice'  ? '' : 'none';
  };
  syncTtsPanel();
  providerEl.addEventListener('change', syncTtsPanel);

  document.getElementById('cfg-tts-openai-speed').addEventListener('input', (e) => {
    document.getElementById('cfg-tts-openai-speed-val').textContent = parseFloat(e.target.value).toFixed(2);
  });

  const ttsEnabledEl = document.getElementById('cfg-tts-enabled');
  const ttsSubEl = document.getElementById('tts-sub');
  const syncTtsSub = () => { ttsSubEl.style.display = ttsEnabledEl.checked ? '' : 'none'; };
  ttsEnabledEl.checked = tts.enabled !== false;
  syncTtsSub();
  ttsEnabledEl.addEventListener('change', syncTtsSub);

  const proactiveEnabledEl = document.getElementById('cfg-proactive-enabled');
  const proactiveSubEl = document.getElementById('proactive-sub');
  const syncProactiveSub = () => { proactiveSubEl.style.display = proactiveEnabledEl.checked ? '' : 'none'; };
  proactiveEnabledEl.checked = proactive.enabled !== false;
  const intervalMin = proactive.interval_min_seconds || proactive.interval_seconds || 60;
  const intervalMax = proactive.interval_max_seconds || intervalMin;
  const elMin = document.getElementById('cfg-proactive-interval-min');
  const elMax = document.getElementById('cfg-proactive-interval-max');
  elMin.value = intervalMin;
  elMax.value = intervalMax;
  elMin.addEventListener('change', () => { if (parseInt(elMin.value) > parseInt(elMax.value)) elMax.value = elMin.value; });
  elMax.addEventListener('change', () => { if (parseInt(elMax.value) < parseInt(elMin.value)) elMin.value = elMax.value; });
  document.getElementById('cfg-chat-screenshot').checked = !!(proactive.chat_screenshot);
  // 提示词从 profile 加载
  document.getElementById('cfg-proactive-decision-prompt').value = activeProfile.decision_prompt || proactive.decision_prompt || '';
  document.getElementById('cfg-proactive-system-prompt').value   = activeProfile.proactive_system_prompt || proactive.system_prompt || '';
  syncProactiveSub();
  proactiveEnabledEl.addEventListener('change', syncProactiveSub);

  // UI
  const fontSize = ui.font_size || 13;
  document.getElementById('cfg-ui-font-size').value = fontSize;
  document.getElementById('cfg-ui-font-size-val').textContent = fontSize;

  const barSize = ui.bar_size || 28;
  document.getElementById('cfg-ui-bar-size').value = barSize;
  document.getElementById('cfg-ui-bar-size-val').textContent = barSize;

  document.getElementById('cfg-ui-show-bubble').checked = ui.show_bubble !== false;

  const themeColor  = ui.theme_color      || '#5B8CFF';
  const themeMode   = ui.theme_color_mode || 'solid';
  const themeColor2 = themeMode === 'gradient' ? (ui.theme_color2 || themeColor) : themeColor;
  document.getElementById('cfg-ui-theme-color').value  = themeColor;
  document.getElementById('cfg-ui-theme-color2').value = themeColor2;
  const modeInput = document.getElementById('cfg-ui-theme-color-mode');
  if (modeInput) modeInput.value = themeMode;
  if (window._setThemeMode) window._setThemeMode(themeMode, true);
  applyTheme(themeColor, themeMode === 'gradient' ? themeColor2 : null);
  if (window._updateSwatchActive) window._updateSwatchActive(themeColor, themeColor2);

  // 记忆
  document.getElementById('cfg-memory-context-rounds').value = memory.context_rounds || 10;

  // 自定义图片（从 profile 加载）
  updateCustomImagePreview(activeProfile.custom_image || ui.custom_image || '');

  // 记忆信息
  loadMemoryInfo();

  // 摄像头
  initCameraSection(config);
}

// ========================
//  保存设置
// ========================
document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const config = {
    llm: {
      api_base:      document.getElementById('cfg-llm-api-base').value.trim(),
      api_key:       document.getElementById('cfg-llm-api-key').value.trim(),
      model:         document.getElementById('cfg-llm-model').value.trim(),
      temperature:   parseFloat(document.getElementById('cfg-llm-temperature').value) || 0.8,
      system_prompt: document.getElementById('cfg-llm-system-prompt').value.trim(),
    },
    tts: {
      enabled:      document.getElementById('cfg-tts-enabled').checked,
      provider:     document.getElementById('cfg-tts-provider').value,
      app_id:       document.getElementById('cfg-tts-app-id').value.trim(),
      access_token: document.getElementById('cfg-tts-access-token').value.trim(),
      voice_type:   document.getElementById('cfg-tts-voice-type').value.trim(),
      resource_id:  document.getElementById('cfg-tts-resource-id').value.trim(),
      sample_rate:  parseInt(document.getElementById('cfg-tts-sample-rate').value) || 24000,
      speech_rate:  parseInt(document.getElementById('cfg-tts-speech-rate').value) || 0,
      openai_api_base: document.getElementById('cfg-tts-openai-api-base').value.trim(),
      openai_api_key:  document.getElementById('cfg-tts-openai-api-key').value.trim(),
      openai_model:    document.getElementById('cfg-tts-openai-model').value.trim() || 'tts-1',
      openai_voice:    document.getElementById('cfg-tts-openai-voice').value,
      openai_speed:    parseFloat(document.getElementById('cfg-tts-openai-speed').value) || 1.0,
      edge_voice:      document.getElementById('cfg-tts-edge-voice').value.trim()  || 'zh-CN-XiaoxiaoNeural',
      edge_rate:       document.getElementById('cfg-tts-edge-rate').value.trim()   || '+0%',
      edge_volume:     document.getElementById('cfg-tts-edge-volume').value.trim() || '+0%',
      cosyvoice_api_base: document.getElementById('cfg-tts-cosyvoice-api-base').value.trim() || 'http://127.0.0.1:50000',
      cosyvoice_endpoint: document.getElementById('cfg-tts-cosyvoice-endpoint').value.trim() || '/inference_sft',
      cosyvoice_spk_id:   document.getElementById('cfg-tts-cosyvoice-spk-id').value.trim()   || 'default',
    },
    proactive: {
      enabled: document.getElementById('cfg-proactive-enabled').checked,
      interval_min_seconds: Math.min(
        parseInt(document.getElementById('cfg-proactive-interval-min').value) || 60,
        parseInt(document.getElementById('cfg-proactive-interval-max').value) || 60
      ),
      interval_max_seconds: Math.max(
        parseInt(document.getElementById('cfg-proactive-interval-min').value) || 60,
        parseInt(document.getElementById('cfg-proactive-interval-max').value) || 60
      ),
      chat_screenshot:   document.getElementById('cfg-chat-screenshot').checked,
      decision_prompt:   document.getElementById('cfg-proactive-decision-prompt').value.trim(),
      system_prompt:     document.getElementById('cfg-proactive-system-prompt').value.trim(),
    },
    memory: {
      context_rounds: parseInt(document.getElementById('cfg-memory-context-rounds').value) || 10,
    },
    ui: {
      font_size:        parseInt(document.getElementById('cfg-ui-font-size').value) || 13,
      bar_size:         parseInt(document.getElementById('cfg-ui-bar-size').value)  || 28,
      show_bubble:      document.getElementById('cfg-ui-show-bubble').checked,
      theme_color:      document.getElementById('cfg-ui-theme-color').value  || '#5B8CFF',
      theme_color2:     document.getElementById('cfg-ui-theme-color2').value || document.getElementById('cfg-ui-theme-color').value || '#5B8CFF',
      theme_color_mode: document.getElementById('cfg-ui-theme-color-mode')?.value || 'solid',
      custom_image:     _customImageUrl || '',
    },
    camera: {
      enabled:      document.getElementById('cfg-camera-enabled')?.checked || false,
      device_id:    document.getElementById('cfg-camera-device')?.value    || '',
      on_proactive: document.getElementById('cfg-camera-on-proactive')?.checked !== false,
      on_chat:      document.getElementById('cfg-camera-on-chat')?.checked  || false,
    },
  };

  const result = await window.electronAPI.saveConfig(config);

  // 同时保存提示词到当前激活的 profile
  const profileData = {
    name: document.getElementById('cfg-profile-select')?.options[document.getElementById('cfg-profile-select')?.selectedIndex]?.textContent || '默认角色',
    system_prompt: config.llm.system_prompt,
    proactive_system_prompt: config.proactive.system_prompt,
    decision_prompt: config.proactive.decision_prompt,
    custom_image: config.ui.custom_image,
  };
  await window.electronAPI.profileSave(_currentProfileId, profileData);

  const saveStatus = document.getElementById('save-status');
  if (result.ok) {
    saveStatus.textContent = '已保存';
    saveStatus.style.color = '#3aa76d';
    setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    // 通知主窗口配置已更新
    window.electronAPI.notifyConfigSaved(config);
  } else {
    saveStatus.textContent = '保存失败: ' + (result.error || '未知错误');
    saveStatus.style.color = 'rgba(255,120,120,0.8)';
    setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = ''; }, 3000);
  }
});

// ========================
//  滑块实时显示
// ========================
document.getElementById('cfg-llm-temperature').addEventListener('input', (e) => {
  document.getElementById('cfg-llm-temperature-val').textContent = e.target.value;
});
document.getElementById('cfg-tts-speech-rate').addEventListener('input', (e) => {
  document.getElementById('cfg-tts-speech-rate-val').textContent = e.target.value;
});
document.getElementById('cfg-ui-font-size').addEventListener('input', (e) => {
  document.getElementById('cfg-ui-font-size-val').textContent = e.target.value;
});
document.getElementById('cfg-ui-bar-size').addEventListener('input', (e) => {
  document.getElementById('cfg-ui-bar-size-val').textContent = e.target.value;
});

// ========================
//  记忆管理
// ========================
async function loadMemoryInfo() {
  try {
    const info = await window.electronAPI.memoryGetInfo();
    document.getElementById('memory-stats').textContent =
      `总对话轮次：${info.totalRounds}　待压缩条数：${info.pendingCount}`;
    document.getElementById('memory-summary-view').value = info.summary || '（暂无摘要）';
    const factsEl = document.getElementById('memory-facts-view');
    if (info.facts && info.facts.length > 0) {
      factsEl.innerHTML = info.facts
        .map(f => `<span style="display:inline-block;margin-right:12px;"><b>${f.key}</b>：${f.value}</span>`)
        .join('');
    } else {
      factsEl.textContent = '（暂无事实记录）';
    }
  } catch (_e) {
    document.getElementById('memory-stats').textContent = '加载失败';
  }
}

function showMemoryStatus(msg, isError) {
  const el = document.getElementById('memory-status');
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 3000);
}

document.getElementById('memory-export-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.memoryExport();
  showMemoryStatus(result.ok ? '导出成功' : (result.error || '导出失败'), !result.ok);
});

document.getElementById('memory-import-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.memoryImport();
  if (result.ok) { showMemoryStatus('导入成功'); loadMemoryInfo(); }
  else { showMemoryStatus(result.error || '导入失败', true); }
});

const memoryClearConfirm = document.getElementById('memory-clear-confirm');
document.getElementById('memory-clear-btn').addEventListener('click', () => {
  memoryClearConfirm.style.display = '';
});
document.getElementById('memory-clear-cancel').addEventListener('click', () => {
  memoryClearConfirm.style.display = 'none';
});
document.getElementById('memory-clear-ok').addEventListener('click', async () => {
  memoryClearConfirm.style.display = 'none';
  const result = await window.electronAPI.memoryClear();
  if (result.ok) { showMemoryStatus('记忆已清空'); loadMemoryInfo(); }
  else { showMemoryStatus(result.error || '清空失败', true); }
});

// ========================
//  提示词导入/导出
// ========================
function showPromptStatus(msg, isError) {
  const el = document.getElementById('prompt-io-status');
  el.textContent = msg;
  el.style.color = isError ? 'rgba(255,120,120,0.8)' : '#3aa76d';
  setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 2500);
}

document.getElementById('prompt-export-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.promptExport();
  showPromptStatus(result.ok ? '导出成功' : (result.error || '导出失败'), !result.ok);
});

document.getElementById('prompt-import-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.promptImport();
  if (!result.ok) { showPromptStatus(result.error || '导入失败', true); return; }
  const d = result.data || {};
  if (d.llm_system_prompt !== undefined)
    document.getElementById('cfg-llm-system-prompt').value = d.llm_system_prompt;
  if (d.proactive_decision_prompt !== undefined)
    document.getElementById('cfg-proactive-decision-prompt').value = d.proactive_decision_prompt;
  if (d.proactive_system_prompt !== undefined)
    document.getElementById('cfg-proactive-system-prompt').value = d.proactive_system_prompt;
  showPromptStatus('导入成功，请保存设置生效');
});

// ========================
//  退出
// ========================
document.getElementById('quit-app-btn').addEventListener('click', async () => {
  const confirmed = await showConfirm('确定要退出应用吗？');
  if (confirmed) window.electronAPI.quitApp();
});

// ========================
//  初始化
// ========================
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  // 标题栏关闭按钮
  document.getElementById('title-bar-close').addEventListener('click', () => {
    stopCameraPreview();
    window.close();
  });
});
