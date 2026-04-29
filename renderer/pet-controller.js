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
 * 小玄桌宠 - Live2D 控制器
 * 精简自 live2d-streaming/live2d-controller.js
 */
'use strict';

const MODEL_PATH = '../assets/xuan9.0/xuan9.0.model3.json';

const STATE = {
  app: null,
  model: null,
  isDragging: false,
  dragStartScreenX: 0,
  dragStartScreenY: 0,
  dragStartClientX: 0,
  dragStartClientY: 0,
  dragStartModelX: 0,
  dragStartModelY: 0,
  modelOffsetX: 0,
  modelOffsetY: 0,
  initialFitScale: 1,
  currentScaleRatio: 1.0,
  currentExpression: null,
  savedParameterValues: null,
  paramValuesRef: null,
};

// ========================
//  初始化
// ========================
window.addEventListener('DOMContentLoaded', () => {
  initLive2D();
  setupIPCListeners();
  initCustomImageMode();
});

async function initLive2D() {
  try {
    const Live2DModel = (PIXI.live2d && PIXI.live2d.Live2DModel)
      || window.PIXI_LIVE2D_DISPLAY?.Live2DModel
      || window.Live2DModel;

    if (!Live2DModel) throw new Error('pixi-live2d-display 未正确加载');

    if (typeof Live2DModel.registerTicker === 'function') {
      Live2DModel.registerTicker(PIXI.Ticker);
    }
    window._Live2DModel = Live2DModel;

    // 使用独立的 live2d-layer 作为画布容器
    const container = document.getElementById('live2d-layer');
    const dpr = window.devicePixelRatio || 1;

    STATE.app = new PIXI.Application({
      backgroundAlpha: 0,
      width: container.clientWidth,
      height: container.clientHeight,
      antialias: true,
      resolution: dpr * 2,
      autoDensity: true,
    });

    const canvas = STATE.app.view;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    STATE.model = await window._Live2DModel.from(MODEL_PATH, {
      autoInteract: false,
    });

    STATE.app.stage.addChild(STATE.model);

    fitModel();
    disableMouseFollow();
    saveInitialParameters();
    await loadCdiData();
    setupInteractions();

    window.addEventListener('resize', onResize);

  } catch (err) {
    console.error('[桌宠] 初始化失败:', err);
  }
}

// ========================
//  模型适配
// ========================
function fitModel({ resetOffset = true } = {}) {
  const { app, model } = STATE;
  if (!app || !model) return;

  const container = document.getElementById('live2d-layer');
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return;

  const local = typeof model.getLocalBounds === 'function'
    ? model.getLocalBounds() : model.getBounds();
  const baseW = local.width;
  const baseH = local.height;
  if (!baseW || !baseH) return;

  const margin = 0.92;
  const scale = Math.min((w * margin) / baseW, (h * margin) / baseH);
  if (!isFinite(scale) || scale <= 0) return;

  STATE.initialFitScale = scale;
  if (resetOffset) {
    STATE.currentScaleRatio = 1.0;
    STATE.modelOffsetX = 0;
    STATE.modelOffsetY = 0;
  }
  model.scale.set(STATE.initialFitScale * STATE.currentScaleRatio);

  model.x = (w - model.width) / 2 + STATE.modelOffsetX;
  model.y = h - model.height + STATE.modelOffsetY;
}

// ========================
//  禁用鼠标跟随
// ========================
function disableMouseFollow() {
  const m = STATE.model;
  if (!m) return;
  try {
    if (m.focusController) {
      m.focusController.enabled = false;
      m.focusController.update = () => {};
    }
    const im = m.internalModel;
    if (im?.focusController) {
      im.focusController.enabled = false;
      im.focusController.update = () => {};
    }
    if (im?.motionManager?.focusController) {
      im.motionManager.focusController.enabled = false;
      im.motionManager.focusController.update = () => {};
    }
  } catch (_e) {}
}

// ========================
//  保存初始参数快照
// ========================
function saveInitialParameters() {
  const { model } = STATE;
  if (!model) return;
  try {
    const core = model.internalModel?.coreModel;
    if (!core) return;

    let paramValues = null;
    if (core._parameterValues) {
      paramValues = core._parameterValues;
    } else if (core._model?._parameterValues) {
      paramValues = core._model._parameterValues;
    } else if (core.parameters) {
      paramValues = core.parameters;
    }
    if (!paramValues) return;

    STATE.paramValuesRef = paramValues;
    STATE.savedParameterValues = new Float32Array(paramValues);
  } catch (e) {
    console.warn('[桌宠] 保存初始参数失败:', e);
  }
}

// ========================
//  桌宠交互（拖拽、缩放、右键菜单、点击穿透）
// ========================
function setupInteractions() {
  const { app, model } = STATE;
  if (!app || !model) return;

  const canvas = app.view;

  // --- 拖拽/点击状态变量（穿透检测也需要用到） ---
  let pointerDownPos = null;
  let isPointerDown = false;
  const DRAG_THRESHOLD = 5;

  // --- 点击穿透检测（挂在 document 上，图片模式下 canvas 不可见时仍能响应） ---
  function _hitTestInteractable(clientX, clientY) {
    // 底部聊天区 / 设置面板 —— 只要悬浮标志为 true 就直接放行
    if (window._chatAreaHover) return true;

    // 图片模式：检测图片本身区域
    if (_imgMode) {
      const imgEl = document.getElementById('custom-pet-image');
      if (imgEl) {
        const r = imgEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return true;
      }
    } else {
      if (isOverModel(clientX, clientY)) return true;
    }

    // 左上角三个控制按钮
    return isOverElement('window-drag-handle', clientX, clientY)
      || isOverElement('window-zoom-in', clientX, clientY)
      || isOverElement('window-zoom-out', clientX, clientY)
      || isOverElement('chat-area', clientX, clientY);
  }

  // --- 拖拽处理（仍挂在 canvas，Live2D 模式专用） ---
  canvas.addEventListener('mousemove', (e) => {
    if (isPointerDown) {
      if (!STATE.isDragging) {
        const dist = Math.hypot(e.clientX - pointerDownPos.cx, e.clientY - pointerDownPos.cy);
        if (dist >= DRAG_THRESHOLD) {
          STATE.isDragging = true;
          canvas.style.cursor = 'grabbing';
          STATE.dragStartClientX = e.clientX;
          STATE.dragStartClientY = e.clientY;
          STATE.dragStartModelX = STATE.modelOffsetX;
          STATE.dragStartModelY = STATE.modelOffsetY;
        }
        return;
      }
      // 在窗口内移动模型
      const dx = e.clientX - STATE.dragStartClientX;
      const dy = e.clientY - STATE.dragStartClientY;
      STATE.modelOffsetX = STATE.dragStartModelX + dx;
      STATE.modelOffsetY = STATE.dragStartModelY + dy;
      const container = document.getElementById('live2d-layer');
      const w = container.clientWidth;
      const h = container.clientHeight;
      model.x = (w - model.width) / 2 + STATE.modelOffsetX;
      model.y = h - model.height + STATE.modelOffsetY;
    }
  });

  // --- 点击穿透检测（document 级，兼容图片模式） ---
  document.addEventListener('mousemove', (e) => {
    if (window._windowDragActive) return;
    if (_imgMode && _imgDragging) return; // 图片拖拽中跳过
    const isOver = _hitTestInteractable(e.clientX, e.clientY);
    window.electronAPI.setIgnoreMouse(!isOver);
    // 图片模式下：鼠标悬停在图片区域时唤起左上角三个按钮
    if (_imgMode && isOver && typeof window.showWindowDragHandle === 'function') {
      window.showWindowDragHandle();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (!STATE.isDragging && !isPointerDown && !window._windowDragActive) {
      // 延迟一帧，让 handle/chatArea 的 mouseenter 有机会先设置标志
      requestAnimationFrame(() => {
        if (!window._windowDragHandleHover && !window._windowDragActive && !window._chatAreaHover) {
          window.electronAPI.setIgnoreMouse(true);
        }
      });
    }
  });

  // --- 点击身体部位检测 ---
  function resetPointerState() {
    if (!isPointerDown) return;
    const wasClick = !STATE.isDragging && pointerDownPos;
    const clickPos = pointerDownPos;
    pointerDownPos = null;
    isPointerDown = false;
    STATE.isDragging = false;
    canvas.style.cursor = 'grab';
    if (wasClick) {
      onBodyPartClick(clickPos.cx, clickPos.cy);
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!isOverModel(e.clientX, e.clientY)) return;

    pointerDownPos = { cx: e.clientX, cy: e.clientY };
    isPointerDown = true;
    STATE.isDragging = false;

    if (typeof window.showWindowDragHandle === 'function') window.showWindowDragHandle();
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) resetPointerState();
  });

  // 兜底：在窗口级别监听，防止事件丢失
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) resetPointerState();
  });

  // --- 滚轮缩放 ---
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.95 : 1.05;
    applyScaleFactor(factor);
  }, { passive: false });

  // --- 右键菜单 ---
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isOverModel(e.clientX, e.clientY)) {
      window.electronAPI.showContextMenu();
    }
  });
}

// 简单的模型边界检测
function isOverModel(clientX, clientY) {
  const { model, app } = STATE;
  if (!model || !app) return false;
  const canvas = app.view;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const bounds = model.getBounds();
  return bounds.contains(x, y);
}

// 检测是否在指定 DOM 元素上
function isOverElement(id, clientX, clientY) {
  const el = document.getElementById(id);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

// ========================
//  Drawable 级别命中检测
// ========================

// ArtMesh ID → 身体部位映射（优先通过 CDI 名称匹配，再通过 ID 正则匹配）
const DRAWABLE_BODY_MAP = {
  // 头部 / 脸
  head: [/face/i, /head/i, /脸/, /头/, /顔/, /摸头/],
  // 眼睛
  eye: [/eye/i, /眼/, /目/, /瞳/, /高光/, /泪眼/],
  // 嘴巴
  mouth: [/mouth/i, /lip/i, /嘴/, /口/],
  // 头发 / 刘海
  hair: [/hair/i, /bangs/i, /前刘海/, /鬓发/, /马尾/, /后发/,
    /^ArtMesh2$/i, /^ArtMesh3$/i, /^ArtMesh4$/i, /^ArtMesh7$/i, /^ArtMesh8$/i, /^ArtMesh49$/i],
  // 身体 / 躯干
  body: [/body/i, /torso/i, /胴体/, /身体/, /衣服/, /服/, /领结/, /呼吸/],
  // 手臂 / 手
  arm: [/arm/i, /hand/i, /手/, /腕/, /对手指/,
    /^ArtMesh31$/i, /^ArtMesh32$/i, /^ArtMesh37$/i, /^ArtMesh38$/i],
  // 裙子 / 下半身
  skirt: [/skirt/i, /裙/, /^ArtMesh42$/i],
};

/**
 * 将 clientX/clientY 转换为 Live2D 模型本地坐标
 */
function clientToModelLocal(clientX, clientY) {
  const { model, app } = STATE;
  if (!model || !app) return null;
  const canvas = app.view;
  const rect = canvas.getBoundingClientRect();
  const pixiX = clientX - rect.left;
  const pixiY = clientY - rect.top;
  // 转到模型本地坐标系
  const local = model.toLocal(new PIXI.Point(pixiX, pixiY));
  return local;
}

/**
 * 判断点是否在三角形内 (重心坐标法)
 */
function pointInTriangle(px, py, x0, y0, x1, y1, x2, y2) {
  const dX = px - x2;
  const dY = py - y2;
  const dX21 = x2 - x1;
  const dY12 = y1 - y2;
  const D = dY12 * (x0 - x2) + dX21 * (y0 - y2);
  if (Math.abs(D) < 1e-10) return false;
  const s = (dY12 * dX + dX21 * dY) / D;
  const t = ((y2 - y0) * dX + (x0 - x2) * dY) / D;
  return s >= 0 && t >= 0 && (s + t) <= 1;
}

/**
 * Drawable 级命中检测：遍历所有可见 drawable 的三角形网格，
 * 从最前面（drawOrder 最大）向后检测，返回第一个命中的 drawable ID
 */
function hitTestDrawables(clientX, clientY) {
  const { model } = STATE;
  if (!model) return null;

  const local = clientToModelLocal(clientX, clientY);
  if (!local) return null;

  const coreModel = model.internalModel?.coreModel;
  if (!coreModel) return null;

  // Cubism Core API
  const drawableCount = coreModel.getDrawableCount();
  const renderOrders = coreModel.getDrawableRenderOrders();
  const opacities = coreModel.getDrawableOpacities();

  // 按 renderOrder 降序排列索引（前面的先测）
  const sortedIndices = Array.from({ length: drawableCount }, (_, i) => i);
  sortedIndices.sort((a, b) => renderOrders[b] - renderOrders[a]);

  const px = local.x;
  const py = local.y;

  for (const i of sortedIndices) {
    if (opacities[i] < 0.01) continue; // 不可见的跳过

    const verts = coreModel.getDrawableVertices(i);
    const indices = coreModel.getDrawableIndices(i);
    if (!verts || !indices || indices.length < 3) continue;

    // 遍历三角形
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      if (pointInTriangle(
        px, py,
        verts[i0 * 2], verts[i0 * 2 + 1],
        verts[i1 * 2], verts[i1 * 2 + 1],
        verts[i2 * 2], verts[i2 * 2 + 1]
      )) {
        return coreModel.getDrawableId(i);
      }
    }
  }
  return null;
}

/**
 * 通过 drawable ID 和 CDI 信息确定身体部位
 */
function classifyBodyPart(drawableId) {
  if (!drawableId) return null;

  // 先通过映射规则匹配
  for (const [part, patterns] of Object.entries(DRAWABLE_BODY_MAP)) {
    for (const pattern of patterns) {
      if (pattern instanceof RegExp && pattern.test(drawableId)) return part;
    }
  }

  // 尝试从 CDI 名称匹配
  const cdiName = getDrawableCdiName(drawableId);
  if (cdiName) {
    for (const [part, patterns] of Object.entries(DRAWABLE_BODY_MAP)) {
      for (const pattern of patterns) {
        if (pattern instanceof RegExp && pattern.test(cdiName)) return part;
      }
    }
  }

  return 'body'; // 默认归为身体
}

// CDI 名称缓存：drawableId -> CDI 用户可读名称
let _cdiMap = null;

async function loadCdiData() {
  if (_cdiMap) return;
  _cdiMap = {};
  try {
    const resp = await fetch('../assets/xuan9.0/xuan9.0.cdi3.json');
    const cdi = await resp.json();
    // Parts 部分包含 ArtMesh 的可读名称
    if (cdi.Parts) {
      for (const p of cdi.Parts) {
        // CDI Parts Id 格式: "ArtMesh2_Skinning" → 对应 drawable "ArtMesh2"
        const baseId = p.Id.replace(/_Skinning$/, '');
        _cdiMap[baseId] = p.Name; // 如 "前刘海(蒙皮)"
        _cdiMap[p.Id] = p.Name;
      }
    }
    console.log('[桌宠] CDI 数据已加载，共', Object.keys(_cdiMap).length, '条映射');
  } catch (e) {
    console.warn('[桌宠] CDI 数据加载失败:', e);
  }
}

function getDrawableCdiName(drawableId) {
  if (!_cdiMap) return null;
  // 直接匹配
  if (_cdiMap[drawableId]) return _cdiMap[drawableId];
  // 尝试去掉后缀匹配
  const base = drawableId.replace(/_Skinning$/, '');
  return _cdiMap[base] || null;
}

/**
 * 完整的点击命中检测：返回 { drawableId, bodyPart }
 */
function hitTestBody(clientX, clientY) {
  const drawableId = hitTestDrawables(clientX, clientY);
  if (!drawableId) return null;
  const bodyPart = classifyBodyPart(drawableId);
  return { drawableId, bodyPart };
}

// 暴露给全局，供 chat.js 等使用
window.hitTestBody = hitTestBody;
window.playExpression = playExpression;

// ========================
//  点击身体部位处理
// ========================
function onBodyPartClick(clientX, clientY) {
  const result = hitTestBody(clientX, clientY);
  if (!result) {
    console.log('[桌宠] 点击未命中任何 drawable');
    return;
  }

  const cdiName = getDrawableCdiName(result.drawableId) || '';
  console.log(`[桌宠] 点击命中: ${result.bodyPart} | drawable=${result.drawableId} | cdi=${cdiName}`);

  // 根据身体部位触发不同反应
  switch (result.bodyPart) {
    case 'head':
    case 'hair':
      playExpression('head pat');
      playMotion(0, 'head pat');
      break;
    case 'eye':
      playExpression('miyan');
      break;
    case 'mouth':
      playExpression('OO');
      break;
    case 'body':
    case 'arm':
      playExpression('lianhong');
      playMotion(4, 'shyin');
      break;
    case 'skirt':
      playExpression('heilian');
      break;
    default:
      break;
  }
}

// ========================
//  调试：列出所有 Drawable ID（在控制台执行 dumpAllDrawables()）
// ========================
window.dumpAllDrawables = function() {
  const coreModel = STATE.model?.internalModel?.coreModel;
  if (!coreModel) { console.warn('模型未加载'); return; }

  const count = coreModel.getDrawableCount();
  const opacities = coreModel.getDrawableOpacities();
  const orders = coreModel.getDrawableRenderOrders();
  const results = [];

  for (let i = 0; i < count; i++) {
    const id = coreModel.getDrawableId(i);
    const cdiName = getDrawableCdiName(id) || '';
    const part = classifyBodyPart(id);
    results.push({
      index: i,
      id,
      cdiName,
      bodyPart: part,
      opacity: opacities[i].toFixed(2),
      renderOrder: orders[i],
    });
  }

  results.sort((a, b) => b.renderOrder - a.renderOrder);
  console.table(results);
  return results;
};

// ========================
//  缩放
// ========================
function applyScaleFactor(factor) {
  const { model } = STATE;
  if (!model) return;
  const minRatio = 0.3;
  const maxRatio = 3.0;
  const newRatio = Math.max(minRatio, Math.min(STATE.currentScaleRatio * factor, maxRatio));
  STATE.currentScaleRatio = newRatio;
  model.scale.set(STATE.initialFitScale * newRatio);
}

// ========================
//  窗口 resize
// ========================
function onResize() {
  const { app, model } = STATE;
  if (!app || !model) return;

  const container = document.getElementById('live2d-layer');
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (app.renderer?.resize) app.renderer.resize(w, h);

  fitModel({ resetOffset: false });
}

// ========================
//  表情
// ========================
function playExpression(name) {
  const { model } = STATE;
  if (!model) return;
  try {
    const im = model.internalModel;
    const em = im?.motionManager?.expressionManager || im?.expressionManager;
    if (em) {
      const defs = em.definitions || [];
      const idx = defs.findIndex(d => (d.Name || d.name) === name);
      if (idx >= 0) {
        em.setExpression(idx);
        try { em.fadeInTime = 0.1; em.fadeOutTime = 0.1; } catch (_e) {}
      } else {
        model.expression(name).catch(() => {});
      }
    } else {
      model.expression(name).catch(() => {});
    }
    STATE.currentExpression = name;
  } catch (e) {
    console.error('[桌宠] 播放表情失败:', e);
  }
}

function resetExpression() {
  const { model } = STATE;
  if (!model) return;
  try {
    const im = model.internalModel;
    const em = im?.motionManager?.expressionManager || im?.expressionManager;
    if (em?.resetExpression) em.resetExpression();
    STATE.currentExpression = null;
  } catch (_e) {}
}

// ========================
//  动作
// ========================
let motionResetTimer = null;

function playMotion(index, name) {
  const { model } = STATE;
  if (!model) return;

  if (motionResetTimer) {
    clearTimeout(motionResetTimer);
    motionResetTimer = null;
  }

  try {
    const im = model.internalModel;
    const mm = im?.motionManager;
    if (mm && typeof mm.stopAllMotions === 'function') mm.stopAllMotions();

    const promise = model.motion('TapBody', index, 3);
    if (promise && typeof promise.then === 'function') promise.catch(() => {});

    const duration = { 'head pat': 3000, 'cry': 4500, 'roll': 3000, 'yun': 3000 }[name] || 3000;
    const fadeOut = 1500;

    motionResetTimer = setTimeout(() => {
      const mm2 = model.internalModel?.motionManager;
      if (mm2 && typeof mm2.stopAllMotions === 'function') mm2.stopAllMotions();
      restoreInitialParametersSmooth(fadeOut);
      motionResetTimer = null;
    }, Math.max(0, duration - fadeOut));

  } catch (e) {
    console.error('[桌宠] 播放动作失败:', e);
  }
}

function stopMotion() {
  const { model } = STATE;
  if (!model) return;
  try {
    const mm = model.internalModel?.motionManager;
    if (mm && typeof mm.stopAllMotions === 'function') mm.stopAllMotions();
    restoreInitialParametersSmooth(1500);
    if (motionResetTimer) { clearTimeout(motionResetTimer); motionResetTimer = null; }
  } catch (_e) {}
}

function restoreInitialParametersSmooth(fadeOutDuration = 500) {
  const { model } = STATE;
  if (!model) return;

  let paramValues = STATE.paramValuesRef;
  const savedValues = STATE.savedParameterValues;

  if (!paramValues) {
    try {
      const core = model.internalModel?.coreModel;
      if (core) {
        paramValues = core._parameterValues
          ?? core._model?._parameterValues
          ?? core.parameters;
        if (paramValues) STATE.paramValuesRef = paramValues;
      }
    } catch (_e) {}
  }

  if (!paramValues || !savedValues) return;

  const mm = model.internalModel?.motionManager;
  const startTime = performance.now();

  const animate = (currentTime) => {
    try { mm?.stopAllMotions?.(); } catch (_e) {}

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / fadeOutDuration, 1);
    const t = 1 - Math.pow(1 - progress, 3); // cubic ease-out

    for (let i = 0; i < Math.min(savedValues.length, paramValues.length); i++) {
      paramValues[i] = paramValues[i] * (1 - t) + savedValues[i] * t;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };

  requestAnimationFrame(animate);
}

// ========================
//  IPC 监听（来自 Electron 右键菜单）
// ========================
function setupIPCListeners() {
  const api = window.electronAPI;
  if (!api) return;

  api.onPlayExpression((name) => playExpression(name));
  api.onResetExpression(() => resetExpression());
  api.onPlayMotion((index, name) => playMotion(index, name));
  api.onStopMotion(() => stopMotion());
}

// ========================
//  口型同步（供 chat.js 调用）
// ========================
let _lipTarget = 0;
let _lipCurrent = 0;
let _lipTicking = false;

/**
 * 设置口型同步目标值（0~1）
 * 由 chat.js 的 TTS 音频播放回调调用
 */
window.setLipSync = function(level) {
  _lipTarget = level;
  if (!_lipTicking) {
    _lipTicking = true;
    _lipTick();
  }
};

function _lipTick() {
  const { model } = STATE;
  if (!model) { _lipTicking = false; return; }

  // 平滑过渡：上升快(20ms)，下降慢(80ms)
  const dt = 16; // ~60fps
  if (_lipTarget > _lipCurrent) {
    _lipCurrent += (_lipTarget - _lipCurrent) * Math.min(1, dt / 20);
  } else {
    _lipCurrent += (_lipTarget - _lipCurrent) * Math.min(1, dt / 80);
  }

  // 静音检测
  if (_lipTarget === 0 && _lipCurrent < 0.01) {
    _lipCurrent = 0;
  }

  try {
    const core = model.internalModel?.coreModel;
    if (core) {
      core.setParameterValueById('ParamMouthOpen', _lipCurrent);
    }
  } catch (_e) {}

  if (_lipCurrent > 0.001 || _lipTarget > 0) {
    requestAnimationFrame(_lipTick);
  } else {
    _lipTicking = false;
  }
}

// ========================
//  自定义图片模式
// ========================
let _imgMode = false;           // 当前是否处于图片模式
let _imgUrl = '';               // 当前图片 URL
let _imgOffsetX = 0;            // 图片位置偏移
let _imgOffsetY = 0;
let _imgScale = 1.0;            // 图片缩放
let _imgDragging = false;       // 图片拖拽中（模块级，供穿透检测使用）
const IMG_SCALE_STEP = 0.05;
const IMG_SCALE_MIN  = 0.2;
const IMG_SCALE_MAX  = 4.0;

/**
 * 切换到自定义图片模式
 * @param {string} url  file:// 或 data: URL
 * @param {object} [opts]
 * @param {boolean} [opts.noResize]  传 true 时不触发窗口自适应（如设置面板刷新时）
 */
window.setCustomImage = function(url, opts) {
  _imgUrl = url;
  _imgMode = true;
  _imgOffsetX = 0;
  _imgOffsetY = 0;
  _imgScale = 1.0;

  const imgEl = document.getElementById('custom-pet-image');
  if (imgEl) {
    imgEl.src = url;
    imgEl.style.display = 'block';
    _applyImgTransform(imgEl);
  }

  // 隐藏 Live2D canvas，并禁用其鼠标事件拦截
  if (STATE.app?.view) {
    STATE.app.view.style.visibility = 'hidden';
    STATE.app.view.style.pointerEvents = 'none';
  }

  // 读取图片真实尺寸，自适应窗口大小（noResize 时跳过）
  if (!opts?.noResize) {
    const probe = new Image();
    probe.onload = function() {
      if (window.electronAPI?.resizeToContent) {
        window.electronAPI.resizeToContent(probe.naturalWidth, probe.naturalHeight);
      }
    };
    probe.src = url;
  }
};

/**
 * 恢复 Live2D 模式
 * @param {object} [opts]
 * @param {boolean} [opts.noResize]  传 true 时不触发窗口自适应
 */
window.clearCustomImage = function(opts) {
  _imgMode = false;
  _imgUrl = '';

  const imgEl = document.getElementById('custom-pet-image');
  if (imgEl) {
    imgEl.style.display = 'none';
    imgEl.src = '';
  }

  if (STATE.app?.view) {
    STATE.app.view.style.visibility = 'visible';
    STATE.app.view.style.pointerEvents = '';
  }

  // 恢复 Live2D 默认窗口尺寸（传 0,0 触发默认逻辑），noResize 时跳过
  if (!opts?.noResize && window.electronAPI?.resizeToContent) {
    window.electronAPI.resizeToContent(0, 0);
  }
};

function _applyImgTransform(imgEl) {
  imgEl.style.transformOrigin = 'center bottom';
  // translateX(-50%) 用于居中，再叠加用户拖拽偏移和缩放
  imgEl.style.transform = `translateX(calc(-50% + ${_imgOffsetX}px)) translateY(${_imgOffsetY}px) scale(${_imgScale})`;
}

/**
 * 初始化图片模式的拖拽与滚轮缩放，挂到 live2d-layer
 */
function initCustomImageMode() {
  const container = document.getElementById('live2d-layer');
  if (!container) return;

  let _imgDragStartX = 0;
  let _imgDragStartY = 0;
  let _imgDragBaseX = 0;
  let _imgDragBaseY = 0;

  // 图片模式：mousedown 需挂在 document 级（container 本身 pointer-events:none）
  document.addEventListener('mousedown', (e) => {
    if (!_imgMode || e.button !== 0) return;
    const imgEl = document.getElementById('custom-pet-image');
    if (!imgEl) return;
    // 检测是否点击在图片范围内
    const r = imgEl.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;

    _imgDragging = true;
    _imgDragStartX = e.clientX;
    _imgDragStartY = e.clientY;
    _imgDragBaseX = _imgOffsetX;
    _imgDragBaseY = _imgOffsetY;
    document.body.style.cursor = 'grabbing';
    if (typeof window.showWindowDragHandle === 'function') window.showWindowDragHandle();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!_imgMode || !_imgDragging) return;
    const imgEl = document.getElementById('custom-pet-image');
    if (!imgEl) return;

    _imgOffsetX = _imgDragBaseX + (e.clientX - _imgDragStartX);
    _imgOffsetY = _imgDragBaseY + (e.clientY - _imgDragStartY);
    _applyImgTransform(imgEl);
  });

  window.addEventListener('mouseup', () => {
    if (!_imgMode || !_imgDragging) return;
    _imgDragging = false;
    document.body.style.cursor = '';
  });

  // 图片缩放也挂到 document 级
  document.addEventListener('wheel', (e) => {
    if (!_imgMode) return;
    const imgEl = document.getElementById('custom-pet-image');
    if (!imgEl) return;
    // 只在图片区域内响应
    const r = imgEl.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -IMG_SCALE_STEP : IMG_SCALE_STEP;
    _imgScale = Math.max(IMG_SCALE_MIN, Math.min(IMG_SCALE_MAX, _imgScale + delta));
    _applyImgTransform(imgEl);
  }, { passive: false });
}

// 让 isOverModel 在图片模式下也能感知图片区域（用于点击穿透）
const _origIsOverModel = window.isOverModel;
window.isOverModelOrImage = function(clientX, clientY) {
  if (_imgMode) {
    const imgEl = document.getElementById('custom-pet-image');
    if (!imgEl) return false;
    const rect = imgEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top  && clientY <= rect.bottom;
  }
  return typeof _origIsOverModel === 'function' ? _origIsOverModel(clientX, clientY) : false;
};
