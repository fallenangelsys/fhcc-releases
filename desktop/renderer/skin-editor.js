(function initSkinStudio() {
  'use strict';

  const studio = document.querySelector('.skin-studio-app');
  const workspace = document.getElementById('skin-workspace');
  const textureCanvas = document.getElementById('skin-texture-canvas');
  const webglCanvas = document.getElementById('skin-webgl-canvas');
  if (!studio || !workspace || !textureCanvas || !webglCanvas) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);
  const PROJECT_KEY = 'fh-minecraft-skin-project-v2';
  const LEGACY_KEY = 'fh-minecraft-skin-v1';
  const MAX_HISTORY = 30;
  const TOOL_LABELS = {
    pencil: 'Stift',
    shade: 'Auto-Ton',
    fill: 'Füllen',
    eraser: 'Radierer',
    picker: 'Pipette'
  };
  const PALETTE = ['#5865f2', '#7c5cff', '#00d9b7', '#3ba55d', '#f0b232', '#ed4245', '#f8f9fb', '#c8ccd8', '#313338', '#111318'];
  const SKIN_BASE_RECTS = [
    [8, 0, 8, 8], [16, 0, 8, 8], [0, 8, 8, 8], [8, 8, 8, 8], [16, 8, 8, 8], [24, 8, 8, 8],
    [20, 16, 8, 4], [28, 16, 8, 4], [16, 20, 4, 12], [20, 20, 8, 12], [28, 20, 4, 12], [32, 20, 8, 12],
    [4, 16, 4, 4], [8, 16, 4, 4], [0, 20, 4, 12], [4, 20, 4, 12], [8, 20, 4, 12], [12, 20, 4, 12],
    [44, 16, 4, 4], [48, 16, 4, 4], [40, 20, 4, 12], [44, 20, 4, 12], [48, 20, 4, 12], [52, 20, 4, 12],
    [20, 48, 4, 4], [24, 48, 4, 4], [16, 52, 4, 12], [20, 52, 4, 12], [24, 52, 4, 12], [28, 52, 4, 12],
    [36, 48, 4, 4], [40, 48, 4, 4], [32, 52, 4, 12], [36, 52, 4, 12], [40, 52, 4, 12], [44, 52, 4, 12]
  ];
  const SKIN_OVERLAY_RECTS = [
    [40, 0, 8, 8], [48, 0, 8, 8], [32, 8, 8, 8], [40, 8, 8, 8], [48, 8, 8, 8], [56, 8, 8, 8],
    [20, 32, 8, 4], [28, 32, 8, 4], [16, 36, 4, 12], [20, 36, 8, 12], [28, 36, 4, 12], [32, 36, 8, 12],
    [4, 32, 4, 4], [8, 32, 4, 4], [0, 36, 4, 12], [4, 36, 4, 12], [8, 36, 4, 12], [12, 36, 4, 12],
    [44, 32, 4, 4], [48, 32, 4, 4], [40, 36, 4, 12], [44, 36, 4, 12], [48, 36, 4, 12], [52, 36, 4, 12],
    [4, 48, 4, 4], [8, 48, 4, 4], [0, 52, 4, 12], [4, 52, 4, 12], [8, 52, 4, 12], [12, 52, 4, 12],
    [52, 48, 4, 4], [56, 48, 4, 4], [48, 52, 4, 12], [52, 52, 4, 12], [56, 52, 4, 12], [60, 52, 4, 12]
  ];

  const elements = {
    file: byId('skin-file'),
    importButton: byId('skin-import'),
    resetButton: byId('skin-reset'),
    exportButton: byId('skin-export'),
    walkButton: byId('skin-walk-mode'),
    modelStage: byId('skin-model-stage'),
    canvasStage: byId('skin-canvas-stage'),
    canvasWrap: $('.skin-canvas-wrap'),
    pixelGrid: byId('skin-pixel-grid'),
    pixelGridOverlay: byId('skin-pixel-grid-overlay'),
    uvLayout: byId('skin-uv-layout'),
    uvOverlay: byId('skin-uv-overlay'),
    brushPreview: byId('skin-brush-preview'),
    mirror: byId('skin-mirror'),
    primaryColor: byId('skin-color'),
    secondaryColor: byId('skin-secondary-color'),
    colorValue: byId('skin-color-value'),
    swapColors: byId('skin-swap-colors'),
    undo: byId('skin-undo'),
    redo: byId('skin-redo'),
    swatches: byId('skin-swatches'),
    modelDetection: byId('skin-model-detection'),
    modelStatus: byId('skin-model-status'),
    importReport: byId('skin-import-report'),
    renderState: byId('skin-render-state'),
    fps: byId('skin-fps'),
    modelBrushDot: byId('skin-3d-brush-dot'),
    coordinates: byId('skin-coordinates'),
    saveState: byId('skin-save-state'),
    sizeStatus: byId('skin-size-status'),
    zoomLabel: byId('skin-zoom-label'),
    layerList: byId('skin-layer-list'),
    layerCount: byId('skin-layer-count'),
    addLayer: byId('skin-add-layer'),
    layerOpacity: byId('skin-layer-opacity'),
    layerOpacityValue: byId('skin-layer-opacity-value'),
    baseLayer: byId('skin-base-layer'),
    overlayLayer: byId('skin-overlay-layer'),
    viewReset: byId('skin-view-reset')
    ,aiOpen: byId('skin-ai-open')
    ,aiCreator: byId('skin-ai-creator')
    ,aiPrompt: byId('skin-ai-prompt')
    ,aiStyle: byId('skin-ai-style')
    ,aiDetail: byId('skin-ai-detail')
    ,aiGenerate: byId('skin-ai-generate')
    ,aiStatus: byId('skin-ai-status')
  };

  const compositeContext = textureCanvas.getContext('2d', { willReadFrequently: true });
  compositeContext.imageSmoothingEnabled = false;
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = 64;
  baseCanvas.height = 64;
  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  baseContext.imageSmoothingEnabled = false;

  let layers = [];
  let activeLayerId = 'paint-1';
  let layerSequence = 1;
  let tool = 'pencil';
  let brushSize = 1;
  let zoom = 8;
  let viewMode = '3d';
  let modelChoice = 'auto';
  let detectedModel = 'default';
  let viewer = null;
  let viewerUpdateFrame = 0;
  let viewerNeedsModelRefresh = false;
  let modelRaycaster = null;
  let modelPointer = null;
  let modelPaintingActive = false;
  let resizeFrame = 0;
  let saveTimer = 0;
  let drawing = false;
  let lastPixel = null;
  let history = [];
  let historyIndex = -1;
  let historyLocked = false;
  let fpsFrames = 0;
  let fpsLastTime = performance.now();
  let fpsFrame = 0;
  let destroyed = false;
  let importMetadata = {
    name: 'Fallen Heaven Starter',
    width: 64,
    height: 64,
    note: 'Basis · Details · Outer-Layer'
  };

  function createLayer(name, id = `paint-${++layerSequence}`) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    return { id, name, visible: true, opacity: 1, canvas, context };
  }

  function getActiveLayer() {
    return layers.find((layer) => layer.id === activeLayerId) || layers[0] || null;
  }

  function setStatusText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function colorHexToRgba(hex) {
    const normalized = String(hex || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6);
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
      a: 255
    };
  }

  function rgbaToHex(r, g, b) {
    return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  function setPixel(context, x, y, color, erase = false) {
    if (x < 0 || x >= 64 || y < 0 || y >= 64) return;
    if (erase) {
      context.clearRect(x, y, 1, 1);
      return;
    }
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  }

  function fillFace(context, x, y, width, height, color, accent = null) {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    if (accent) {
      context.fillStyle = accent;
      context.fillRect(x, y, width, 1);
      context.fillRect(x, y, 1, height);
    }
  }

  function defaultStarterRecipe() {
    return {
      name: 'Fallen Heaven Starter',
      style: 'cyber',
      archetype: 'hoodie',
      pattern: 'panels',
      detail: 'rich',
      palette: {
        primary: '#171B35',
        secondary: '#242A55',
        accent: '#9D8CFF',
        skin: '#A87454',
        hair: '#070812',
        eyes: '#8BD7FF'
      },
      hood: true,
      mask: false,
      gloves: true,
      boots: true,
      glowing: true,
      summary: 'Professioneller Fallen-Heaven-Startskin mit Basis, Details und Outer-Layer.'
    };
  }

  function drawDefaultSkin() {
    baseContext.clearRect(0, 0, 64, 64);
    const recipe = defaultStarterRecipe();
    drawAiSkinBaseLayer({ context: baseContext }, recipe, stringSeed('fallen-heaven-starter-base-v3'));

    detectedModel = 'default';
    importMetadata = { name: 'Fallen Heaven Starter', width: 64, height: 64, note: 'Basis · Details · Outer-Layer' };
  }

  function createDefaultSkinLayers() {
    const recipe = defaultStarterRecipe();
    const seed = stringSeed('fallen-heaven-starter-editable-v3');
    const detailLayer = createLayer('FH · Schatten & Pixel', 'paint-1');
    const overlayLayer = createLayer('FH · Hood & Outer-Layer', 'paint-2');
    drawAiSkinDetailLayer(detailLayer, recipe, seed);
    drawAiSkinOverlayLayer(overlayLayer, recipe, seed);
    return [detailLayer, overlayLayer];
  }

  function compositeLayers() {
    compositeContext.clearRect(0, 0, 64, 64);
    compositeContext.globalAlpha = 1;
    compositeContext.drawImage(baseCanvas, 0, 0);
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      compositeContext.globalAlpha = layer.opacity;
      compositeContext.drawImage(layer.canvas, 0, 0);
    }
    compositeContext.globalAlpha = 1;
    textureCanvas.dispatchEvent(new CustomEvent('skintexturechange'));
    scheduleViewerTextureUpdate();
    renderLayerThumbnails();
  }

  function effectiveModel() {
    if (modelChoice === 'slim') return 'slim';
    if (modelChoice === 'classic') return 'default';
    return detectedModel === 'slim' ? 'slim' : 'default';
  }

  function modelLabel(model = effectiveModel()) {
    return model === 'slim' ? 'Slim' : 'Classic';
  }

  function updateModelUI() {
    const current = effectiveModel();
    $$('.skin-model-switch [data-skin-model]').forEach((button) => {
      const isActive = button.dataset.skinModel === modelChoice;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    setStatusText(elements.modelDetection, modelChoice === 'auto' ? `AUTO · ${modelLabel(current).toUpperCase()}` : 'MANUELL');
    setStatusText(elements.modelStatus, `${modelChoice === 'auto' ? 'Auto' : 'Manuell'} · ${modelLabel(current)}`);
  }

  function applyViewerVisibility() {
    if (!viewer) return;
    const skin = viewer.playerObject.skin;
    skin.setInnerLayerVisible(Boolean(elements.baseLayer?.checked));
    skin.setOuterLayerVisible(Boolean(elements.overlayLayer?.checked));
    const partState = Object.fromEntries($$('[data-skin-part]').map((button) => [button.dataset.skinPart, button.classList.contains('active')]));
    skin.head.visible = partState.head !== false;
    skin.body.visible = partState.body !== false;
    skin.leftArm.visible = partState.arms !== false;
    skin.rightArm.visible = partState.arms !== false;
    skin.leftLeg.visible = partState.legs !== false;
    skin.rightLeg.visible = partState.legs !== false;
  }

  function updateViewerTexture() {
    if (!viewer) return;
    const model = effectiveModel();
    const skinCanvas = viewer.skinCanvas;
    const canFastUpdate = skinCanvas && viewer.skinTexture && !viewerNeedsModelRefresh && viewer.playerObject?.skin?.modelType === model;
    if (canFastUpdate) {
      if (skinCanvas.width !== 64) skinCanvas.width = 64;
      if (skinCanvas.height !== 64) skinCanvas.height = 64;
      const skinContext = skinCanvas.getContext('2d', { willReadFrequently: true });
      skinContext.imageSmoothingEnabled = false;
      skinContext.clearRect(0, 0, 64, 64);
      skinContext.drawImage(textureCanvas, 0, 0, 64, 64);
      viewer.skinTexture.needsUpdate = true;
      viewer.playerObject.skin.visible = true;
      return;
    }

    viewer.loadSkin(textureCanvas, { model });
    viewerNeedsModelRefresh = false;
  }

  function scheduleViewerTextureUpdate({ forceModel = false } = {}) {
    viewerNeedsModelRefresh = viewerNeedsModelRefresh || Boolean(forceModel);
    if (!viewer || viewerUpdateFrame) return;
    viewerUpdateFrame = requestAnimationFrame(() => {
      viewerUpdateFrame = 0;
      try {
        updateViewerTexture();
        applyViewerVisibility();
        setStatusText(elements.renderState, 'GPU · LIVE');
      } catch (error) {
        console.error('Skin-Textur konnte nicht aktualisiert werden:', error);
        setStatusText(elements.renderState, 'GPU · FEHLER');
      }
    });
  }

  function initializeViewer() {
    if (!window.skinview3d?.SkinViewer) {
      studio.classList.add('skin-render-unavailable');
      setStatusText(elements.renderState, '3D-MODUL FEHLT');
      setImportReport('error', '3D-Vorschau nicht verfügbar', 'Skin-Render-Modul konnte nicht geladen werden.');
      return;
    }

    const width = Math.max(360, Math.round(elements.modelStage.clientWidth || 720));
    const height = Math.max(420, Math.round(elements.modelStage.clientHeight || 700));
    try {
      viewer = new window.skinview3d.SkinViewer({
        canvas: webglCanvas,
        width,
        height,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        skin: textureCanvas,
        model: effectiveModel(),
        background: null,
        fov: 48,
        zoom: 0.76,
        animation: new window.skinview3d.IdleAnimation()
      });
      viewer.controls.enableDamping = true;
      viewer.controls.dampingFactor = 0.075;
      viewer.controls.enablePan = false;
      viewer.controls.rotateSpeed = 0.72;
      viewer.controls.zoomSpeed = 0.75;
      viewer.controls.minDistance = 18;
      viewer.controls.maxDistance = 85;
      viewer.globalLight.intensity = 2.35;
      viewer.cameraLight.intensity = 0.72;
      viewer.autoRotate = false;
      viewer.playerWrapper.rotation.y = -0.3;
      applyViewerVisibility();
      setStatusText(elements.renderState, 'GPU · LIVE');

      const resizeObserver = new ResizeObserver(() => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          if (!viewer || !elements.modelStage) return;
          const nextWidth = Math.max(1, Math.round(elements.modelStage.clientWidth));
          const nextHeight = Math.max(1, Math.round(elements.modelStage.clientHeight));
          if (Math.abs(viewer.width - nextWidth) > 1 || Math.abs(viewer.height - nextHeight) > 1) {
            viewer.setSize(nextWidth, nextHeight);
          }
        });
      });
      resizeObserver.observe(elements.modelStage);
    } catch (error) {
      console.error('GPU-Skin-Viewer konnte nicht initialisiert werden:', error);
      studio.classList.add('skin-render-unavailable');
      setStatusText(elements.renderState, 'WEBGL NICHT VERFÜGBAR');
      setImportReport('error', '3D-Vorschau nicht verfügbar', 'Grafikbeschleunigung konnte nicht gestartet werden.');
    }
  }

  function updateViewerPauseState() {
    if (!viewer) return;
    const skinViewVisible = byId('skin-view')?.classList.contains('active');
    viewer.renderPaused = !skinViewVisible || viewMode === '2d' || document.hidden;
  }

  function runFpsCounter(now) {
    if (destroyed) return;
    fpsFrames += 1;
    if (now - fpsLastTime >= 1000) {
      const measured = Math.round((fpsFrames * 1000) / (now - fpsLastTime));
      setStatusText(elements.fps, `${Math.min(99, measured)} FPS`);
      fpsFrames = 0;
      fpsLastTime = now;
    }
    fpsFrame = requestAnimationFrame(runFpsCounter);
  }

  function setImportReport(state, title, detail) {
    if (!elements.importReport) return;
    elements.importReport.dataset.state = state;
    setStatusText($('b', elements.importReport), title);
    setStatusText($('small', elements.importReport), detail);
  }

  function setSaveState(state) {
    if (!elements.saveState) return;
    elements.saveState.dataset.state = state;
    const label = elements.saveState.lastChild;
    if (label?.nodeType === Node.TEXT_NODE) label.nodeValue = state === 'saving' ? ' Wird gespeichert …' : state === 'error' ? ' Speichern fehlgeschlagen' : ' Lokal gespeichert';
  }

  function serializeProject() {
    return {
      version: 2,
      savedAt: Date.now(),
      modelChoice,
      detectedModel,
      activeLayerId,
      layerSequence,
      importMetadata,
      primaryColor: elements.primaryColor?.value || '#5865f2',
      secondaryColor: elements.secondaryColor?.value || '#ffffff',
      base: baseCanvas.toDataURL('image/png'),
      layers: layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        image: layer.canvas.toDataURL('image/png')
      }))
    };
  }

  function saveProject() {
    window.clearTimeout(saveTimer);
    setSaveState('saving');
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_KEY, JSON.stringify(serializeProject()));
        setSaveState('saved');
      } catch (error) {
        console.warn('Skin-Projekt konnte nicht lokal gespeichert werden:', error);
        setSaveState('error');
      }
    }, 240);
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('PNG-Bild konnte nicht gelesen werden.'));
      image.src = source;
    });
  }

  async function drawDataUrlToCanvas(dataUrl, canvas) {
    if (!dataUrl) return;
    const image = await loadImage(dataUrl);
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 64, 64);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, 64, 64);
  }

  function normalizeSkinSourceCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    const width = source?.width || 64;
    const height = source?.height || 64;
    context.drawImage(source, 0, 0, width, height, 0, 0, 64, 64);
    return canvas;
  }

  function copySkinRegions(sourceCanvas, targetContext, rects) {
    targetContext.imageSmoothingEnabled = false;
    for (const [x, y, width, height] of rects) {
      targetContext.drawImage(sourceCanvas, x, y, width, height, x, y, width, height);
    }
  }

  function countVisiblePixels(context, rects) {
    let count = 0;
    let area = 0;
    for (const [x, y, width, height] of rects) {
      const data = context.getImageData(x, y, width, height).data;
      area += width * height;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 8) count += 1;
      }
    }
    return { count, area, ratio: area ? count / area : 0 };
  }

  async function restoreSnapshot(snapshot, { restoreUI = true } = {}) {
    historyLocked = true;
    try {
      await drawDataUrlToCanvas(snapshot.base, baseCanvas);
      const restoredLayers = [];
      for (const data of snapshot.layers || []) {
        const layer = createLayer(data.name || 'Ebene', data.id);
        layer.visible = data.visible !== false;
        layer.opacity = Math.max(0, Math.min(1, Number(data.opacity ?? 1)));
        await drawDataUrlToCanvas(data.image, layer.canvas);
        restoredLayers.push(layer);
      }
      layers = restoredLayers.length ? restoredLayers : [createLayer('Details', 'paint-1')];
      activeLayerId = layers.some((layer) => layer.id === snapshot.activeLayerId) ? snapshot.activeLayerId : layers[0].id;
      layerSequence = Math.max(Number(snapshot.layerSequence || 1), layers.length);
      modelChoice = ['auto', 'classic', 'slim'].includes(snapshot.modelChoice) ? snapshot.modelChoice : 'auto';
      detectedModel = snapshot.detectedModel === 'slim' ? 'slim' : 'default';
      importMetadata = snapshot.importMetadata || importMetadata;
      if (restoreUI) {
        if (elements.primaryColor && snapshot.primaryColor) elements.primaryColor.value = snapshot.primaryColor;
        if (elements.secondaryColor && snapshot.secondaryColor) elements.secondaryColor.value = snapshot.secondaryColor;
      }
      updateColorUI();
      updateModelUI();
      renderLayerList();
      compositeLayers();
      updateImportReport();
    } finally {
      historyLocked = false;
    }
  }

  async function loadStoredProject() {
    const saved = localStorage.getItem(PROJECT_KEY);
    if (saved) {
      try {
        const project = JSON.parse(saved);
        if (project?.version === 2 && project.base && Array.isArray(project.layers)) {
          const oldStarterSkin = project.importMetadata?.name === 'Standard-Skin'
            && project.layers.length <= 1
            && String(project.layers[0]?.name || '').toLowerCase() === 'details';
          if (oldStarterSkin) {
            localStorage.removeItem(PROJECT_KEY);
            return false;
          }
          await restoreSnapshot(project);
          return true;
        }
      } catch (error) {
        console.warn('Gespeichertes Skin-Projekt ist beschädigt und wird neu aufgebaut:', error);
      }
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      try {
        const legacyProject = JSON.parse(legacy);
        const legacyImage = legacyProject?.image || legacyProject?.skin || legacyProject?.dataUrl;
        if (legacyImage) {
          await drawDataUrlToCanvas(legacyImage, baseCanvas);
          layers = [createLayer('Details', 'paint-1')];
          activeLayerId = layers[0].id;
          modelChoice = legacyProject.model === 'slim' ? 'slim' : 'auto';
          detectedModel = legacyProject.model === 'slim' ? 'slim' : 'default';
          importMetadata = { name: 'Übernommenes Projekt', width: 64, height: 64, note: 'Aus früherer Version migriert' };
          localStorage.removeItem(LEGACY_KEY);
          return true;
        }
      } catch (error) {
        console.warn('Altes Skin-Projekt konnte nicht übernommen werden:', error);
      }
    }
    return false;
  }

  function captureHistory() {
    if (historyLocked) return;
    const snapshot = serializeProject();
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
    saveProject();
  }

  function updateHistoryButtons() {
    if (elements.undo) elements.undo.disabled = historyIndex <= 0;
    if (elements.redo) elements.redo.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  }

  async function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    await restoreSnapshot(history[historyIndex]);
    updateHistoryButtons();
    saveProject();
  }

  async function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    await restoreSnapshot(history[historyIndex]);
    updateHistoryButtons();
    saveProject();
  }

  function updateImportReport() {
    const title = importMetadata.name === 'Fallen Heaven Starter' ? 'Fallen-Heaven-Skin bereit' : `${importMetadata.name} erkannt`;
    const detail = `${importMetadata.width} × ${importMetadata.height} · ${modelLabel()} · ${importMetadata.note}`;
    setImportReport('ready', title, detail);
  }

  function renderLayerThumbnails() {
    $$('.skin-layer-item[data-layer-id]').forEach((item) => {
      const layer = layers.find((entry) => entry.id === item.dataset.layerId);
      const preview = $('.skin-layer-thumb', item);
      if (layer && preview) preview.style.backgroundImage = `url(${layer.canvas.toDataURL('image/png')})`;
    });
  }

  function renderLayerList() {
    if (!elements.layerList) return;
    elements.layerList.replaceChildren();

    const baseItem = document.createElement('button');
    baseItem.type = 'button';
    baseItem.className = 'skin-layer-item skin-layer-base';
    baseItem.disabled = true;
    const baseThumb = document.createElement('span');
    baseThumb.className = 'skin-layer-thumb';
    baseThumb.style.backgroundImage = `url(${baseCanvas.toDataURL('image/png')})`;
    const baseCopy = document.createElement('span');
    baseCopy.className = 'skin-layer-copy';
    const baseTitle = document.createElement('b');
    baseTitle.textContent = importMetadata.name === 'Fallen Heaven Starter' ? 'Fallen-Heaven-Basis' : 'Importierte Basis';
    const baseDetail = document.createElement('small');
    baseDetail.textContent = 'Geschützt · Original bleibt erhalten';
    baseCopy.append(baseTitle, baseDetail);
    const lock = document.createElement('span');
    lock.className = 'skin-layer-lock';
    lock.textContent = '●';
    baseItem.append(baseThumb, baseCopy, lock);
    elements.layerList.append(baseItem);

    [...layers].reverse().forEach((layer) => {
      const item = document.createElement('div');
      item.className = `skin-layer-item${layer.id === activeLayerId ? ' active' : ''}${layer.visible ? '' : ' muted'}`;
      item.dataset.layerId = layer.id;

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'skin-layer-select';
      select.dataset.layerSelect = layer.id;
      const thumb = document.createElement('span');
      thumb.className = 'skin-layer-thumb';
      thumb.style.backgroundImage = `url(${layer.canvas.toDataURL('image/png')})`;
      const copy = document.createElement('span');
      copy.className = 'skin-layer-copy';
      const title = document.createElement('b');
      title.textContent = layer.name;
      const detail = document.createElement('small');
      detail.textContent = `${Math.round(layer.opacity * 100)}% Deckkraft`;
      copy.append(title, detail);
      select.append(thumb, copy);

      const visibleButton = document.createElement('button');
      visibleButton.type = 'button';
      visibleButton.className = 'skin-layer-eye';
      visibleButton.dataset.layerVisibility = layer.id;
      visibleButton.title = layer.visible ? 'Ebene ausblenden' : 'Ebene einblenden';
      visibleButton.textContent = layer.visible ? '◉' : '○';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'skin-layer-delete';
      deleteButton.dataset.layerDelete = layer.id;
      deleteButton.title = 'Ebene löschen';
      deleteButton.textContent = '×';
      deleteButton.disabled = layers.length <= 1;

      item.append(select, visibleButton, deleteButton);
      elements.layerList.append(item);
    });

    setStatusText(elements.layerCount, `${layers.length + 1} EBENEN`);
    const active = getActiveLayer();
    if (elements.layerOpacity) elements.layerOpacity.value = String(Math.round((active?.opacity ?? 1) * 100));
    setStatusText(elements.layerOpacityValue, `${Math.round((active?.opacity ?? 1) * 100)}%`);
  }

  function addLayer(name = `Details ${layers.length + 1}`) {
    const layer = createLayer(name);
    layers.push(layer);
    activeLayerId = layer.id;
    renderLayerList();
    captureHistory();
  }

  function setActiveLayer(id) {
    if (!layers.some((layer) => layer.id === id)) return;
    activeLayerId = id;
    renderLayerList();
  }

  function deleteLayer(id) {
    if (layers.length <= 1) return;
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    layers.splice(index, 1);
    if (activeLayerId === id) activeLayerId = layers[Math.max(0, index - 1)]?.id || layers[0].id;
    renderLayerList();
    compositeLayers();
    captureHistory();
  }

  function setTool(nextTool) {
    if (!TOOL_LABELS[nextTool]) return;
    tool = nextTool;
    $$('[data-skin-tool]').forEach((button) => button.classList.toggle('active', button.dataset.skinTool === tool));
    const statusLabel = $('#skin-status > span:first-child b');
    setStatusText(statusLabel, TOOL_LABELS[tool]);
    studio.dataset.tool = tool;
  }

  function setBrushSize(nextSize) {
    brushSize = Math.max(1, Math.min(4, Number(nextSize) || 1));
    $$('[data-skin-size]').forEach((button) => button.classList.toggle('active', Number(button.dataset.skinSize) === brushSize));
    updateBrushPreview();
  }

  function setViewMode(nextMode) {
    if (!['3d', '2d', 'split'].includes(nextMode)) return;
    viewMode = nextMode;
    workspace.dataset.mode = viewMode;
    $$('[data-skin-mode]').forEach((button) => {
      const active = button.dataset.skinMode === viewMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const hints = $('.skin-workspace-hints');
    if (hints) hints.dataset.mode = viewMode;
    applyTextureZoom();
    updateViewerPauseState();
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 20);
  }

  function applyTextureZoom() {
    const effectiveZoom = viewMode === 'split' ? Math.min(zoom, 6) : zoom;
    textureCanvas.style.width = `${64 * effectiveZoom}px`;
    textureCanvas.style.height = `${64 * effectiveZoom}px`;
    if (elements.canvasWrap) {
      elements.canvasWrap.style.width = `${64 * effectiveZoom}px`;
      elements.canvasWrap.style.height = `${64 * effectiveZoom}px`;
      elements.canvasWrap.style.setProperty('--skin-pixel-size', `${effectiveZoom}px`);
    }
    if (elements.uvOverlay) {
      elements.uvOverlay.style.width = `${64 * effectiveZoom}px`;
      elements.uvOverlay.style.height = `${64 * effectiveZoom}px`;
    }
    setStatusText(elements.zoomLabel, `${effectiveZoom * 100}%`);
    updateBrushPreview();
  }

  function updateColorUI() {
    const primary = (elements.primaryColor?.value || '#5865f2').toUpperCase();
    const secondary = (elements.secondaryColor?.value || '#ffffff').toUpperCase();
    const primaryLabel = $('.skin-primary-color span');
    const secondaryLabel = $('.skin-secondary-color span');
    if (primaryLabel) primaryLabel.style.background = primary;
    if (secondaryLabel) secondaryLabel.style.background = secondary;
    setStatusText(elements.colorValue, primary);
    if (elements.swatches) {
      $$('.skin-swatch', elements.swatches).forEach((swatch) => swatch.classList.toggle('active', swatch.dataset.color?.toUpperCase() === primary));
    }
  }

  function renderSwatches() {
    if (!elements.swatches) return;
    elements.swatches.replaceChildren();
    const label = document.createElement('span');
    label.textContent = 'PALETTE';
    elements.swatches.append(label);
    PALETTE.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skin-swatch';
      button.dataset.color = color;
      button.style.background = color;
      button.title = color.toUpperCase();
      elements.swatches.append(button);
    });
    updateColorUI();
  }

  function canvasCoordinates(event) {
    const rect = textureCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(63, Math.floor(((event.clientX - rect.left) / rect.width) * 64))),
      y: Math.max(0, Math.min(63, Math.floor(((event.clientY - rect.top) / rect.height) * 64)))
    };
  }

  function updateBrushPreview(event = null) {
    if (!elements.brushPreview || !elements.canvasWrap) return;
    const effectiveZoom = viewMode === 'split' ? Math.min(zoom, 6) : zoom;
    elements.brushPreview.style.width = `${brushSize * effectiveZoom}px`;
    elements.brushPreview.style.height = `${brushSize * effectiveZoom}px`;
    if (event) {
      const point = canvasCoordinates(event);
      elements.brushPreview.style.left = `${point.x * effectiveZoom}px`;
      elements.brushPreview.style.top = `${point.y * effectiveZoom}px`;
      elements.brushPreview.classList.add('visible');
      setStatusText(elements.coordinates, `X ${String(point.x).padStart(2, '0')} · Y ${String(point.y).padStart(2, '0')}`);
    }
  }

  function adjustedShadeColor(hex, x, y) {
    const rgba = colorHexToRgba(hex);
    const amount = ((x + y) % 3 - 1) * 18;
    return rgbaToHex(rgba.r + amount, rgba.g + amount, rgba.b + amount);
  }

  function shiftColor(hex, amount) {
    const color = colorHexToRgba(hex);
    return rgbaToHex(color.r + amount, color.g + amount, color.b + amount);
  }

  function mixColor(hexA, hexB, amount = 0.5) {
    const a = colorHexToRgba(hexA);
    const b = colorHexToRgba(hexB);
    const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
    return rgbaToHex(
      Math.round(a.r + (b.r - a.r) * ratio),
      Math.round(a.g + (b.g - a.g) * ratio),
      Math.round(a.b + (b.b - a.b) * ratio)
    );
  }

  function stringSeed(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function pixelNoise(seed, x, y) {
    let value = (seed ^ Math.imul(x + 101, 374761393) ^ Math.imul(y + 271, 668265263)) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function paintTexturedRect(context, rect, color, options = {}) {
    const [x, y, width, height] = rect;
    const base = colorHexToRgba(color);
    const seed = Number(options.seed || 1);
    const noise = Number(options.noise ?? 18);
    const gradient = Number(options.gradient ?? 8);
    const contrast = Number(options.contrast ?? 1);
    const transparentEvery = Number(options.transparentEvery || 0);
    const alpha = Math.max(0, Math.min(1, Number(options.alpha ?? 1)));

    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) {
        if (transparentEvery > 0 && Math.floor(pixelNoise(seed + 97, px, py) * transparentEvery) === 0) continue;
        const nx = width <= 1 ? 0.5 : (px - x) / (width - 1);
        const ny = height <= 1 ? 0.5 : (py - y) / (height - 1);
        const edge = (px === x || py === y ? 10 : 0) + (px === x + width - 1 || py === y + height - 1 ? -12 : 0);
        const diagonal = ((1 - ny) * 4) - (nx * gradient);
        const random = (pixelNoise(seed, px, py) - 0.5) * noise;
        const checker = ((px + py + seed) % 5 === 0 ? 6 : 0) - ((px * 3 + py + seed) % 7 === 0 ? 7 : 0);
        const shade = Math.round((edge + diagonal + random + checker) * contrast);
        const fill = rgbaToHex(base.r + shade, base.g + shade, base.b + shade);
        if (alpha >= 0.99) {
          context.fillStyle = fill;
        } else {
          const rgba = colorHexToRgba(fill);
          context.fillStyle = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`;
        }
        context.fillRect(px, py, 1, 1);
      }
    }
  }

  function paintTexturedSet(context, rects, color, seed, options = {}) {
    rects.forEach((rect, index) => {
      const tint = Number(options.tint || 0);
      const amount = index % 3 === 0 ? tint : index % 3 === 1 ? -tint : Math.round(tint / 2);
      paintTexturedRect(context, rect, amount ? shiftColor(color, amount) : color, {
        ...options,
        seed: seed + index * 53
      });
    });
  }

  function paintSparsePixels(context, rects, color, seed, density = 0.08) {
    const resolvedDensity = Math.max(0, Math.min(0.45, Number(density) || 0));
    for (const [x, y, width, height] of rects) {
      for (let py = y; py < y + height; py += 1) {
        for (let px = x; px < x + width; px += 1) {
          if (pixelNoise(seed, px, py) > resolvedDensity) continue;
          context.fillStyle = pixelNoise(seed + 11, px, py) > 0.5 ? color : shiftColor(color, -24);
          context.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  function normalizeRecipeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
  }

  function keywordColor(prompt, fallback) {
    const explicit = String(prompt || '').match(/#[0-9a-f]{6}/i)?.[0];
    if (explicit) return explicit.toUpperCase();
    const colors = [
      [/\b(?:violett|lila|purple|magenta)\b/i, '#7657E8'],
      [/\b(?:blau|blue|ice|eis)\b/i, '#3976D9'],
      [/\b(?:rot|red|feuer|fire)\b/i, '#C83D52'],
      [/\b(?:grün|green|wald|forest)\b/i, '#2F8A63'],
      [/\b(?:grau|gray|grey|silber|silver|stahl|steel)\b/i, '#343744'],
      [/\b(?:gold|gelb|yellow)\b/i, '#D8A630'],
      [/\b(?:pink|rosa)\b/i, '#D9579F'],
      [/\b(?:weiß|white|hell)\b/i, '#D9DEEB'],
      [/\b(?:schwarz|black|dunkel|dark|shadow|schatten|fallen|heaven)\b/i, '#090B18']
    ];
    return colors.find(([expression]) => expression.test(prompt))?.[1] || fallback;
  }

  function createLocalSkinRecipe(prompt, style, detail) {
    const normalized = String(prompt || '').toLowerCase();
    const cyber = /cyber|neon|future|tech|robot/.test(normalized) || style === 'cyber';
    const fantasy = /ritter|knight|magier|mage|demon|dämon|engel|angel|fantasy|rune/.test(normalized) || style === 'fantasy';
    const streetwear = /hoodie|street|urban|skater|modern/.test(normalized) || style === 'streetwear';
    const minimal = style === 'minimal' || /minimal|clean|schlicht/.test(normalized);
    const fallen = /fallen heaven|fallen|heaven|engel|angel|schatten|shadow/.test(normalized);
    const primary = keywordColor(prompt, cyber ? '#24213F' : fantasy ? '#303445' : streetwear ? '#24283A' : '#27304A');
    const accent = /grün|green/.test(normalized) ? '#55E6A5' : /rot|red|feuer|fire/.test(normalized) ? '#FF5D6C' : /gold|gelb|yellow/.test(normalized) ? '#FFD061' : fallen ? '#9D8CFF' : cyber ? '#8D7CFF' : '#6D8CFF';
    return {
      name: (prompt.split(/[,.;]/)[0] || 'Smart Entwurf').trim().slice(0, 38) || 'Smart Entwurf',
      style: cyber ? 'cyber' : fantasy ? 'fantasy' : streetwear ? 'streetwear' : minimal ? 'minimal' : (style === 'auto' ? 'modern' : style),
      archetype: /rüstung|armor|ritter|knight|samurai/.test(normalized) ? 'armor' : /robe|magier|mage/.test(normalized) ? 'robe' : /anzug|suit/.test(normalized) ? 'suit' : /hood|kapuze/.test(normalized) ? 'hoodie' : 'jacket',
      pattern: /rune|magie|magic/.test(normalized) ? 'runes' : /streifen|stripe/.test(normalized) ? 'stripes' : /asym/.test(normalized) ? 'asymmetric' : minimal ? 'clean' : 'panels',
      detail,
      palette: {
        primary,
        secondary: /dunkel|dark|schwarz|black|shadow|schatten|fallen|heaven/.test(normalized) ? '#1A1D2A' : shiftColor(primary, 25),
        accent,
        skin: /blass|pale/.test(normalized) ? '#D4A487' : /dunkle haut|dark skin/.test(normalized) ? '#744630' : '#B97A56',
        hair: /weißes haar|white hair/.test(normalized) ? '#D8DCE4' : /blondes haar|blond/.test(normalized) ? '#C8A25B' : fallen ? '#070707' : '#281B1A',
        eyes: accent
      },
      hood: /hood|kapuze|assassin/.test(normalized),
      mask: /maske|mask|ninja|samurai|robot/.test(normalized),
      gloves: !/ohne handschuhe|no gloves/.test(normalized),
      boots: true,
      glowing: cyber || /leucht|glow|neon|magie|magic/.test(normalized),
      summary: 'Lokal aus Beschreibung, Stil und Farbstimmung aufgebaut.'
    };
  }

  function normalizedSkinRecipe(recipe, prompt, style, detail) {
    const fallback = createLocalSkinRecipe(prompt, style, detail);
    const value = recipe && typeof recipe === 'object' ? recipe : {};
    const allowedStyles = ['modern', 'fantasy', 'cyber', 'streetwear', 'minimal'];
    const allowedArchetypes = ['hoodie', 'armor', 'jacket', 'robe', 'suit', 'adventurer'];
    const allowedPatterns = ['clean', 'stripes', 'panels', 'runes', 'gradient', 'asymmetric'];
    return {
      ...fallback,
      ...value,
      name: String(value.name || fallback.name).replace(/[<>]/g, '').slice(0, 38),
      style: allowedStyles.includes(value.style) ? value.style : fallback.style,
      archetype: allowedArchetypes.includes(value.archetype) ? value.archetype : fallback.archetype,
      pattern: allowedPatterns.includes(value.pattern) ? value.pattern : fallback.pattern,
      detail: ['rich', 'balanced', 'clean'].includes(detail) ? detail : 'balanced',
      palette: {
        primary: normalizeRecipeColor(value.palette?.primary, fallback.palette.primary),
        secondary: normalizeRecipeColor(value.palette?.secondary, fallback.palette.secondary),
        accent: normalizeRecipeColor(value.palette?.accent, fallback.palette.accent),
        skin: normalizeRecipeColor(value.palette?.skin, fallback.palette.skin),
        hair: normalizeRecipeColor(value.palette?.hair, fallback.palette.hair),
        eyes: normalizeRecipeColor(value.palette?.eyes, fallback.palette.eyes)
      }
    };
  }

  function paintRect(context, rect, color) {
    context.fillStyle = color;
    context.fillRect(rect[0], rect[1], rect[2], rect[3]);
  }

  function drawAiSkinBaseLayer(layer, recipe, seed) {
    const context = layer.context;
    context.clearRect(0, 0, 64, 64);
    const { primary, secondary, skin } = recipe.palette;
    const dark = shiftColor(primary, -38);
    const boot = shiftColor(primary, -62);
    const sleeve = recipe.archetype === 'robe' ? primary : secondary;
    const faceRects = [[8, 0, 8, 8], [16, 0, 8, 8], [0, 8, 8, 8], [8, 8, 8, 8], [16, 8, 8, 8], [24, 8, 8, 8]];
    const torsoRects = [[20, 16, 8, 4], [28, 16, 8, 4], [16, 20, 4, 12], [20, 20, 8, 12], [28, 20, 4, 12], [32, 20, 8, 12]];
    const rightArmRects = [[44, 16, 4, 4], [48, 16, 4, 4], [40, 20, 4, 12], [44, 20, 4, 12], [48, 20, 4, 12], [52, 20, 4, 12]];
    const leftArmRects = [[36, 48, 4, 4], [40, 48, 4, 4], [32, 52, 4, 12], [36, 52, 4, 12], [40, 52, 4, 12], [44, 52, 4, 12]];
    const rightLegRects = [[4, 16, 4, 4], [8, 16, 4, 4], [0, 20, 4, 12], [4, 20, 4, 12], [8, 20, 4, 12], [12, 20, 4, 12]];
    const leftLegRects = [[20, 48, 4, 4], [24, 48, 4, 4], [16, 52, 4, 12], [20, 52, 4, 12], [24, 52, 4, 12], [28, 52, 4, 12]];

    const noise = recipe.detail === 'clean' ? 7 : recipe.detail === 'rich' ? 22 : 15;
    paintTexturedSet(context, faceRects, skin, seed + 100, { noise, tint: -9, contrast: 0.85 });
    paintTexturedSet(context, torsoRects, primary, seed + 200, { noise: noise + 3, tint: -14, contrast: 1.05 });
    paintTexturedSet(context, rightArmRects, sleeve, seed + 300, { noise, tint: -12, contrast: 1 });
    paintTexturedSet(context, leftArmRects, sleeve, seed + 400, { noise, tint: -12, contrast: 1 });
    paintTexturedSet(context, rightLegRects, dark, seed + 500, { noise, tint: -8, contrast: 1.05 });
    paintTexturedSet(context, leftLegRects, dark, seed + 600, { noise, tint: -8, contrast: 1.05 });

    if (recipe.archetype === 'robe') {
      paintTexturedRect(context, [20, 27, 8, 5], shiftColor(primary, -16), { seed: seed + 701, noise: noise + 4 });
      paintTexturedRect(context, [4, 23, 4, 9], shiftColor(primary, -24), { seed: seed + 702, noise });
      paintTexturedRect(context, [20, 55, 4, 9], shiftColor(primary, -24), { seed: seed + 703, noise });
    }

    if (recipe.archetype === 'armor') {
      paintTexturedRect(context, [20, 20, 8, 10], mixColor(primary, '#D7DCE9', 0.25), { seed: seed + 720, noise: noise + 2, gradient: 5 });
      paintTexturedRect(context, [44, 20, 4, 8], mixColor(sleeve, '#D7DCE9', 0.18), { seed: seed + 721, noise });
      paintTexturedRect(context, [36, 52, 4, 8], mixColor(sleeve, '#D7DCE9', 0.18), { seed: seed + 722, noise });
    }

    if (recipe.boots) {
      paintTexturedRect(context, [4, 28, 4, 4], boot, { seed: seed + 730, noise: noise + 2 });
      paintTexturedRect(context, [20, 60, 4, 4], boot, { seed: seed + 731, noise: noise + 2 });
    }
  }

  function drawAiSkinDetailLayer(layer, recipe, seed) {
    const context = layer.context;
    context.clearRect(0, 0, 64, 64);
    const { primary, secondary, accent, skin, hair, eyes } = recipe.palette;
    const dark = shiftColor(primary, -44);
    const boot = shiftColor(primary, -62);
    const light = shiftColor(primary, 32);
    const trim = mixColor(accent, '#FFFFFF', recipe.detail === 'clean' ? 0.05 : 0.18);

    // Hair, face and readable one-pixel expressions are separated from the base.
    context.fillStyle = hair;
    context.fillRect(8, 8, 8, 3);
    context.fillRect(0, 8, 8, 4);
    context.fillRect(16, 8, 8, 4);
    context.fillRect(24, 8, 8, 7);
    paintSparsePixels(context, [[8, 8, 8, 5], [0, 8, 8, 5], [16, 8, 8, 5], [24, 8, 8, 7]], shiftColor(hair, 36), seed + 810, recipe.detail === 'rich' ? 0.2 : 0.11);
    context.fillStyle = eyes;
    context.fillRect(10, 12, 2, 1);
    context.fillRect(14, 12, 2, 1);
    context.fillStyle = shiftColor(skin, -28);
    context.fillRect(12, 14, 2, 1);
    if (recipe.mask) {
      context.fillStyle = dark;
      context.fillRect(8, 13, 8, 3);
      context.fillStyle = accent;
      context.fillRect(11, 13, 3, 1);
    }

    // Seam language and chest identity stay readable at native 64 × 64.
    context.fillStyle = mixColor(secondary, primary, 0.45);
    context.fillRect(20, 20, 8, 1);
    context.fillRect(20, 31, 8, 1);
    context.fillRect(16, 23, 1, 7);
    context.fillRect(31, 23, 1, 7);
    if (recipe.archetype === 'armor') {
      context.fillStyle = light;
      context.fillRect(20, 22, 2, 7);
      context.fillRect(26, 22, 2, 7);
      context.fillStyle = accent;
      context.fillRect(23, 23, 2, 3);
      context.fillStyle = dark;
      context.fillRect(22, 29, 4, 1);
    } else if (recipe.archetype === 'suit') {
      context.fillStyle = '#E5E8EF';
      context.fillRect(23, 20, 2, 7);
      context.fillStyle = accent;
      context.fillRect(23, 23, 2, 4);
    } else {
      context.fillStyle = trim;
      context.fillRect(23, 21, 2, 9);
      context.fillStyle = light;
      context.fillRect(21, 23, 1, 6);
      context.fillRect(26, 23, 1, 6);
    }

    if (recipe.pattern === 'stripes') {
      context.fillStyle = accent;
      for (let y = 22; y < 31; y += 3) context.fillRect(20, y, 8, 1);
      context.fillRect(44, 22, 4, 1);
      context.fillRect(36, 54, 4, 1);
    } else if (recipe.pattern === 'runes') {
      context.fillStyle = trim;
      context.fillRect(22, 22, 1, 2);
      context.fillRect(22, 24, 3, 1);
      context.fillRect(24, 24, 1, 3);
      context.fillRect(23, 27, 2, 1);
      context.fillRect(45, 23, 1, 2);
      context.fillRect(37, 56, 1, 2);
    } else if (recipe.pattern === 'asymmetric') {
      context.fillStyle = trim;
      context.fillRect(20, 21, 2, 10);
      context.fillRect(44, 20, 2, 9);
    } else if (recipe.pattern === 'gradient') {
      paintSparsePixels(context, [[20, 20, 8, 12], [44, 20, 4, 12], [36, 52, 4, 12]], trim, seed + 830, recipe.detail === 'rich' ? 0.18 : 0.1);
    } else if (recipe.pattern === 'panels' || recipe.detail === 'rich') {
      context.fillStyle = light;
      context.fillRect(21, 22, 2, 3);
      context.fillRect(25, 22, 2, 3);
      context.fillStyle = dark;
      context.fillRect(21, 27, 6, 2);
    }

    // Hands, gloves, boots and pixel noise sit on their own editable layer.
    if (!recipe.gloves) {
      context.fillStyle = skin;
      context.fillRect(44, 29, 4, 3);
      context.fillRect(36, 61, 4, 3);
    } else {
      context.fillStyle = dark;
      context.fillRect(44, 29, 4, 3);
      context.fillRect(36, 61, 4, 3);
      context.fillStyle = accent;
      context.fillRect(44, 29, 4, 1);
      context.fillRect(36, 61, 4, 1);
    }
    if (recipe.boots) {
      context.fillStyle = boot;
      context.fillRect(4, 28, 4, 4);
      context.fillRect(20, 60, 4, 4);
      context.fillStyle = accent;
      context.fillRect(4, 28, 4, 1);
      context.fillRect(20, 60, 4, 1);
    }

    const density = recipe.detail === 'clean' ? 0.035 : recipe.detail === 'rich' ? 0.16 : 0.085;
    paintSparsePixels(context, [[20, 20, 8, 12], [44, 20, 4, 12], [36, 52, 4, 12], [4, 20, 4, 12], [20, 52, 4, 12]], shiftColor(primary, 34), seed + 840, density);
    paintSparsePixels(context, [[20, 20, 8, 12], [44, 20, 4, 12], [36, 52, 4, 12], [4, 20, 4, 12], [20, 52, 4, 12]], shiftColor(primary, -38), seed + 850, density * 0.75);
  }

  function drawAiSkinOverlayLayer(layer, recipe, seed) {
    const context = layer.context;
    context.clearRect(0, 0, 64, 64);
    const { primary, secondary, accent, hair } = recipe.palette;
    const shell = recipe.archetype === 'armor' ? mixColor(primary, '#D7DCE9', 0.28) : shiftColor(primary, -14);
    const trim = mixColor(accent, '#FFFFFF', recipe.glowing ? 0.26 : 0.08);

    // True Minecraft outer layer: hood / hair shell, jacket shoulders and trim.
    if (recipe.hood || recipe.archetype === 'hoodie') {
      paintTexturedRect(context, [40, 8, 8, 8], shell, { seed: seed + 900, noise: 18, gradient: 4 });
      paintTexturedRect(context, [32, 8, 8, 8], shiftColor(shell, -6), { seed: seed + 901, noise: 16, gradient: 4 });
      paintTexturedRect(context, [48, 8, 8, 8], shiftColor(shell, -8), { seed: seed + 902, noise: 16, gradient: 4 });
      paintTexturedRect(context, [56, 8, 8, 8], shiftColor(shell, -18), { seed: seed + 903, noise: 14, gradient: 4 });
      paintTexturedRect(context, [40, 0, 8, 8], shiftColor(shell, 6), { seed: seed + 904, noise: 14, gradient: 3 });
      context.fillStyle = accent;
      context.fillRect(40, 10, 1, 5);
      context.fillRect(47, 10, 1, 5);
    } else {
      paintTexturedRect(context, [40, 8, 8, 2], shiftColor(hair, 22), { seed: seed + 910, noise: 18 });
      paintTexturedRect(context, [32, 8, 8, 3], hair, { seed: seed + 911, noise: 14, transparentEvery: 5 });
      paintTexturedRect(context, [48, 8, 8, 3], hair, { seed: seed + 912, noise: 14, transparentEvery: 5 });
    }

    paintTexturedRect(context, [20, 36, 8, 12], mixColor(primary, secondary, 0.34), { seed: seed + 930, noise: 18, gradient: 6 });
    paintTexturedRect(context, [16, 36, 4, 4], shiftColor(secondary, -10), { seed: seed + 931, noise: 16 });
    paintTexturedRect(context, [28, 36, 4, 4], shiftColor(secondary, -16), { seed: seed + 932, noise: 16 });
    paintTexturedRect(context, [44, 36, 4, 4], shiftColor(secondary, -10), { seed: seed + 933, noise: 14 });
    paintTexturedRect(context, [52, 52, 4, 4], shiftColor(secondary, -10), { seed: seed + 934, noise: 14 });

    if (recipe.archetype === 'armor') {
      paintTexturedRect(context, [20, 36, 8, 5], shell, { seed: seed + 940, noise: 20 });
      paintTexturedRect(context, [44, 36, 4, 6], shell, { seed: seed + 941, noise: 16 });
      paintTexturedRect(context, [52, 52, 4, 6], shell, { seed: seed + 942, noise: 16 });
      context.fillStyle = shiftColor(shell, 28);
      context.fillRect(21, 37, 6, 1);
    }

    paintTexturedRect(context, [4, 36, 4, 4], shiftColor(primary, -38), { seed: seed + 950, noise: 13 });
    paintTexturedRect(context, [4, 52, 4, 4], shiftColor(primary, -38), { seed: seed + 951, noise: 13 });
    if (recipe.glowing) {
      context.fillStyle = trim;
      context.fillRect(20, 38, 1, 9);
      context.fillRect(27, 38, 1, 9);
      context.fillRect(44, 36, 1, 8);
      context.fillRect(52, 52, 1, 8);
      context.fillRect(4, 36, 1, 8);
      context.fillRect(4, 52, 1, 8);
    }

    if (recipe.detail === 'rich') {
      paintSparsePixels(context, [[20, 36, 8, 12], [44, 36, 4, 12], [52, 52, 4, 12], [4, 36, 4, 12], [4, 52, 4, 12]], trim, seed + 960, 0.12);
    }
  }

  function createAiSkinLayers(recipe) {
    const seed = stringSeed(`${recipe.name}|${recipe.style}|${recipe.archetype}|${recipe.pattern}|${Object.values(recipe.palette || {}).join('|')}`);
    const baseLayer = createLayer(`AI · Basis · ${recipe.name}`);
    const detailLayer = createLayer('AI · Schatten & Pixel');
    const overlayLayer = createLayer('AI · Overlay / 2. Ebene');
    drawAiSkinBaseLayer(baseLayer, recipe, seed);
    drawAiSkinDetailLayer(detailLayer, recipe, seed);
    drawAiSkinOverlayLayer(overlayLayer, recipe, seed);
    return [baseLayer, detailLayer, overlayLayer];
  }

  function setAiStatus(state, text) {
    if (!elements.aiStatus) return;
    elements.aiStatus.dataset.state = state;
    const textNode = Array.from(elements.aiStatus.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = text;
  }

  function applyAiRecipe(recipe, provider) {
    const generatedLayers = createAiSkinLayers(recipe);
    layers.push(...generatedLayers);
    activeLayerId = generatedLayers[generatedLayers.length - 1].id;
    renderLayerList();
    compositeLayers();
    captureHistory();
    setViewMode('split');
    setAiStatus('success', provider === 'ollama'
      ? `AI-Entwurf „${recipe.name}“ wurde als 3 echte Ebenen hinzugefügt.`
      : `Smart-Entwurf „${recipe.name}“ wurde offline als 3 echte Ebenen hinzugefügt.`);
    setImportReport('ready', `${recipe.name} hinzugefügt`, `${recipe.style} · ${recipe.archetype} · Basis, Pixel & Overlay getrennt`);
  }

  async function generateAiSkin() {
    const prompt = String(elements.aiPrompt?.value || '').trim();
    if (prompt.length < 3) {
      setAiStatus('error', ' Bitte beschreibe kurz, wie der Skin aussehen soll.');
      elements.aiPrompt?.focus();
      return;
    }
    const style = elements.aiStyle?.value || 'auto';
    const detail = elements.aiDetail?.value || 'balanced';
    if (elements.aiGenerate) elements.aiGenerate.disabled = true;
    setAiStatus('loading', ' Lokale AI analysiert Stil, Kontrast und Pixelaufbau …');
    let recipe = null;
    let provider = 'smart';
    try {
      const guildId = localStorage.getItem('fh-selected-guild') || '';
      if (guildId && window.fallenHeaven?.apiRequest) {
        const response = await window.fallenHeaven.apiRequest({
          path: `/api/guild/${encodeURIComponent(guildId)}/skin/assistant`,
          method: 'POST',
          body: { prompt, style, detail }
        });
        if (response?.ok && response.data?.result?.recipe) {
          recipe = response.data.result.recipe;
          provider = response.data.result.provider || 'ollama';
        }
      }
    } catch (error) {
      console.warn('Lokale Skin-AI ist nicht erreichbar; Smart-Generator übernimmt:', error);
    }
    try {
      const normalized = normalizedSkinRecipe(recipe, prompt, style, detail);
      applyAiRecipe(normalized, provider);
    } catch (error) {
      console.error('AI-Skin konnte nicht aufgebaut werden:', error);
      setAiStatus('error', ` Entwurf fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`);
    } finally {
      if (elements.aiGenerate) elements.aiGenerate.disabled = false;
    }
  }

  function paintBrush(point, color, erase = false) {
    const layer = getActiveLayer();
    if (!layer) return;
    const origin = Math.floor((brushSize - 1) / 2);
    for (let offsetY = 0; offsetY < brushSize; offsetY += 1) {
      for (let offsetX = 0; offsetX < brushSize; offsetX += 1) {
        const x = point.x + offsetX - origin;
        const y = point.y + offsetY - origin;
        const resolvedColor = tool === 'shade' ? adjustedShadeColor(color, x, y) : color;
        setPixel(layer.context, x, y, resolvedColor, erase);
        if (elements.mirror?.checked) setPixel(layer.context, 63 - x, y, resolvedColor, erase);
      }
    }
  }

  function drawLine(from, to, color, erase) {
    let x0 = from.x;
    let y0 = from.y;
    const x1 = to.x;
    const y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx - dy;
    while (true) {
      paintBrush({ x: x0, y: y0 }, color, erase);
      if (x0 === x1 && y0 === y1) break;
      const doubled = error * 2;
      if (doubled > -dy) {
        error -= dy;
        x0 += sx;
      }
      if (doubled < dx) {
        error += dx;
        y0 += sy;
      }
    }
  }

  function pixelMatches(data, index, target) {
    return data[index] === target[0] && data[index + 1] === target[1] && data[index + 2] === target[2] && data[index + 3] === target[3];
  }

  function floodFill(point, color) {
    const layer = getActiveLayer();
    if (!layer) return;
    const composite = compositeContext.getImageData(0, 0, 64, 64);
    const source = composite.data;
    const startIndex = (point.y * 64 + point.x) * 4;
    const target = [source[startIndex], source[startIndex + 1], source[startIndex + 2], source[startIndex + 3]];
    const replacement = colorHexToRgba(color);
    if (target[0] === replacement.r && target[1] === replacement.g && target[2] === replacement.b && target[3] === replacement.a) return;
    const visited = new Uint8Array(4096);
    const queue = [point.x, point.y];
    while (queue.length) {
      const y = queue.pop();
      const x = queue.pop();
      if (x < 0 || x >= 64 || y < 0 || y >= 64) continue;
      const pixelIndex = y * 64 + x;
      if (visited[pixelIndex]) continue;
      visited[pixelIndex] = 1;
      const sourceIndex = pixelIndex * 4;
      if (!pixelMatches(source, sourceIndex, target)) continue;
      setPixel(layer.context, x, y, color, false);
      queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }

  function pickColor(point, secondary = false) {
    const pixel = compositeContext.getImageData(point.x, point.y, 1, 1).data;
    if (pixel[3] === 0) return;
    const color = rgbaToHex(pixel[0], pixel[1], pixel[2]);
    const input = secondary ? elements.secondaryColor : elements.primaryColor;
    if (input) input.value = color;
    updateColorUI();
  }

  function usesSecondaryColor(event) {
    return event.button === 2 || (event.buttons & 2) === 2;
  }

  function paintStrokeStart(point, event) {
    const resolvedPoint = { x: point.x, y: point.y, source: point.source || '2d' };
    const secondary = usesSecondaryColor(event);
    const color = secondary ? elements.secondaryColor.value : elements.primaryColor.value;
    if (tool === 'picker') {
      pickColor(resolvedPoint, secondary);
      return false;
    }
    if (tool === 'fill') {
      floodFill(resolvedPoint, color);
      compositeLayers();
      captureHistory();
      return false;
    }
    drawing = true;
    lastPixel = resolvedPoint;
    paintBrush(resolvedPoint, color, tool === 'eraser');
    compositeLayers();
    return true;
  }

  function paintStrokeMove(point, event) {
    if (!drawing) return;
    const resolvedPoint = { x: point.x, y: point.y, source: point.source || '2d' };
    if (lastPixel?.x === resolvedPoint.x && lastPixel?.y === resolvedPoint.y) return;
    const color = usesSecondaryColor(event) ? elements.secondaryColor.value : elements.primaryColor.value;
    const uvJump = Math.max(Math.abs((lastPixel?.x ?? resolvedPoint.x) - resolvedPoint.x), Math.abs((lastPixel?.y ?? resolvedPoint.y) - resolvedPoint.y));
    const crossedUvIsland = (lastPixel?.source === '3d' || resolvedPoint.source === '3d') && uvJump > Math.max(6, brushSize * 4);
    if (crossedUvIsland) {
      paintBrush(resolvedPoint, color, tool === 'eraser');
    } else {
      drawLine(lastPixel || resolvedPoint, resolvedPoint, color, tool === 'eraser');
    }
    lastPixel = resolvedPoint;
    compositeLayers();
  }

  function ensureModelRaycaster() {
    const Three = window.THREE;
    if (!Three?.Raycaster || !Three?.Vector2) return null;
    if (!modelRaycaster) modelRaycaster = new Three.Raycaster();
    if (!modelPointer) modelPointer = new Three.Vector2();
    return { raycaster: modelRaycaster, pointer: modelPointer };
  }

  function isPaintableModelMesh(object) {
    if (!object?.isMesh || typeof object.raycast !== 'function') return false;
    let cursor = object;
    while (cursor) {
      if (cursor.visible === false) return false;
      if (cursor === viewer?.playerObject?.skin) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function collectModelPaintTargets() {
    const targets = [];
    const root = viewer?.playerObject?.skin;
    if (!root?.traverse) return targets;
    root.traverse((object) => {
      if (isPaintableModelMesh(object)) targets.push(object);
    });
    return targets;
  }

  function modelCoordinates(event) {
    if (!viewer) return null;
    const tools = ensureModelRaycaster();
    if (!tools) return null;
    const rect = webglCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    tools.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    tools.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    viewer.camera?.updateMatrixWorld?.();
    viewer.playerObject?.updateMatrixWorld?.(true);
    tools.raycaster.setFromCamera(tools.pointer, viewer.camera);
    const hit = tools.raycaster.intersectObjects(collectModelPaintTargets(), false)
      .find((entry) => entry?.uv && isPaintableModelMesh(entry.object));
    if (!hit?.uv) return null;
    const u = Math.max(0, Math.min(0.999999, hit.uv.x));
    const v = Math.max(0, Math.min(0.999999, hit.uv.y));
    return {
      x: Math.max(0, Math.min(63, Math.floor(u * 64))),
      y: Math.max(0, Math.min(63, Math.floor((1 - v) * 64))),
      source: '3d'
    };
  }

  function updateModelBrushPreview(event, point = null) {
    if (!elements.modelBrushDot) return;
    if (!point || viewMode === '2d') {
      elements.modelBrushDot.classList.remove('visible');
      return;
    }
    const rect = elements.modelStage.getBoundingClientRect();
    const size = Math.max(14, 10 + brushSize * 7);
    elements.modelBrushDot.style.width = `${size}px`;
    elements.modelBrushDot.style.height = `${size}px`;
    elements.modelBrushDot.style.left = `${event.clientX - rect.left}px`;
    elements.modelBrushDot.style.top = `${event.clientY - rect.top}px`;
    elements.modelBrushDot.classList.add('visible');
    setStatusText(elements.coordinates, `3D · X ${String(point.x).padStart(2, '0')} · Y ${String(point.y).padStart(2, '0')}`);
  }

  function shouldPaintOnModel(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.type === 'pointerdown' && event.button !== 0 && event.button !== 2) return false;
    if (event.type === 'pointermove' && drawing && event.buttons === 0) return false;
    return Boolean(viewer && viewMode !== '2d' && ensureModelRaycaster());
  }

  function handleModelPointerDown(event) {
    if (!shouldPaintOnModel(event)) return;
    const point = modelCoordinates(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    webglCanvas.setPointerCapture?.(event.pointerId);
    if (viewer?.controls) viewer.controls.enabled = false;
    elements.modelStage?.classList.add('is-model-painting');
    updateModelBrushPreview(event, point);
    modelPaintingActive = paintStrokeStart(point, event);
    if (!modelPaintingActive) {
      if (viewer?.controls) viewer.controls.enabled = true;
      elements.modelStage?.classList.remove('is-model-painting');
    }
  }

  function handleModelPointerMove(event) {
    const point = modelCoordinates(event);
    updateModelBrushPreview(event, point);
    if (!modelPaintingActive || !drawing) return;
    event.preventDefault();
    event.stopPropagation();
    if (point) paintStrokeMove(point, event);
  }

  function finishModelPointer(event) {
    if (modelPaintingActive) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }
    finishDrawing();
  }

  function handleCanvasPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    textureCanvas.setPointerCapture?.(event.pointerId);
    paintStrokeStart({ ...canvasCoordinates(event), source: '2d' }, event);
  }

  function handleCanvasPointerMove(event) {
    updateBrushPreview(event);
    if (!drawing) return;
    paintStrokeMove({ ...canvasCoordinates(event), source: '2d' }, event);
  }

  function finishDrawing() {
    if (modelPaintingActive) {
      modelPaintingActive = false;
      if (viewer?.controls) viewer.controls.enabled = true;
      elements.modelStage?.classList.remove('is-model-painting');
    }
    if (!drawing) return;
    drawing = false;
    lastPixel = null;
    captureHistory();
  }

  function drawUvOverlay() {
    if (!elements.uvOverlay) return;
    const context = elements.uvOverlay.getContext('2d');
    context.clearRect(0, 0, 512, 512);
    context.scale(8, 8);
    context.lineWidth = 0.18;
    context.font = '1.25px sans-serif';
    context.textBaseline = 'top';
    const groups = [
      { label: 'KOPF', color: '#7c5cff', rects: [[0, 0, 32, 16], [32, 0, 32, 16]] },
      { label: 'KÖRPER', color: '#00d9b7', rects: [[16, 16, 24, 16], [16, 32, 24, 16]] },
      { label: 'ARM R', color: '#f0b232', rects: [[40, 16, 16, 16], [40, 32, 16, 16]] },
      { label: 'ARM L', color: '#f0b232', rects: [[32, 48, 16, 16]] },
      { label: 'BEIN R', color: '#4f8cff', rects: [[0, 16, 16, 16], [0, 32, 16, 16]] },
      { label: 'BEIN L', color: '#4f8cff', rects: [[16, 48, 16, 16]] }
    ];
    for (const group of groups) {
      context.strokeStyle = group.color;
      context.fillStyle = group.color;
      for (const [x, y, width, height] of group.rects) context.strokeRect(x + 0.15, y + 0.15, width - 0.3, height - 0.3);
      const [labelX, labelY] = group.rects[0];
      context.fillText(group.label, labelX + 0.6, labelY + 0.6);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function hasPngSignature(buffer) {
    const bytes = new Uint8Array(buffer.slice(0, 8));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    return signature.every((value, index) => bytes[index] === value);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    });
  }

  async function importSkinFile(file) {
    if (!file) return false;
    setImportReport('loading', 'Skin wird analysiert …', 'PNG, Format, Ebenen und Arm-Modell werden geprüft.');
    try {
      const buffer = await file.arrayBuffer();
      if (!hasPngSignature(buffer)) throw new Error('Die Datei ist kein gültiges PNG.');
      const dataUrl = await fileToDataUrl(file);
      const image = await loadImage(dataUrl);
      const isLegacy = image.width === image.height * 2 && image.height >= 32 && image.height % 32 === 0;
      const isModern = image.width === image.height && image.width >= 64 && image.width % 64 === 0;
      if (!isLegacy && !isModern) {
        throw new Error(`Nicht unterstützte Größe ${image.width} × ${image.height}. Erwartet: 64 × 64, HD-Vielfache oder Legacy 64 × 32.`);
      }
      if (!viewer) throw new Error('Die 3D-Erkennung ist nicht verfügbar. Bitte Grafikbeschleunigung prüfen.');

      // skinview3d processes legacy geometry, opaque overlay zones and the slim-arm heuristic.
      await viewer.loadSkin(image, { model: 'auto-detect' });
      detectedModel = viewer.playerObject.skin.modelType === 'slim' ? 'slim' : 'default';
      modelChoice = 'auto';
      const normalizedCanvas = normalizeSkinSourceCanvas(viewer.skinCanvas || image);
      const normalizedContext = normalizedCanvas.getContext('2d', { willReadFrequently: true });
      baseContext.clearRect(0, 0, 64, 64);
      baseContext.imageSmoothingEnabled = false;
      copySkinRegions(normalizedCanvas, baseContext, SKIN_BASE_RECTS);

      layerSequence = 1;
      const overlayCoverage = countVisiblePixels(normalizedContext, SKIN_OVERLAY_RECTS);
      if (overlayCoverage.count > 0) {
        const overlayLayer = createLayer('Import · Overlay / 2. Ebene', 'paint-1');
        copySkinRegions(normalizedCanvas, overlayLayer.context, SKIN_OVERLAY_RECTS);
        layers = [overlayLayer];
      } else {
        layers = [createLayer('Details', 'paint-1')];
      }
      activeLayerId = layers[0].id;
      layerSequence = layers.length;

      const notes = [];
      if (isLegacy) notes.push('Legacy sicher konvertiert');
      else if (image.width > 64) notes.push('HD pixelgenau normalisiert');
      else notes.push('64 × 64 geprüft');
      notes.push(overlayCoverage.count > 0
        ? `Overlay getrennt (${Math.round(overlayCoverage.ratio * 100)}%)`
        : 'Kein Outer-Layer gefunden');
      notes.push('Armtyp automatisch erkannt');
      importMetadata = {
        name: (file.name || 'Skin').replace(/\.png$/i, '').slice(0, 42),
        width: image.width,
        height: image.height,
        note: notes.join(' · ')
      };
      updateModelUI();
      renderLayerList();
      compositeLayers();
      updateImportReport();
      history = [];
      historyIndex = -1;
      captureHistory();
      setViewMode('split');
      return true;
    } catch (error) {
      console.error('Skin-Import fehlgeschlagen:', error);
      setImportReport('error', 'Skin konnte nicht erkannt werden', error?.message || 'Unbekannter Importfehler.');
      return false;
    } finally {
      if (elements.file) elements.file.value = '';
    }
  }

  function exportSkin() {
    compositeLayers();
    const link = document.createElement('a');
    const safeName = (importMetadata.name || 'fallen-heaven-skin').replace(/[^a-z0-9äöüß_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'fallen-heaven-skin';
    link.download = `${safeName}-64x64.png`;
    link.href = textureCanvas.toDataURL('image/png');
    link.click();
    setImportReport('ready', 'Skin exportiert', 'Minecraft-kompatible PNG · 64 × 64 · Transparenz erhalten');
  }

  function resetProject() {
    drawDefaultSkin();
    layers = createDefaultSkinLayers();
    activeLayerId = layers[layers.length - 1]?.id || layers[0]?.id || 'paint-1';
    layerSequence = layers.length;
    modelChoice = 'auto';
    updateModelUI();
    renderLayerList();
    compositeLayers();
    updateImportReport();
    history = [];
    historyIndex = -1;
    captureHistory();
  }

  function bindEvents() {
    elements.importButton?.addEventListener('click', () => elements.file?.click());
    elements.file?.addEventListener('change', () => importSkinFile(elements.file.files?.[0]));
    elements.exportButton?.addEventListener('click', exportSkin);
    elements.resetButton?.addEventListener('click', resetProject);
    elements.aiOpen?.addEventListener('click', () => {
      elements.aiCreator?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => elements.aiPrompt?.focus(), 220);
    });
    elements.aiGenerate?.addEventListener('click', generateAiSkin);
    elements.aiPrompt?.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        generateAiSkin();
      }
    });

    $$('[data-skin-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.skinTool)));
    $$('[data-skin-size]').forEach((button) => button.addEventListener('click', () => setBrushSize(button.dataset.skinSize)));
    $$('[data-skin-mode]').forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.skinMode)));
    $$('[data-skin-model]').forEach((button) => button.addEventListener('click', () => {
      modelChoice = button.dataset.skinModel;
      updateModelUI();
      scheduleViewerTextureUpdate({ forceModel: true });
      updateImportReport();
      captureHistory();
    }));

    elements.primaryColor?.addEventListener('input', updateColorUI);
    elements.primaryColor?.addEventListener('change', saveProject);
    elements.secondaryColor?.addEventListener('input', updateColorUI);
    elements.secondaryColor?.addEventListener('change', saveProject);
    elements.swapColors?.addEventListener('click', () => {
      const primary = elements.primaryColor.value;
      elements.primaryColor.value = elements.secondaryColor.value;
      elements.secondaryColor.value = primary;
      updateColorUI();
      saveProject();
    });

    elements.swatches?.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      elements.primaryColor.value = swatch.dataset.color;
      updateColorUI();
      saveProject();
    });

    elements.undo?.addEventListener('click', undo);
    elements.redo?.addEventListener('click', redo);
    elements.addLayer?.addEventListener('click', () => addLayer());
    elements.layerList?.addEventListener('click', (event) => {
      const select = event.target.closest('[data-layer-select]');
      const visibility = event.target.closest('[data-layer-visibility]');
      const remove = event.target.closest('[data-layer-delete]');
      if (select) setActiveLayer(select.dataset.layerSelect);
      if (visibility) {
        const layer = layers.find((entry) => entry.id === visibility.dataset.layerVisibility);
        if (layer) {
          layer.visible = !layer.visible;
          renderLayerList();
          compositeLayers();
          captureHistory();
        }
      }
      if (remove) deleteLayer(remove.dataset.layerDelete);
    });
    elements.layerOpacity?.addEventListener('input', () => {
      const layer = getActiveLayer();
      if (!layer) return;
      layer.opacity = Number(elements.layerOpacity.value) / 100;
      setStatusText(elements.layerOpacityValue, `${elements.layerOpacity.value}%`);
      compositeLayers();
    });
    elements.layerOpacity?.addEventListener('change', captureHistory);

    elements.pixelGrid?.addEventListener('change', () => elements.pixelGridOverlay?.classList.toggle('hidden', !elements.pixelGrid.checked));
    elements.uvLayout?.addEventListener('change', () => elements.uvOverlay?.classList.toggle('visible', elements.uvLayout.checked));
    elements.mirror?.addEventListener('change', saveProject);

    textureCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
    textureCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
    textureCanvas.addEventListener('pointermove', handleCanvasPointerMove);
    textureCanvas.addEventListener('pointerup', finishDrawing);
    textureCanvas.addEventListener('pointercancel', finishDrawing);
    textureCanvas.addEventListener('pointerleave', (event) => {
      elements.brushPreview?.classList.remove('visible');
      if (!event.buttons) finishDrawing();
    });

    webglCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
    webglCanvas.addEventListener('pointerdown', handleModelPointerDown, { capture: true });
    webglCanvas.addEventListener('pointermove', handleModelPointerMove, { capture: true });
    webglCanvas.addEventListener('pointerup', finishModelPointer, { capture: true });
    webglCanvas.addEventListener('pointercancel', finishModelPointer, { capture: true });
    webglCanvas.addEventListener('pointerleave', (event) => {
      elements.modelBrushDot?.classList.remove('visible');
      if (!event.buttons) finishDrawing();
    }, { capture: true });

    $$('[data-skin-zoom]').forEach((button) => button.addEventListener('click', () => {
      zoom = Math.max(5, Math.min(14, zoom + (button.dataset.skinZoom === 'in' ? 1 : -1)));
      applyTextureZoom();
    }));
    elements.canvasStage?.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom = Math.max(5, Math.min(14, zoom + (event.deltaY < 0 ? 1 : -1)));
      applyTextureZoom();
    }, { passive: false });

    elements.walkButton?.addEventListener('click', () => {
      if (!viewer) return;
      const walking = elements.walkButton.getAttribute('aria-pressed') !== 'true';
      elements.walkButton.setAttribute('aria-pressed', String(walking));
      elements.walkButton.classList.toggle('active', walking);
      const animation = walking ? new window.skinview3d.WalkingAnimation() : new window.skinview3d.IdleAnimation();
      animation.speed = walking ? 0.72 : 0.82;
      viewer.animation = animation;
    });

    $$('[data-skin-view]').forEach((button) => button.addEventListener('click', () => {
      if (!viewer) return;
      viewer.playerWrapper.rotation.y += button.dataset.skinView === 'left' ? -Math.PI / 8 : Math.PI / 8;
    }));
    elements.viewReset?.addEventListener('click', () => {
      if (!viewer) return;
      viewer.resetCameraPose();
      viewer.controls.reset();
      viewer.playerWrapper.rotation.y = -0.3;
      viewer.zoom = 0.76;
    });

    $$('[data-skin-part]').forEach((button) => button.addEventListener('click', () => {
      button.classList.toggle('active');
      applyViewerVisibility();
    }));
    elements.baseLayer?.addEventListener('change', applyViewerVisibility);
    elements.overlayLayer?.addEventListener('change', applyViewerVisibility);

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      const shortcut = { b: 'pencil', a: 'shade', g: 'fill', e: 'eraser', i: 'picker' }[event.key.toLowerCase()];
      if (shortcut && byId('skin-view')?.classList.contains('active')) setTool(shortcut);
    });

    document.addEventListener('visibilitychange', updateViewerPauseState);
    const viewObserver = new MutationObserver(updateViewerPauseState);
    viewObserver.observe(byId('skin-view'), { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('beforeunload', () => {
      destroyed = true;
      cancelAnimationFrame(fpsFrame);
      viewer?.dispose();
    }, { once: true });
  }

  async function initialize() {
    renderSwatches();
    drawUvOverlay();
    const restored = await loadStoredProject();
    if (!restored) {
      drawDefaultSkin();
      layers = createDefaultSkinLayers();
      activeLayerId = layers[layers.length - 1]?.id || layers[0]?.id || 'paint-1';
      layerSequence = layers.length;
    }
    renderLayerList();
    compositeLayers();
    updateModelUI();
    updateImportReport();
    setTool(tool);
    setBrushSize(brushSize);
    setViewMode(viewMode);
    updateColorUI();
    initializeViewer();
    scheduleViewerTextureUpdate({ forceModel: true });
    bindEvents();
    history = [serializeProject()];
    historyIndex = 0;
    updateHistoryButtons();
    applyTextureZoom();
    updateViewerPauseState();
    fpsFrame = requestAnimationFrame(runFpsCounter);
    studio.classList.add('ready');
  }

  window.FallenHeavenSkinStudio = Object.freeze({
    importFile: importSkinFile,
    exportSkin,
    getState: () => Object.freeze({
      modelChoice,
      detectedModel,
      effectiveModel: effectiveModel(),
      viewMode,
      layerCount: layers.length + 1,
      width: 64,
      height: 64
    })
  });

  initialize().catch((error) => {
    console.error('Skin Studio konnte nicht gestartet werden:', error);
    setImportReport('error', 'Skin Studio konnte nicht starten', error?.message || 'Unbekannter Fehler.');
    setStatusText(elements.renderState, 'STARTFEHLER');
  });
})();
