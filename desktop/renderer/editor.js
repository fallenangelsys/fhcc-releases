(function () {
  var preview = document.getElementById('editor-preview');
  if (!preview) return;

  var storeKey = 'fh-page-editor-patches';
  var patches = JSON.parse(localStorage.getItem(storeKey) || '{}');
  var history = [JSON.stringify(patches)];
  var historyIndex = 0;
  var elements = [];
  var selected = null;
  var activeFilter = 'all';
  var selectionEnabled = true;

  var list = document.getElementById('editor-element-list');
  var count = document.getElementById('editor-element-count');
  var search = document.getElementById('editor-search');
  var title = document.getElementById('editor-selection-title');
  var type = document.getElementById('editor-selection-type');
  var path = document.getElementById('editor-selection-path');
  var form = document.getElementById('editor-form');
  var text = document.getElementById('editor-text');
  var url = document.getElementById('editor-url');
  var source = document.getElementById('editor-source');
  var visible = document.getElementById('editor-visible');
  var status = document.getElementById('editor-status');
  var undo = document.getElementById('editor-undo');
  var redo = document.getElementById('editor-redo');
  var refresh = document.getElementById('editor-refresh');
  var previewMode = document.getElementById('editor-preview-mode');
  var applyButton = document.getElementById('editor-apply');
  var resetButton = document.getElementById('editor-reset');
  var saveButton = document.getElementById('editor-save');

  var focus = document.getElementById('editor-focus');
  if (!list || !count || !search || !title || !type || !path || !form || !text || !url || !source || !visible || !status || !undo || !redo || !focus) return;

  function message(textValue) { status.textContent = textValue; }
  function postTo(frame, typeValue, payload) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ type: typeValue }, payload || {}), '*'); }
  function postPreview(typeValue, payload) { postTo(preview, typeValue, payload); }
  function postAll(typeValue, payload) { postTo(preview, typeValue, payload); }
  function persist() { localStorage.setItem(storeKey, JSON.stringify(patches)); postAll('fallen-heaven-editor-patches', { patches: patches }); }
  function pushHistory() { history = history.slice(0, historyIndex + 1); history.push(JSON.stringify(patches)); historyIndex = history.length - 1; updateHistory(); }
  function updateHistory() { undo.disabled = historyIndex === 0; redo.disabled = historyIndex >= history.length - 1; }
  function normalize(value) { return String(value || '').toLowerCase(); }
  function filteredElements() { var term = normalize(search.value); return elements.filter(function (item) { var byType = activeFilter === 'all' || item.kind === activeFilter || (activeFilter === 'media' && (item.kind === 'image' || item.kind === 'video')); return byType && (!term || normalize(item.label + ' ' + item.value).indexOf(term) !== -1); }); }
  function renderList() { var rows = filteredElements(); count.textContent = rows.length; list.innerHTML = rows.length ? rows.map(function (item) { return '<button class="editor-element' + (selected && selected.id === item.id ? ' active' : '') + '" data-editor-id="' + item.id + '"><i>' + item.kind.slice(0, 3).toUpperCase() + '</i><div><strong>' + escape(item.label) + '</strong><small>' + escape(item.value || item.kind) + '</small></div></button>'; }).join('') : '<p class="editor-empty">Keine passenden Elemente.</p>'; }
  function escape(value) { return String(value || '').replace(/[&<>"']/g, function (char) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]; }); }
  function select(item) { if (!item) return; selected = item; var patch = patches[item.id] || {}; title.textContent = item.label || 'Element'; type.textContent = item.kind.toUpperCase(); path.textContent = item.selector || item.id; text.value = patch.text !== undefined ? patch.text : (item.text || ''); url.value = patch.href !== undefined ? patch.href : (item.href || ''); source.value = patch.src !== undefined ? patch.src : (item.src || ''); visible.checked = !patch.hidden; form.classList.remove('is-disabled'); renderList(); message('Element ausgewählt. Änderungen werden erst nach "Anwenden" in die Vorschau geschrieben.'); }
  function apply() { if (!selected) return; patches[selected.id] = { text: text.value, href: url.value, src: source.value, hidden: !visible.checked }; persist(); pushHistory(); postPreview('fallen-heaven-editor-select', { id: selected.id }); message('Auf die Live-Vorschau angewendet.'); }
  function reset() { if (!selected) return; delete patches[selected.id]; persist(); pushHistory(); select(selected); message('Element auf den Originalzustand zurückgesetzt.'); }
  function restoreHistory(index) { patches = JSON.parse(history[index]); historyIndex = index; persist(); updateHistory(); if (selected) select(selected); message('Änderungsstand wiederhergestellt.'); }
  function reloadPreview() { var current = String(preview.getAttribute('src') || 'discord-supplied.html').split('?')[0]; preview.src = current + '?mode=editor&v=' + Date.now(); message('Vorschau wird neu geladen …'); }

  preview.addEventListener('load', function () { postPreview('fallen-heaven-editor-mode', { enabled: selectionEnabled, patches: patches }); });
  if (focus) focus.addEventListener('click', function () { var active = document.body.classList.toggle('editor-focus-mode'); focus.classList.toggle('active', active); focus.setAttribute('aria-pressed', String(active)); focus.setAttribute('title', active ? 'Seitenleisten einblenden' : 'Vorschau vergrößern'); });
  if (refresh) refresh.addEventListener('click', reloadPreview);
  if (previewMode) previewMode.addEventListener('click', function (event) { selectionEnabled = !selectionEnabled; event.currentTarget.classList.toggle('active', selectionEnabled); postPreview('fallen-heaven-editor-mode', { enabled: selectionEnabled, patches: patches }); message(selectionEnabled ? 'Auswahlmodus aktiv.' : 'Vorschau-Modus aktiv.'); });
  if (applyButton) applyButton.addEventListener('click', apply);
  if (resetButton) resetButton.addEventListener('click', reset);
  if (saveButton) saveButton.addEventListener('click', function () { persist(); message('Alle Seitenänderungen wurden lokal gespeichert.'); });
  undo.addEventListener('click', function () { if (historyIndex > 0) restoreHistory(historyIndex - 1); });
  redo.addEventListener('click', function () { if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1); });
  search.addEventListener('input', renderList);
  document.querySelectorAll('.editor-filter').forEach(function (button) { button.addEventListener('click', function () { activeFilter = button.dataset.editorFilter; document.querySelectorAll('.editor-filter').forEach(function (item) { item.classList.toggle('active', item === button); }); renderList(); }); });
  list.addEventListener('click', function (event) { var button = event.target.closest('[data-editor-id]'); if (!button) return; select(elements.find(function (item) { return item.id === button.dataset.editorId; })); postPreview('fallen-heaven-editor-select', { id: button.dataset.editorId }); });
  window.addEventListener('message', function (event) { if (event.source !== preview.contentWindow || !event.data || !event.data.type) return; if (event.data.type === 'fallen-heaven-editor-index') { elements = Array.isArray(event.data.elements) ? event.data.elements : []; renderList(); message(elements.length + ' bearbeitbare Elemente geladen.'); } if (event.data.type === 'fallen-heaven-editor-select' && event.data.element) { var item = elements.find(function (entry) { return entry.id === event.data.element.id; }); select(item || event.data.element); } });
  updateHistory();
  window.setTimeout(function () {
    postPreview('fallen-heaven-editor-mode', { enabled: selectionEnabled, patches: patches });
  }, 800);
}());
