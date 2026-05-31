// DOM Elements
const rundownList = document.getElementById('rundown-list');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const modalSettings = document.getElementById('settings-modal');

const btnRefreshRundown = document.getElementById('btn-refresh-rundown');
const btnResetRundown = document.getElementById('btn-reset-rundown');
const btnLoadCsv = document.getElementById('btn-load-csv');

const btnSelectShowdir = document.getElementById('btn-select-showdir');
const btnSelectDefaultsdir = document.getElementById('btn-select-defaultsdir');
const btnScanDefaults = document.getElementById('btn-scan-defaults');
const activeRundownTitle = document.getElementById('active-rundown-title');

const modalRundowns = document.getElementById('modal-rundowns');
const btnCloseRundowns = document.getElementById('btn-close-rundowns');
const selectRundown = document.getElementById('select-rundown');
const btnLoadRundown = document.getElementById('btn-load-rundown');

const modalScript = document.getElementById('modal-script');
const btnCloseScript = document.getElementById('btn-close-script');
const modalScriptTitle = document.getElementById('modal-script-title');
const modalScriptContent = document.getElementById('modal-script-content');
const btnSaveScript = document.getElementById('btn-save-script');
const btnCancelScript = document.getElementById('btn-cancel-script');
const btnCapsScript = document.getElementById('btn-caps-script');

let activeScriptItem = null;
let originalScriptText = '';

// Context Menu
const contextMenu = document.getElementById('context-menu');
const menuMarkPrevLoaded = document.getElementById('menu-mark-prev-loaded');
const menuMarkLoaded = document.getElementById('menu-mark-loaded');
const menuMarkUnloaded = document.getElementById('menu-mark-unloaded');
const menuMarkFutureUnloaded = document.getElementById('menu-mark-future-unloaded');
const menuMarkFloated = document.getElementById('menu-mark-floated');
const menuStartTimer = document.getElementById('menu-start-timer');
const menuAddElement = document.getElementById('menu-add-element');
const menuAddElementAbove = document.getElementById('menu-add-element-above');
const menuAddElementBelow = document.getElementById('menu-add-element-below');
const menuEditElement = document.getElementById('menu-edit-element');
const menuRemoveElement = document.getElementById('menu-remove-element');
const menuDividerRemove = document.getElementById('menu-divider-remove');
const menuDividerAdd = document.getElementById('menu-divider-add');
let activeContextMenuRow = null;

// Hide context menu on global click
document.addEventListener('click', () => {
  if (contextMenu) contextMenu.classList.add('hidden');
});

// Batch Actions
const inCurrentIndex = document.getElementById('current-index-input');
const btnInit = document.getElementById('btn-init');
const btnLoadBlock = document.getElementById('btn-load-block');
const btnLoadElement = document.getElementById('btn-load-element');

// Settings Inputs
const inStation = document.getElementById('setting-station');
const inApiKey = document.getElementById('setting-apikey');
const inApiToken = document.getElementById('setting-apitoken');
const inShowdir = document.getElementById('setting-showdir');
const inDefaultsdir = document.getElementById('setting-defaultsdir');
const inVmixip = document.getElementById('setting-vmixip');
const inPrefix = document.getElementById('setting-prefix');
const inFirstLoc = document.getElementById('setting-firstloc');
const inPoolSize = document.getElementById('setting-poolsize');
const inProtectProgram = document.getElementById('setting-protect-program');
const inUse24Hr = document.getElementById('setting-use-24hr');
const scanResult = document.getElementById('scan-result');

let globalParsedItems = []; // Store parsed items to support batch loading
let vmixActionQueue = Promise.resolve();
let globalSlotMap = {}; // Maps slotIndex -> item object currently in that slot
let activeRundownId = null;

let timerPollTimeout = null;
let activeOnAirRowId = null;
let activeOnAirStartDate = null;
let activeRundownStartTime = null;
let activeRundownEndTime = null;
let serverTimeOffsetMs = 0;
let timerIgnoreApiUpdatesUntil = 0;
let blockEarliestRowData = {};

let isWindowFocused = true;
let lastScrolledRowId = null;

window.addEventListener('focus', () => {
  isWindowFocused = true;
});

window.addEventListener('blur', () => {
  isWindowFocused = false;
  lastScrolledRowId = null; // Force snap on next tick
});

function enqueueVmixAction(actionFn) {
  vmixActionQueue = vmixActionQueue.then(() => actionFn()).catch(err => console.error(err));
}

// File Extensions
const videoExts = ["mp4", "mov", "mxf", "mpg", "m4v", "webm", "ts", "qt"];
const imageExts = ["jpg", "png", "webp", "tiff", "tif", "bmp", "heif"];
const audioExts = ["mp3", "wav"];
const titleExts = ["gt", "xaml"];

// Initialize
async function init(isStartup = false) {
  const settings = await window.api.getSettings();
  inStation.value = settings.rundownCreatorRadioStation || '';
  inApiKey.value = settings.rundownCreatorAPIKey || '';
  inApiToken.value = settings.rundownCreatorAPIToken || '';
  inShowdir.value = settings.showDirectory || '';
  inDefaultsdir.value = settings.defaultsDirectory || '';
  inVmixip.value = settings.vmixIP || '127.0.0.1:8088';
  inPrefix.value = settings.inputPrefix || 'Video';
  inFirstLoc.value = settings.firstInputLocation || 9;
  inPoolSize.value = settings.poolSize || 15;
  inProtectProgram.checked = settings.protectProgram !== false; // Default to true
  inUse24Hr.checked = settings.use24Hr === true; // Default to false (12hr)

  const defaultBuses = settings.audioBuses || ['A', 'B'];
  const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]');
  busCheckboxes.forEach(cb => {
    cb.checked = defaultBuses.includes(cb.value);
  });

  // Auto-load last loaded API rundown only on startup
  if (isStartup && settings.lastRundownId) {
    loadApiRundown(settings.lastRundownId, true, settings.lastRundownTitle);
  }
}

// Modal Logic
btnSettings.addEventListener('click', () => {
  init(); // reload current settings
  modalSettings.classList.add('visible');
});

btnCloseSettings.addEventListener('click', () => {
  modalSettings.classList.remove('visible');
});

const modalConfirm = document.getElementById('modal-confirm');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
const modalConfirmMsg = document.getElementById('modal-confirm-msg');

function showConfirm(msg) {
  return new Promise((resolve) => {
    modalConfirmMsg.innerText = msg;
    modalConfirm.classList.add('visible');

    const handleOk = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      modalConfirm.classList.remove('visible');
      btnConfirmOk.removeEventListener('click', handleOk);
      btnConfirmCancel.removeEventListener('click', handleCancel);
    };

    btnConfirmOk.addEventListener('click', handleOk);
    btnConfirmCancel.addEventListener('click', handleCancel);
  });
}

async function checkUnsavedScriptChanges() {
  if (activeScriptItem && modalScriptContent.value !== originalScriptText) {
    return await showConfirm("You have unsaved changes in this script. Are you sure you want to discard them?");
  }
  return true;
}

btnCloseScript.addEventListener('click', async () => {
  if (!(await checkUnsavedScriptChanges())) return;
  modalScript.classList.remove('visible');
  activeScriptItem = null;
});

btnCancelScript.addEventListener('click', async () => {
  if (!(await checkUnsavedScriptChanges())) return;
  modalScript.classList.remove('visible');
  activeScriptItem = null;
});

btnSaveScript.addEventListener('click', async () => {
  if (!activeScriptItem || !activeScriptItem.rowId) return;

  const newText = modalScriptContent.value;
  btnSaveScript.innerText = "Saving...";
  btnSaveScript.disabled = true;

  try {
    const payload = {
      RowID: activeScriptItem.rowId,
      Script: newText
    };

    payload.ReadRate = (activeScriptItem.readRate !== undefined && activeScriptItem.readRate !== null) ? activeScriptItem.readRate : 15;
    payload.ActualDuration = (activeScriptItem.actualDuration !== undefined && activeScriptItem.actualDuration !== null) ? activeScriptItem.actualDuration : 0;

    const res = await window.api.rundownRequest('saveScript', payload);

    if (res.success) {
      // Update local memory so we don't need to re-fetch
      activeScriptItem.script = newText;
      modalScript.classList.remove('visible');
    } else {
      showToast("Error saving script: " + (res.error || "Unknown API error"));
    }
  } catch (err) {
    showToast("Network Error saving script: " + err.message);
  } finally {
    btnSaveScript.innerText = "Save Script";
    btnSaveScript.disabled = true;
    originalScriptText = activeScriptItem ? activeScriptItem.script : '';
  }
});

modalScriptContent.addEventListener('input', () => {
  btnSaveScript.disabled = modalScriptContent.value === originalScriptText;
});

btnCapsScript.addEventListener('click', () => {
  if (modalScriptContent.value) {
    modalScriptContent.value = modalScriptContent.value.toUpperCase();
    modalScriptContent.dispatchEvent(new Event('input'));
  }
});

// Close modals when clicking the dark backdrop
window.addEventListener('mousedown', async (e) => {
  if (e.target.classList.contains('modal')) {
    if (e.target.id === 'modal-confirm') return; // Ignore clicks on the confirm backdrop

    if (e.target.id === 'modal-script') {
      if (!(await checkUnsavedScriptChanges())) return;
    }
    e.target.classList.remove('visible');
    if (e.target.id === 'modal-script') activeScriptItem = null;
  }
});

btnSaveSettings.addEventListener('click', async () => {
  const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]:checked');
  const selectedBuses = Array.from(busCheckboxes).map(cb => cb.value);

  const settings = {
    rundownCreatorRadioStation: inStation.value,
    rundownCreatorAPIKey: inApiKey.value,
    rundownCreatorAPIToken: inApiToken.value,
    showDirectory: inShowdir.value,
    defaultsDirectory: inDefaultsdir.value,
    vmixIP: inVmixip.value,
    inputPrefix: inPrefix.value,
    firstInputLocation: parseInt(inFirstLoc.value) || 9,
    poolSize: parseInt(inPoolSize.value) || 15,
    protectProgram: inProtectProgram.checked,
    use24Hr: inUse24Hr.checked,
    audioBuses: selectedBuses
  };
  await window.api.saveSettings(settings);

  // Immediately re-render rows to apply time format changes
  renderRows(globalParsedItems);

  modalSettings.classList.remove('visible');
});

btnSelectShowdir.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) inShowdir.value = dir;
});

btnSelectDefaultsdir.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) inDefaultsdir.value = dir;
});

btnScanDefaults.addEventListener('click', async () => {
  scanResult.innerText = "Scanning...";
  // Save settings first so backend knows the dir
  await window.api.saveSettings({ defaultsDirectory: inDefaultsdir.value });
  const count = await window.api.scanDefaultsNow();
  scanResult.innerText = `Found ${count} fallback files.`;
});

function getExt(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function formatDuration(sec) {
  if (isNaN(sec) || sec === null || sec === undefined) return '0:00';
  sec = parseInt(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseDuration(val) {
  if (!val) return 0;
  val = val.toString().trim();
  if (val.includes(':')) {
    const parts = val.split(':');
    const m = parseInt(parts[0]) || 0;
    const s = parseInt(parts[1]) || 0;
    return (m * 60) + s;
  }
  return parseInt(val) || 0;
}

function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    `;
  } else {
    iconHtml = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;
  }

  toast.innerHTML = `
    ${iconHtml}
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

async function getVmixActiveSlotTitle() {
  try {
    const res = await window.api.vmixRequest('');
    if (!res.success) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(res.data, "text/xml");
    const activeNode = doc.querySelector('active');
    if (!activeNode) return null;

    const activeNumber = activeNode.textContent;
    const inputNode = doc.querySelector(`input[number="${activeNumber}"]`);
    if (inputNode) {
      return inputNode.getAttribute('title');
    }
  } catch (err) {
    console.error("Failed to parse vMix active slot:", err);
  }
  return null;
}

// vMix Execution
async function sendToVmix(item, slotIndex) {
  // Clear any previous item from tracking if it was in this slot
  const prevItem = globalSlotMap[slotIndex];
  if (prevItem && prevItem !== item) {
    prevItem.loadedSlot = null;
    prevItem.isPlaceholderLoaded = false;

    // Clear the source file object state too
    if (prevItem._sourceFileObj) {
      prevItem._sourceFileObj.loadedSlot = null;
      prevItem._sourceFileObj.isPlaceholderLoaded = false;
    }

    // Update the DOM to "Skipped" if it was "Searching..."
    if (prevItem._sourceRowId && prevItem._sourceFileIndex !== undefined) {
      const row = document.getElementById(prevItem._sourceRowId);
      if (row) {
        const entry = row.querySelector(`.file-entry[data-file-index="${prevItem._sourceFileIndex}"]`);
        if (entry) {
          entry.classList.remove('placeholder-loaded');
          const btn = entry.querySelector('.btn-run');
          if (btn) {
            if (btn.innerText === "Searching...") {
              btn.innerText = "Skipped";
              btn.classList.remove('success', 'primary');
              btn.style.borderColor = 'var(--text-secondary)';
              btn.style.color = 'var(--text-secondary)';
              btn.style.backgroundColor = 'var(--panel-bg)';
              btn.style.animation = 'none'; // Stop pulsing
            } else if (btn.innerText.startsWith("Loaded [")) {
              btn.innerText = "Loaded";
            }
          }
        }
      }
    }
  }
  globalSlotMap[slotIndex] = item;
  item.loadedSlot = slotIndex;

  let targetPath = item.resolvedPath;
  let isPlaceholder = false;

  if (!targetPath) {
    if (!item.requestedFile) return; // Completely empty row, should never happen here
    isPlaceholder = true;
    item.isPlaceholderLoaded = true;
    let appDir = decodeURIComponent(window.location.pathname.substring(1));
    appDir = appDir.substring(0, appDir.lastIndexOf('/'));
    targetPath = appDir + '/placeholder.png';
  } else {
    item.isPlaceholderLoaded = false;
  }

  const ext = isPlaceholder ? 'png' : getExt(item.originalFile);
  let type = "Video";
  if (imageExts.includes(ext) || isPlaceholder) type = "Image";
  else if (audioExts.includes(ext)) type = "AudioFile";
  else if (titleExts.includes(ext)) type = "Title";

  const prefix = inPrefix.value || 'Video';
  const firstLoc = parseInt(inFirstLoc.value) || 9;
  const inputName = `${prefix} ${slotIndex}`;

  // Audio configuration
  const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]');
  let audioCmds = [];
  busCheckboxes.forEach(cb => {
    if (cb.checked) {
      audioCmds.push(`Function=AudioBusOn&Value=${cb.value}&Input=${inputName}`);
    } else {
      audioCmds.push(`Function=AudioBusOff&Value=${cb.value}&Input=${inputName}`);
    }
  });

  // 1. Clear old input
  await window.api.vmixRequest(`Function=RemoveInput&Input=${inputName}`);

  // 2. Add new input
  await window.api.vmixRequest(`Function=AddInput&Value=${type}|${targetPath}`);

  // 3. Rename input
  // vMix automatically names a newly added file input exactly after its filename.
  // We must target that exact initial filename to successfully rename it to Video X.
  const initialInputName = isPlaceholder ? 'placeholder.png' : item.originalFile;
  await window.api.vmixRequest(`Function=SetInputName&Value=${inputName}&Input=${initialInputName}`);

  // 4. Run routing and audio commands concurrently for speed
  const parallelCmds = [
    `Function=MoveInput&Value=${firstLoc + slotIndex - 1}&Input=${inputName}`,
    ...audioCmds,
    `Function=AudioAutoOff&Input=${inputName}`
  ];

  await Promise.all(parallelCmds.map(cmd => window.api.vmixRequest(cmd)));

  item.isLoaded = true;
}

// Drag and drop support
rundownList.addEventListener('dragover', (e) => {
  e.preventDefault();
  rundownList.style.borderColor = 'var(--accent)';
});

rundownList.addEventListener('dragleave', (e) => {
  e.preventDefault();
  rundownList.style.borderColor = 'transparent';
});

rundownList.addEventListener('drop', async (e) => {
  e.preventDefault();
  rundownList.style.borderColor = 'transparent';

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  const targetRowNode = e.target.closest('.row-item');
  if (!targetRowNode) return; // Only allow dropping onto existing rows

  const rowIdMatch = targetRowNode.id.match(/^row-item-(\d+)$/);
  if (rowIdMatch) {
    const rowIndex = parseInt(rowIdMatch[1], 10) - 1;
    const item = globalParsedItems[rowIndex];
    if (item) {
      if (!item.files) item.files = [];
      let added = false;

      for (const file of files) {
        const ext = getExt(file.name);
        if (![...videoExts, ...imageExts, ...audioExts, ...titleExts].includes(ext)) continue;

        let reqFile = file.path;

        const normalizeDir = (d) => {
          if (!d) return '';
          let nd = d.trim().replace(/\//g, '\\');
          if (!nd.endsWith('\\')) nd += '\\';
          return nd;
        };

        const showDir = normalizeDir(inShowdir.value);
        const defDir = normalizeDir(inDefaultsdir.value);
        const fPath = file.path.replace(/\//g, '\\');
        const fPathLower = fPath.toLowerCase();

        if (showDir && fPathLower.startsWith(showDir.toLowerCase())) {
          reqFile = fPath.substring(showDir.length);
        } else if (defDir && fPathLower.startsWith(defDir.toLowerCase())) {
          reqFile = fPath.substring(defDir.length);
        }

        item.files.push({
          requestedFile: reqFile,
          originalFile: file.name,
          resolvedPath: file.path,
          isFallback: false,
          isCustom: false
        });
        added = true;
      }

      if (added) {
        const nextNode = targetRowNode.nextSibling;
        targetRowNode.remove();
        appendRowItem(item, nextNode);

        const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
        allDOMRows.forEach((rowNode, idx) => {
          rowNode.id = `row-item-${idx + 1}`;
          const indexDiv = rowNode.querySelector('.row-index');
          if (indexDiv) indexDiv.innerText = idx + 1;
        });
        itemCount = allDOMRows.length;

        // Restore On-Air highlight if it was the active row
        if (activeOnAirRowId && String(item.rowId) === String(activeOnAirRowId)) {
          const newRow = document.getElementById(`row-item-${rowIndex + 1}`);
          if (newRow) newRow.classList.add('on-air');
        }

        syncRowFilesToServer(item);
      }
    }
  }
});

let itemCount = 0;
async function syncRowFilesToServer(item) {
  try {
    const rowsRes = await window.api.rundownRequest('getRows', { RundownID: activeRundownId });
    if (!rowsRes.success) throw new Error(rowsRes.error);

    const targetRow = rowsRes.data.find(r => String(r.RowID) === String(item.rowId) || String(r.ID) === String(item.rowId) || String(r.id) === String(item.rowId));
    if (!targetRow) throw new Error("Anchor row not found on server.");

    const colsRes = await window.api.rundownRequest('getColumns');
    if (!colsRes.success) throw new Error(colsRes.error);

    const targetCol = colsRes.data.find(c => c.Name_Remapped === 'source') || colsRes.data.find(c => c.Name_Remapped === 'file');
    if (!targetCol) throw new Error("Could not determine Source column ID.");

    const orderedFileNames = (item.files || []).map(f => f.requestedFile || f.originalFile).filter(f => f && f.trim().length > 0);
    const newVal = orderedFileNames.join(', ');

    const setRes = await window.api.rundownRequest('setRowProperties', {
      RowID: item.rowId,
      [targetCol.ColumnID]: newVal
    });

    if (!setRes.success) throw new Error(setRes.error);
  } catch (err) {
    showToast("Error appending element to server: " + err.message);
  }
}

function appendRowItem(item, insertBeforeNode = null) {
  const empty = rundownList.querySelector('.empty-state');
  if (empty) empty.remove();

  itemCount++;

  const row = document.createElement('div');
  row.className = 'row-item';
  row.id = `row-item-${itemCount}`;

  if (item.isFloated) row.classList.add('floated');
  if (item.isBreak) row.classList.add('break');
  if (!item.files || item.files.length === 0) row.classList.add('no-media');
  if (item.isLoaded) row.classList.add('loaded', 'sent');

  let filesHtml = '';
  if (item.files && item.files.length > 0) {
    item.files.forEach((file, index) => {
      let fallbackHtml = '';
      if (file.isFallback) fallbackHtml = '<span class="row-fallback-badge">Fallback</span>';

      const displayFile = file.originalFile;
      const resolvedPath = file.resolvedPath;

      let fileClass = 'row-file';
      if (file.originalFile && !file.resolvedPath) fileClass += ' missing-file';

      let fileContent = '';
      if (file.isCustom) {
        const prefill = file.requestedFile || file.originalFile || '';
        fileContent = `<input type="text" class="custom-source-input" data-file-index="${index}" placeholder="Type filename..." value="${prefill}" style="width: 100%; background: transparent; color: white; border: none; outline: none; border-bottom: 1px solid var(--accent); font-family: monospace;" />`;
      } else {
        fileContent = `${displayFile || ''} <span class="row-duration"></span> ${fallbackHtml}`;
      }

      filesHtml += `
        <div class="file-entry" data-file-index="${index}" style="display: flex; align-items: center; padding: 4px 0;">
          <div class="${fileClass}" title="${resolvedPath || ''}" style="flex: 1; margin-right: 12px;">
            ${fileContent}
          </div>
          <button class="btn primary small btn-run" data-file-index="${index}">Load</button>
        </div>
      `;
    });
  } else {
    let fileContent = '';
    if (item.isCustom) {
      fileContent = `<input type="text" class="custom-source-input" data-file-index="0" placeholder="Type filename..." style="width: 100%; background: transparent; color: white; border: none; outline: none; border-bottom: 1px solid var(--accent); font-family: monospace;" />`;
    } else {
      fileContent = `<span class="row-duration"></span>`;
    }
    filesHtml = `
      <div class="file-entry" data-file-index="0" style="display: flex; align-items: center; padding: 4px 0;">
        <div class="row-file" style="flex: 1; margin-right: 12px; opacity: 0.4;">
          ${fileContent}
        </div>
        <button class="btn primary small btn-run" data-file-index="0" style="visibility: hidden;">Load</button>
      </div>
    `;
  }

  row.innerHTML = `
    <div class="row-index">${itemCount}</div>
    <div class="row-page">${item.page || ''}</div>
    <div class="row-title" title="${item.slug} ${item.segment}">${item.slug} ${item.segment || ''}</div>
    <div class="row-files-container" style="flex: 4; display: flex; flex-direction: column;">
      ${filesHtml}
    </div>
    <div class="row-actions">
      <input type="text" class="row-est-duration" value="${formatDuration(item.estDuration)}" title="Est. Duration (click to edit)" />
      <div class="row-front-time" style="width: 95px; text-align: center; color: var(--text-secondary); font-family: monospace; font-size: 0.875rem;">${formatTimeOfDay(item.frontTime)}</div>
      <div class="row-back-time" style="width: 95px; text-align: center; color: var(--text-secondary); font-family: monospace; font-size: 0.875rem;">${formatTimeOfDay(item.backTime)}</div>
    </div>
  `;

  const customInputs = row.querySelectorAll('.custom-source-input');
  customInputs.forEach(customInput => {
    const fileIndex = parseInt(customInput.getAttribute('data-file-index'));
    setTimeout(() => customInput.focus(), 50);

    let finalized = false;
    let isSyncing = false;
    const finalizeCustomRow = async () => {
      if (finalized || isSyncing) return;
      isSyncing = true;
      customInput.disabled = true; // Prevent multiple entries

      const val = customInput.value.trim();

      if (!val) {
        if (item.files && item.files[fileIndex]) {
          item.files.splice(fileIndex, 1);
        }
        if (!item.files || item.files.length === 0) item.isCustom = false;

        const nextNode = row.nextSibling;
        row.remove();
        appendRowItem(item, nextNode);

        const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
        allDOMRows.forEach((rowNode, idx) => {
          rowNode.id = `row-item-${idx + 1}`;
          const indexDiv = rowNode.querySelector('.row-index');
          if (indexDiv) indexDiv.innerText = idx + 1;
        });
        itemCount = allDOMRows.length;

        // Sync to server after removing empty input
        await syncRowFilesToServer(item);
        finalized = true;
        return;
      }

      // Optimistic local update
      if (!item.files) item.files = [];
      const targetFile = item.files[fileIndex] || { isNewInjection: false };
      targetFile.isCustom = false;
      targetFile.requestedFile = val;
      const mediaInfo = await window.api.resolveMedia(val);
      targetFile.originalFile = mediaInfo ? mediaInfo.path.split(/[\\/]/).pop() : val;
      targetFile.resolvedPath = mediaInfo ? mediaInfo.path : null;
      targetFile.isFallback = mediaInfo ? mediaInfo.isFallback : false;

      if (!item.files[fileIndex]) item.files.push(targetFile);
      item.isCustom = false;

      const nextNode = row.nextSibling;
      row.remove();
      appendRowItem(item, nextNode);

      const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
      allDOMRows.forEach((rowNode, idx) => {
        rowNode.id = `row-item-${idx + 1}`;
        const indexDiv = rowNode.querySelector('.row-index');
        if (indexDiv) indexDiv.innerText = idx + 1;
      });
      itemCount = allDOMRows.length;

      await syncRowFilesToServer(item);
      finalized = true;
    };

    customInput.addEventListener('blur', finalizeCustomRow);
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        customInput.blur();
      }
    });
  });

  const fileEntries = row.querySelectorAll('.file-entry');
  fileEntries.forEach(entry => {
    const fileIndex = parseInt(entry.getAttribute('data-file-index'));
    const fileObj = (item.files && item.files[fileIndex]) ? item.files[fileIndex] : null;
    if (!fileObj) return;

    const btnRun = entry.querySelector('.btn-run');
    const rowFile = entry.querySelector('.row-file');

    if (fileObj.resolvedPath) {
      rowFile.addEventListener('click', () => {
        window.api.openFile(fileObj.resolvedPath);
      });

      // Fetch duration for this specific file using FFprobe via IPC
      if (fileObj.resolvedPath.match(/\.(mp4|mov|webm|mkv|mxf|mpg|m4v|ts)$/i)) {
        window.api.getVideoDuration(fileObj.resolvedPath).then(duration => {
          if (duration && !isNaN(duration)) {
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60).toString().padStart(2, '0');
            const span = entry.querySelector('.row-duration');
            if (span) span.innerText = `[${mins}:${secs}]`;
          }
        }).catch(err => console.error("Error getting duration for", fileObj.resolvedPath, err));
      }
    }

    if (fileObj.isLoaded) {
      entry.classList.add('loaded', 'sent');
      if (fileObj.isPlaceholderLoaded) entry.classList.add('placeholder-loaded');
      if (btnRun) {
        btnRun.innerText = fileObj.isPlaceholderLoaded ? "Searching..." : (fileObj.loadedSlot ? `Loaded [${fileObj.loadedSlot}]` : "Loaded");
        btnRun.classList.remove('primary');
        btnRun.classList.add('success');
      }
    } else if (!fileObj.resolvedPath && btnRun) {
      // Allow button to remain active so it can load a placeholder and trigger auto-search
      btnRun.disabled = false;
      btnRun.style.opacity = '1';
      btnRun.innerText = "Load";
    }

    if (btnRun) {
      btnRun.addEventListener('click', async () => {
        if (btnRun.innerText === "Sending...") return;

        enqueueVmixAction(async () => {
          btnRun.innerText = "Sending...";
          const slotToUse = parseInt(inCurrentIndex.value) || 1;

          if (inProtectProgram.checked) {
            const activeTitle = await getVmixActiveSlotTitle();
            const targetTitle = `${inPrefix.value || 'Video'} ${slotToUse}`;
            if (activeTitle && activeTitle === targetTitle) {
              btnRun.innerText = "Load";
              showToast(`Load Aborted: <strong>${targetTitle}</strong> is currently LIVE on Program!`);
              return;
            }
          }

          // Use fileObj instead of item for sendToVmix
          const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: row.id, _sourceFileIndex: fileIndex };
          await sendToVmix(dummyItemForVmix, slotToUse);

          // Sync state back from sendToVmix to the actual file object
          fileObj.isLoaded = dummyItemForVmix.isLoaded;
          fileObj.loadedSlot = dummyItemForVmix.loadedSlot;
          fileObj.isPlaceholderLoaded = dummyItemForVmix.isPlaceholderLoaded;

          // Re-update visual state
          if (btnRun) {
            entry.classList.add('loaded', 'sent');
            if (fileObj.isPlaceholderLoaded) {
              entry.classList.add('placeholder-loaded');
              btnRun.innerText = "Searching...";
            } else {
              entry.classList.remove('placeholder-loaded');
              btnRun.innerText = fileObj.loadedSlot ? `Loaded [${fileObj.loadedSlot}]` : "Loaded";
            }
            btnRun.classList.remove('primary');
            btnRun.classList.add('success');
            // Remove skipped styles if they were applied
            btnRun.style.borderColor = '';
            btnRun.style.color = '';
            btnRun.style.animation = '';
          }
          let nextSlot = slotToUse + 1;
          const poolSize = parseInt(inPoolSize.value) || 15;
          if (nextSlot > poolSize) nextSlot = 1;
          inCurrentIndex.value = nextSlot;
        });
      });
    }
  });

  const estInput = row.querySelector('.row-est-duration');
  if (estInput) {
    const processDurationUpdate = async () => {
      const parsedSecs = parseDuration(estInput.value);
      if (parsedSecs !== item.estDuration) {
        if (item.rowId) {
          try {
            const res = await window.api.rundownRequest('setRowProperties', {
              RowID: item.rowId,
              EstimatedDuration: parsedSecs
            });
            if (!res.success) {
              showToast("Error updating duration on server: " + (res.error || "Unknown error"));
              estInput.value = formatDuration(item.estDuration); // revert
              return;
            }
          } catch (err) {
            showToast("Network Error updating duration: " + err.message);
            estInput.value = formatDuration(item.estDuration); // revert
            return;
          }
        }
        item.estDuration = parsedSecs;
      }
      estInput.value = formatDuration(item.estDuration);
    };

    estInput.addEventListener('blur', processDurationUpdate);
    estInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        estInput.blur(); // Triggers blur which calls processDurationUpdate
      }
    });
    estInput.addEventListener('focus', () => {
      // Small timeout ensures the browser's default click-to-place-cursor
      // doesn't instantly deselect the text we just highlighted.
      setTimeout(() => estInput.select(), 10);
    });
  }

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    activeContextMenuRow = row;

    const fileEntry = e.target.closest('.file-entry');
    if (fileEntry) {
      activeContextMenuFileIndex = parseInt(fileEntry.getAttribute('data-file-index')) || 0;
    } else {
      activeContextMenuFileIndex = -1;
    }

    if (row.classList.contains('on-air')) {
      menuStartTimer.innerText = "Stop On-Air Timer";
    } else {
      menuStartTimer.innerText = "Start On-Air Timer";
    }

    const fileObj = (item.files && item.files[activeContextMenuFileIndex]) ? item.files[activeContextMenuFileIndex] : null;
    const hasFile = fileObj && (fileObj.requestedFile || fileObj.originalFile);

    if (hasFile) {
      if (menuAddElementAbove) menuAddElementAbove.style.display = 'block';
      if (menuAddElementBelow) menuAddElementBelow.style.display = 'block';
      if (menuAddElement) menuAddElement.style.display = 'none';
      if (menuEditElement) menuEditElement.style.display = 'block';
      if (menuRemoveElement) menuRemoveElement.style.display = 'block';
      if (menuDividerRemove) menuDividerRemove.style.display = 'block';
      if (menuDividerAdd) menuDividerAdd.style.display = 'block';
    } else {
      if (menuAddElementAbove) menuAddElementAbove.style.display = 'none';
      if (menuAddElementBelow) menuAddElementBelow.style.display = 'none';
      if (menuAddElement) menuAddElement.style.display = 'block';
      if (menuEditElement) menuEditElement.style.display = 'none';
      if (menuRemoveElement) menuRemoveElement.style.display = 'none';
      if (menuDividerRemove) menuDividerRemove.style.display = 'none';
      if (menuDividerAdd) menuDividerAdd.style.display = 'block';
    }

    contextMenu.classList.remove('hidden');

    const menuHeight = contextMenu.offsetHeight;
    const windowHeight = window.innerHeight;

    let top = e.pageY;
    if (top + menuHeight > windowHeight) {
      top = top - menuHeight;
      if (top < 0) top = 0;
    }

    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${top}px`;
  });

  row.addEventListener('dblclick', async () => {
    activeScriptItem = item;

    // Always pre-fill with local cache if available so it feels instantaneous
    if (item.script) {
      modalScriptContent.value = item.script;
      originalScriptText = item.script;
    } else {
      modalScriptContent.value = 'Loading script...';
      originalScriptText = '';
    }

    modalScriptTitle.innerText = `${item.slug} ${item.segment || ''} - Script`;
    btnSaveScript.disabled = true;
    modalScript.classList.add('visible');

    if (item.rowId) {
      // Background fetch to ensure we have the absolute latest version from RC
      try {
        let res = await window.api.rundownRequest('getScript', { RowID: item.rowId });
        if (res.success && res.data) {
          let scriptContent = '';
          let dataObj = Array.isArray(res.data) ? res.data[0] : res.data;

          if (dataObj) {
            if (dataObj.ReadRate !== undefined) activeScriptItem.readRate = dataObj.ReadRate;
            if (dataObj.ActualDuration !== undefined) activeScriptItem.actualDuration = dataObj.ActualDuration;

            if (typeof dataObj === 'string') {
              scriptContent = dataObj;
            } else if (dataObj.Script !== undefined) {
              scriptContent = dataObj.Script || '';
            } else if (dataObj.Body !== undefined) {
              scriptContent = dataObj.Body || '';
            } else {
              scriptContent = JSON.stringify(dataObj);
            }
          }

          // Only update if it actually changed
          if (modalScriptContent.value !== scriptContent) {
            // Safety: if they started typing before the fetch returned, don't overwrite their work
            if (!btnSaveScript.disabled) {
              showToast("A newer version of the script was found on the server, but you have unsaved changes.", "error");
            } else {
              modalScriptContent.value = scriptContent;
              originalScriptText = scriptContent;
              item.script = scriptContent; // Update local cache
            }
          }
        } else if (!item.script) {
          modalScriptContent.value = 'Error loading script or script is empty.';
        }
      } catch (e) {
        if (!item.script) modalScriptContent.value = 'Network Error: ' + e.message;
        console.error('Background script fetch failed:', e);
      }
    } else if (!item.script) {
      showToast('No script available for this item.');
    }
  });

  if (insertBeforeNode) {
    rundownList.insertBefore(row, insertBeforeNode);
  } else {
    rundownList.appendChild(row);
  }

  return row;
}

function renderRows(items) {
  let parsedItems = [...items];

  // Calculate Static Front and Back Times
  if (activeRundownStartTime) {
    let currentFrontTime = activeRundownStartTime;
    for (let i = 0; i < parsedItems.length; i++) {
      parsedItems[i].frontTime = currentFrontTime;
      currentFrontTime += (parsedItems[i].estDuration || 0);
    }
  }

  if (activeRundownEndTime) {
    let currentBackTime = activeRundownEndTime;
    for (let i = parsedItems.length - 1; i >= 0; i--) {
      currentBackTime -= (parsedItems[i].estDuration || 0);
      parsedItems[i].backTime = currentBackTime;
    }
  }

  globalParsedItems = parsedItems;
  rundownList.innerHTML = '';
  itemCount = 0;
  if (items.length === 0) {
    rundownList.innerHTML = '<div class="empty-state"><p>No items found.</p></div>';
    return;
  }
  globalParsedItems.forEach(item => appendRowItem(item));
}

// Batch Functions
async function processBatch(count, limitToSegment = false) {
  const poolSize = parseInt(inPoolSize.value) || 15;
  let itemsSent = 0;
  let targetSegment = null;

  for (let i = 0; i < globalParsedItems.length; i++) {
    const item = globalParsedItems[i];

    if (!item.files || item.files.length === 0) continue;

    for (let fIdx = 0; fIdx < item.files.length; fIdx++) {
      const fileObj = item.files[fIdx];

      if (itemsSent >= count) return;
      if (item.isFloated || fileObj.isLoaded || fileObj.isLoading || (!fileObj.resolvedPath && !fileObj.requestedFile)) continue;

      // Segment logic - lock targetSegment to the first valid unloaded item we find
      if (limitToSegment) {
        const getBlockLetter = (item) => {
          const match = (item.page || '').match(/^[a-zA-Z]+/);
          return match ? match[0].toUpperCase() : item.segment;
        };
        const itemBlock = getBlockLetter(item);

        if (targetSegment === null) {
          targetSegment = itemBlock;
        } else if (itemBlock !== targetSegment) {
          return; // Stop the batch if block changes
        }
      }

      fileObj.isLoading = true; // Mark instantly to prevent concurrent double-loads
      const slotToUse = parseInt(inCurrentIndex.value) || 1;

      // Find DOM button to update UI
      const row = document.getElementById(`row-item-${i + 1}`);
      const entry = row ? row.querySelector(`.file-entry[data-file-index="${fIdx}"]`) : null;
      const btn = entry ? entry.querySelector('.btn-run') : null;

      // Program Protection Check
      if (inProtectProgram.checked) {
        const activeTitle = await getVmixActiveSlotTitle();
        const targetTitle = `${inPrefix.value || 'Video'} ${slotToUse}`;
        if (activeTitle && activeTitle === targetTitle) {
          fileObj.isLoading = false;
          if (btn) btn.innerText = "Load";
          showToast(`Batch Aborted: <strong>${targetTitle}</strong> is currently LIVE on Program!`);
          return; // Stop the entire batch load
        }
      }

      if (btn) btn.innerText = "Sending...";

      const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx };
      await sendToVmix(dummyItemForVmix, slotToUse);
      fileObj.isLoading = false;

      // Sync state back from sendToVmix to the actual file object
      fileObj.isLoaded = dummyItemForVmix.isLoaded;
      fileObj.loadedSlot = dummyItemForVmix.loadedSlot;
      fileObj.isPlaceholderLoaded = dummyItemForVmix.isPlaceholderLoaded;

      if (entry) {
        entry.classList.add('sent', 'loaded');
        if (fileObj.isPlaceholderLoaded) {
          entry.classList.add('placeholder-loaded');
        } else {
          entry.classList.remove('placeholder-loaded');
        }
        if (btn) {
          btn.innerText = fileObj.isPlaceholderLoaded ? "Searching..." : (fileObj.loadedSlot ? `Loaded [${fileObj.loadedSlot}]` : "Loaded");
          btn.classList.remove('primary');
          btn.classList.add('success');
          btn.style.borderColor = '';
          btn.style.color = '';
          btn.style.animation = '';
        }
      }
      if (row) row.classList.add('sent', 'loaded'); // Mark parent row

      let nextSlot = slotToUse + 1;
      if (nextSlot > poolSize) nextSlot = 1; // Wrap around
      inCurrentIndex.value = nextSlot;

      itemsSent++;
    }
  }
}

btnInit.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    btnInit.disabled = true;

    // 1. Mark all as unloaded first
    globalParsedItems.forEach(item => {
      item.isLoaded = false;
      item.isLoading = false;
      if (item.files) {
        item.files.forEach(f => {
          f.isLoaded = false;
          f.isLoading = false;
          f.isPlaceholderLoaded = false;
        });
      }
    });

    const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
    allRows.forEach(row => {
      row.classList.remove('loaded', 'sent');
      const entries = row.querySelectorAll('.file-entry');
      entries.forEach(e => {
        e.classList.remove('loaded', 'sent', 'placeholder-loaded');
        const runBtn = e.querySelector('.btn-run');
        if (runBtn) {
          runBtn.innerText = "Load";
          runBtn.classList.remove('success');
          runBtn.classList.add('primary');
          runBtn.style.borderColor = '';
          runBtn.style.color = '';
          runBtn.style.animation = '';
        }
      });
    });

    // 2. Load like it currently does
    inCurrentIndex.value = 1; // Always start at 1 for Initialize
    const poolSize = parseInt(inPoolSize.value) || 15;
    await processBatch(poolSize, false);
    btnInit.disabled = false;
  });
});

btnLoadBlock.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    btnLoadBlock.disabled = true;
    const poolSize = parseInt(inPoolSize.value) || 15;
    await processBatch(poolSize, true); // true = limit to segment
    btnLoadBlock.disabled = false;
  });
});

btnLoadElement.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    await processBatch(1, false);
  });
});

inCurrentIndex.addEventListener('change', () => {
  const max = parseInt(inPoolSize.value, 10) || 15;
  let val = parseInt(inCurrentIndex.value, 10);

  if (isNaN(val)) return;
  if (val < 1) inCurrentIndex.value = max;
  else if (val > max) inCurrentIndex.value = 1;
});

inCurrentIndex.addEventListener('keydown', (e) => {
  const max = parseInt(inPoolSize.value, 10) || 15;
  let val = parseInt(inCurrentIndex.value, 10);

  if (e.key === 'ArrowDown' && val === 1) {
    e.preventDefault();
    inCurrentIndex.value = max;
  } else if (e.key === 'ArrowUp' && val === max) {
    e.preventDefault();
    inCurrentIndex.value = 1;
  }
});

// Legacy keyboard shortcuts removed (merged to global hotkeys at end of file)

let missingMediaPollTimeout = null;

async function pollMissingMedia() {
  clearTimeout(missingMediaPollTimeout);
  try {
    if (globalParsedItems.length === 0) return;

    for (let i = 0; i < globalParsedItems.length; i++) {
      const item = globalParsedItems[i];
      if (!item.files || item.files.length === 0) continue;

      for (let fIdx = 0; fIdx < item.files.length; fIdx++) {
        const fileObj = item.files[fIdx];

        // Scan items that explicitly requested a file, but are currently missing OR using a Fallback
        if (!fileObj.requestedFile || (fileObj.resolvedPath && !fileObj.isFallback)) continue;

        const searchName = fileObj.requestedFile;
        const mediaInfo = await window.api.resolveMedia(searchName);

        // If we found media, and it's either NOT a fallback (so we found the real one), 
        // OR we were completely missing before (so finding a fallback is still an upgrade)
        if (mediaInfo && (!mediaInfo.isFallback || !fileObj.resolvedPath)) {
          // It was found! Update the item
          fileObj.resolvedPath = mediaInfo.path;
          fileObj.originalFile = mediaInfo.path.split(/[\\/]/).pop();
          fileObj.isFallback = mediaInfo.isFallback;

          const row = document.getElementById(`row-item-${i + 1}`);
          if (row) {
            row.classList.remove('no-media');
            const entry = row.querySelector(`.file-entry[data-file-index="${fIdx}"]`);

            if (entry) {
              const rowFile = entry.querySelector('.row-file');

              let fallbackHtml = '';
              if (fileObj.isFallback) {
                fallbackHtml = '<span class="row-fallback-badge">Fallback</span>';
              }

              const displayFile = fileObj.originalFile;

              if (rowFile) {
                rowFile.innerHTML = `
                  ${displayFile}
                  <span class="row-duration"></span>
                  ${fallbackHtml}
                `;
                rowFile.title = fileObj.resolvedPath;
                rowFile.onclick = () => window.api.openFile(fileObj.resolvedPath);
                rowFile.classList.remove('missing-file');
              }

              const btnRun = entry.querySelector('.btn-run');
              if (btnRun) {
                btnRun.disabled = false;
                btnRun.style.opacity = '1';
                btnRun.innerText = "Load";
              }

              // Fetch duration using FFprobe via IPC
              if (fileObj.resolvedPath.match(/\.(mp4|mov|webm|mkv|mxf|mpg|m4v|ts)$/i)) {
                try {
                  const duration = await window.api.getVideoDuration(fileObj.resolvedPath);
                  if (duration && !isNaN(duration)) {
                    const mins = Math.floor(duration / 60);
                    const secs = Math.floor(duration % 60).toString().padStart(2, '0');
                    const span = entry.querySelector('.row-duration');
                    if (span) span.innerText = `[${mins}:${secs}]`;
                  }
                } catch (e) {
                  console.error("Error getting duration for", fileObj.resolvedPath, e);
                }
              }

              // Auto-Replace in vMix if it was loaded as a placeholder!
              if (fileObj.isPlaceholderLoaded && fileObj.loadedSlot) {
                // It's currently playing/loaded in vMix as a black frame. Replace it!
                enqueueVmixAction(async () => {
                  // Prevent race condition: if it was skipped/overwritten while we were waiting in queue, abort!
                  if (!fileObj.isPlaceholderLoaded || !fileObj.loadedSlot) return;

                  if (!entry) return;
                  const runBtn = entry.querySelector('.btn-run');
                  if (runBtn) runBtn.innerText = "Replacing...";

                  const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx };
                  await sendToVmix(dummyItemForVmix, fileObj.loadedSlot);

                  // Re-update visual state
                  if (runBtn) {
                    entry.classList.remove('placeholder-loaded');
                    fileObj.isPlaceholderLoaded = false;
                    runBtn.innerText = fileObj.loadedSlot ? `Loaded [${fileObj.loadedSlot}]` : "Loaded";
                    runBtn.classList.remove('primary');
                    runBtn.classList.add('success');
                  }
                });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Auto-scanner error:", e);
  } finally {
    missingMediaPollTimeout = setTimeout(pollMissingMedia, 5000);
  }
}

// Start auto-scanner
pollMissingMedia();

// Rundown Selection Modal Logic
btnCloseRundowns.addEventListener('click', () => {
  modalRundowns.classList.remove('visible');
});

// API Fetching
activeRundownTitle.addEventListener('click', async () => {
  const previousTitle = activeRundownTitle.innerText;
  activeRundownTitle.innerText = "Fetching...";
  try {
    let res = await window.api.rundownRequest('getRundowns');
    if (!res.success) throw new Error(res.error);
    if (!res.data || res.data.length === 0) throw new Error("No rundowns found.");

    selectRundown.innerHTML = '';
    let activeRundowns = res.data.filter(rd => rd.Archived !== 1 && rd.Template !== 1);

    // Sort by newest first (descending Start timestamp)
    activeRundowns.sort((a, b) => b.Start - a.Start);

    if (activeRundowns.length === 0) {
      throw new Error("No active (unarchived) rundowns found.");
    }

    activeRundowns.forEach(rd => {
      const option = document.createElement('option');
      option.value = rd.RundownID;
      option.innerText = rd.Title || rd.RundownID;
      selectRundown.appendChild(option);
    });

    modalRundowns.classList.add('visible');

  } catch (err) {
    console.error("Error fetching rundowns:", err);
    selectRundown.innerHTML = '<option value="">Offline / Error - Use CSV Backup</option>';
    modalRundowns.classList.add('visible');
  } finally {
    activeRundownTitle.innerText = previousTitle;
  }
});

async function loadApiRundown(rundownId, preserveState = false, rundownTitle = '') {
  if (!rundownId) return;
  activeRundownId = rundownId;

  if (rundownTitle) {
    activeRundownTitle.innerText = rundownTitle;
  } else {
    activeRundownTitle.innerText = rundownId;
  }

  const contentDiv = document.querySelector('.content');
  const scrollPos = preserveState && contentDiv ? contentDiv.scrollTop : 0;

  const loadedKeys = new Set();
  const placeholderKeys = new Set();
  const slotMap = new Map();

  if (preserveState) {
    globalParsedItems.forEach(i => {
      const pageStr = i.page ? String(i.page).trim() : '';
      if (i.isLoaded) loadedKeys.add(`${pageStr}|${i.slug}|__ROW__`);

      if (i.files) {
        i.files.forEach(f => {
          const key = `${pageStr}|${i.slug}|${f.originalFile}`;
          if (f.isLoaded) {
            loadedKeys.add(key);
          }
          if (f.isPlaceholderLoaded) {
            placeholderKeys.add(key);
          }
          if (f.loadedSlot !== null && f.loadedSlot !== undefined) {
            slotMap.set(key, f.loadedSlot);
          }
        });
      }
    });
  }

  modalRundowns.classList.remove('visible');
  rundownList.innerHTML = '<div class="empty-state"><p>Loading rundown rows...</p></div>';

  try {
    if (!preserveState) {
      inCurrentIndex.value = 1; // Reset only when fetching a completely different rundown
    }

    // Fetch Start/End times from rundown list
    let listRes = await window.api.rundownRequest('getRundowns');
    if (listRes.success && listRes.data) {
      const rd = listRes.data.find(r => String(r.RundownID) === String(rundownId));
      if (rd) {
        activeRundownStartTime = parseInt(rd.Start, 10);
        activeRundownEndTime = parseInt(rd.End, 10);
      }
    }

    let res = await window.api.rundownRequest('getRows', { RundownID: rundownId });
    if (!res.success) throw new Error(res.error);

    const rows = res.data;
    const parsedItems = [];

    for (const row of rows) {
      const fileField = row.file || row.source || '';
      const slugField = row.StorySlug || '';
      const scriptField = row.Script || row.Body || row.StoryBody || '';
      const rowIdField = row.RowID || row.ID || row.id || '';

      if (!fileField && !slugField) continue;

      const fileNames = fileField.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const isFloated = row.Floated === 1 || String(row.Floated) === "1" || String(row.Floated).toLowerCase() === 'true';
      const estDur = parseInt(row.EstimatedDuration || row.Duration) || 0;
      const pageStr = row.PageNumber ? String(row.PageNumber).trim() : '';
      const isBreak = /^[A-Za-z]+0$/.test(pageStr) || String(row.Type).toLowerCase() === 'break' || slugField.toUpperCase().includes('BREAK');

      let filesArray = [];

      if (!fileNames || fileNames.length === 0) {
        filesArray = [];
      } else {
        for (const f of fileNames) {
          let searchName = f.trim();
          const mediaInfo = await window.api.resolveMedia(searchName);
          const originalFile = mediaInfo ? mediaInfo.path.split(/[\\/]/).pop() : searchName;

          const fileKey = `${pageStr}|${slugField}|${originalFile}`;
          const fileWasLoaded = preserveState && loadedKeys.has(fileKey);
          const fileWasPlaceholder = preserveState && placeholderKeys.has(fileKey);
          const fileSlot = preserveState ? slotMap.get(fileKey) : undefined;

          filesArray.push({
            requestedFile: searchName,
            originalFile: originalFile,
            resolvedPath: mediaInfo ? mediaInfo.path : null,
            isFallback: mediaInfo ? mediaInfo.isFallback : false,
            isCustom: false,
            isLoaded: fileWasLoaded,
            isPlaceholderLoaded: fileWasPlaceholder,
            loadedSlot: fileSlot !== undefined ? fileSlot : null
          });
        }
      }

      const rowKey = `${pageStr}|${slugField}|__ROW__`;
      const rowWasLoaded = preserveState && loadedKeys.has(rowKey);

      parsedItems.push({
        page: row.PageNumber,
        slug: slugField,
        segment: row.segment || '',
        script: scriptField,
        rowId: rowIdField,
        estDuration: estDur,
        files: filesArray,
        isFloated: isFloated,
        isLoaded: rowWasLoaded,
        isPlaceholderLoaded: false,
        loadedSlot: null,
        isBreak: isBreak
      });
    }

    renderRows(parsedItems);

    if (preserveState && contentDiv) {
      requestAnimationFrame(() => {
        contentDiv.scrollTop = scrollPos;
      });
    }

    // Save as last loaded rundown
    await window.api.saveSettings({ lastRundownId: rundownId, lastRundownTitle: rundownTitle });

    // Force an immediate poll to instantly highlight the On-Air timer if active
    clearTimeout(timerPollTimeout);
    pollOnAirTimer();

  } catch (err) {
    alert("Error fetching rows: " + err.message);
    rundownList.innerHTML = '<div class="empty-state"><p>Error fetching rows.</p></div>';
  }
}

btnLoadRundown.addEventListener('click', async () => {
  const option = selectRundown.options[selectRundown.selectedIndex];
  const title = option ? option.innerText : selectRundown.value;
  await loadApiRundown(selectRundown.value, false, title);
});

btnRefreshRundown.addEventListener('click', async () => {
  const settings = await window.api.getSettings();
  if (settings.lastRundownId) {
    await loadApiRundown(settings.lastRundownId, true, settings.lastRundownTitle);
  } else {
    alert("No API rundown is currently loaded. Use 'Select Rundown' first.");
  }
});

btnResetRundown.addEventListener('click', async () => {
  const settings = await window.api.getSettings();
  if (settings.lastRundownId) {
    await loadApiRundown(settings.lastRundownId, false, settings.lastRundownTitle);
  } else {
    alert("No API rundown is currently loaded. Use 'Select Rundown' first.");
  }
});

// CSV Loading Backup (Using HTML5 FileReader)
btnLoadCsv.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    activeRundownTitle.innerText = file.name;
    modalRundowns.classList.remove('visible'); // Close modal if open

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      if (lines.length < 2) return;

      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const slugIdx = headers.indexOf('Story Slug');
      const fileIdx = headers.indexOf('Source') > -1 ? headers.indexOf('Source') : 8; // fallback column
      const pageIdx = headers.indexOf('Page');
      const segmentIdx = headers.indexOf('Segment');
      const typeIdx = headers.indexOf('Type');
      const scriptIdx = headers.findIndex(h => h.toLowerCase() === 'script' || h.toLowerCase() === 'body');

      inCurrentIndex.value = 1; // Reset on CSV load
      const parsedItems = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const cols = line.split(',');

        if (cols.length > Math.max(slugIdx, fileIdx)) {
          const slug = slugIdx > -1 ? cols[slugIdx].replace(/"/g, '') : '';
          const fileField = fileIdx > -1 ? cols[fileIdx].replace(/"/g, '') : '';
          const page = pageIdx > -1 ? cols[pageIdx].replace(/"/g, '') : '';
          const segment = segmentIdx > -1 ? cols[segmentIdx].replace(/"/g, '') : '';
          const type = typeIdx > -1 ? cols[typeIdx].replace(/"/g, '') : '';
          const script = scriptIdx > -1 ? cols[scriptIdx].replace(/"/g, '') : '';

          if (!slug && !fileField) continue;

          const fileNames = fileField.split(';')
            .map(f => f.trim())
            .filter(f => f.length > 0);

          const isBreak = /^[A-Za-z]+0$/.test(page);

          if (fileNames.length === 0) {
            parsedItems.push({ page, slug, segment, script, requestedFile: '', originalFile: '', resolvedPath: null, isFallback: false, isFloated: false, isLoaded: false, isBreak });
          } else {
            for (const f of fileNames) {
              let searchName = f.trim();
              const mediaInfo = await window.api.resolveMedia(searchName);
              parsedItems.push({
                page, slug, segment, script,
                requestedFile: searchName,
                originalFile: mediaInfo ? mediaInfo.path.split(/[\\/]/).pop() : searchName,
                resolvedPath: mediaInfo ? mediaInfo.path : null,
                isFallback: mediaInfo ? mediaInfo.isFallback : false,
                isFloated: false,
                isLoaded: false,
                isBreak
              });
            }
          }
        }
      }
      renderRows(parsedItems);

      // Clear auto-load memory since we switched to a CSV backup
      await window.api.saveSettings({ lastRundownId: null, lastRundownTitle: null });
    };
    reader.readAsText(file);
  };
  input.click();
});

// Context Menu Actions
document.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
});

menuAddElement.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const anchorItem = globalParsedItems[targetIndex];
  if (!anchorItem.files) anchorItem.files = [];

  anchorItem.files.push({
    requestedFile: '',
    originalFile: '',
    resolvedPath: null,
    isFallback: false,
    isCustom: true,
    isNewInjection: true
  });

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
  itemCount = allDOMRows.length;
});

menuAddElementAbove.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const anchorItem = globalParsedItems[targetIndex];
  if (!anchorItem.files) anchorItem.files = [];

  anchorItem.files.splice(activeContextMenuFileIndex, 0, {
    requestedFile: '',
    originalFile: '',
    resolvedPath: null,
    isFallback: false,
    isCustom: true,
    isNewInjection: true
  });

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
  itemCount = allDOMRows.length;
});

menuAddElementBelow.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const anchorItem = globalParsedItems[targetIndex];
  if (!anchorItem.files) anchorItem.files = [];

  anchorItem.files.splice(activeContextMenuFileIndex + 1, 0, {
    requestedFile: '',
    originalFile: '',
    resolvedPath: null,
    isFallback: false,
    isCustom: true,
    isNewInjection: true
  });

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
  itemCount = allDOMRows.length;
});

menuEditElement.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const anchorItem = globalParsedItems[targetIndex];
  if (anchorItem.files && anchorItem.files[activeContextMenuFileIndex]) {
    anchorItem.files[activeContextMenuFileIndex].isCustom = true;
    anchorItem.files[activeContextMenuFileIndex].isNewInjection = false;
  }

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
  itemCount = allDOMRows.length;
});

menuRemoveElement.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const anchorItem = globalParsedItems[targetIndex];

  if (anchorItem.files && anchorItem.files.length > 0) {
    anchorItem.files.splice(activeContextMenuFileIndex, 1);
  }

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
  itemCount = allDOMRows.length;

  syncRowFilesToServer(anchorItem);
});

menuMarkPrevLoaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex > -1) {
    for (let i = 0; i <= targetIndex; i++) {
      const gItem = globalParsedItems[i];
      if (gItem && gItem.files && gItem.files.length > 0) {
        if (i < targetIndex || activeContextMenuFileIndex === -1) {
          allRows[i].classList.add('loaded', 'sent');
          gItem.isLoaded = true;
          gItem.files.forEach(f => f.isLoaded = true);

          const entries = allRows[i].querySelectorAll('.file-entry');
          entries.forEach(e => {
            e.classList.add('loaded', 'sent');
            const btn = e.querySelector('.btn-run');
            if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
              btn.innerText = "Loaded";
              btn.classList.remove('primary');
              btn.classList.add('success');
            }
          });
        } else {
          for (let fIdx = 0; fIdx <= activeContextMenuFileIndex; fIdx++) {
            if (gItem.files[fIdx]) {
              gItem.files[fIdx].isLoaded = true;
              const entry = allRows[i].querySelector(`.file-entry[data-file-index="${fIdx}"]`);
              if (entry) {
                entry.classList.add('loaded', 'sent');
                const btn = entry.querySelector('.btn-run');
                if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
                  btn.innerText = "Loaded";
                  btn.classList.remove('primary');
                  btn.classList.add('success');
                }
              }
            }
          }
          if (gItem.files.every(f => f.isLoaded)) {
            gItem.isLoaded = true;
            allRows[i].classList.add('loaded', 'sent');
          }
        }
      }
    }
  }
});

menuMarkLoaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  const gItem = globalParsedItems[targetIndex];
  if (targetIndex > -1 && gItem && gItem.files && gItem.files.length > 0) {
    if (activeContextMenuFileIndex === -1) {
      gItem.isLoaded = true;
      gItem.files.forEach(f => f.isLoaded = true);

      activeContextMenuRow.classList.add('loaded', 'sent');
      const entries = activeContextMenuRow.querySelectorAll('.file-entry');
      entries.forEach(e => {
        e.classList.add('loaded', 'sent');
        const btn = e.querySelector('.btn-run');
        if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
          btn.innerText = "Loaded";
          btn.classList.remove('primary');
          btn.classList.add('success');
        }
      });
    } else {
      if (gItem.files && gItem.files[activeContextMenuFileIndex]) {
        gItem.files[activeContextMenuFileIndex].isLoaded = true;
      }

      const entry = activeContextMenuRow.querySelector(`.file-entry[data-file-index="${activeContextMenuFileIndex}"]`);
      if (entry) {
        entry.classList.add('loaded', 'sent');
        const btn = entry.querySelector('.btn-run');
        if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
          btn.innerText = "Loaded";
          btn.classList.remove('primary');
          btn.classList.add('success');
        }
      }

      if (gItem.files && gItem.files.every(f => f.isLoaded)) {
        gItem.isLoaded = true;
        activeContextMenuRow.classList.add('loaded', 'sent');
      }
    }
  }
});

menuMarkUnloaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  const gItem = globalParsedItems[targetIndex];
  if (targetIndex > -1 && gItem) {
    if (activeContextMenuFileIndex === -1) {
      gItem.isLoaded = false;
      gItem.isLoading = false;
      if (gItem.files) gItem.files.forEach(f => {
        f.isLoaded = false;
        f.isLoading = false;
        f.isPlaceholderLoaded = false;
      });

      activeContextMenuRow.classList.remove('loaded', 'sent');
      const entries = activeContextMenuRow.querySelectorAll('.file-entry');
      entries.forEach(e => {
        e.classList.remove('loaded', 'sent', 'placeholder-loaded');
        const btn = e.querySelector('.btn-run');
        if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
          btn.innerText = "Load";
          btn.classList.remove('success');
          btn.classList.add('primary');
        }
      });
    } else {
      if (gItem.files && gItem.files[activeContextMenuFileIndex]) {
        gItem.files[activeContextMenuFileIndex].isLoaded = false;
        gItem.files[activeContextMenuFileIndex].isLoading = false;
        gItem.files[activeContextMenuFileIndex].isPlaceholderLoaded = false;
      }

      gItem.isLoaded = false;
      activeContextMenuRow.classList.remove('loaded', 'sent');

      const entry = activeContextMenuRow.querySelector(`.file-entry[data-file-index="${activeContextMenuFileIndex}"]`);
      if (entry) {
        entry.classList.remove('loaded', 'sent', 'placeholder-loaded');
        const btn = entry.querySelector('.btn-run');
        if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
          btn.innerText = "Load";
          btn.classList.remove('success');
          btn.classList.add('primary');
        }
      }
    }
  }
});

menuMarkFutureUnloaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex > -1) {
    for (let i = targetIndex; i < allRows.length; i++) {
      const gItem = globalParsedItems[i];
      if (gItem && gItem.files && gItem.files.length > 0) {
        if (i === targetIndex && activeContextMenuFileIndex !== -1) {
          for (let fIdx = activeContextMenuFileIndex; fIdx < gItem.files.length; fIdx++) {
            if (gItem.files[fIdx]) {
              gItem.files[fIdx].isLoaded = false;
              gItem.files[fIdx].isLoading = false;
              gItem.files[fIdx].isPlaceholderLoaded = false;
              const entry = allRows[i].querySelector(`.file-entry[data-file-index="${fIdx}"]`);
              if (entry) {
                entry.classList.remove('loaded', 'sent', 'placeholder-loaded');
                const btn = entry.querySelector('.btn-run');
                if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
                  btn.innerText = "Load";
                  btn.classList.remove('success');
                  btn.classList.add('primary');
                }
              }
            }
          }
          if (gItem.files.every(f => !f.isLoaded)) {
            gItem.isLoaded = false;
            allRows[i].classList.remove('loaded', 'sent');
          }
        } else {
          gItem.isLoaded = false;
          gItem.isLoading = false;
          gItem.files.forEach(f => {
            f.isLoaded = false;
            f.isLoading = false;
            f.isPlaceholderLoaded = false;
          });

          allRows[i].classList.remove('loaded', 'sent');
          const entries = allRows[i].querySelectorAll('.file-entry');
          entries.forEach(e => {
            e.classList.remove('loaded', 'sent', 'placeholder-loaded');
            const btn = e.querySelector('.btn-run');
            if (btn && !btn.disabled && btn.innerText !== "Missing" && btn.innerText !== "Sending...") {
              btn.innerText = "Load";
              btn.classList.remove('success');
              btn.classList.add('primary');
            }
          });
        }
      }
    }
  }
});

menuMarkFloated.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const item = globalParsedItems[targetIndex];
  const newFloatedState = !item.isFloated;

  if (item.rowId) {
    try {
      const res = await window.api.rundownRequest('setRowProperties', {
        RowID: item.rowId,
        Floated: newFloatedState ? "true" : "false"
      });
      if (!res.success) {
        showToast("Error toggling floated state on server: " + (res.error || "Unknown error"));
        return;
      }
    } catch (err) {
      showToast("Network Error toggling floated: " + err.message);
      return;
    }
  }

  item.isFloated = newFloatedState;

  if (newFloatedState) {
    activeContextMenuRow.classList.add('floated');
  } else {
    activeContextMenuRow.classList.remove('floated');
  }
});

menuStartTimer.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !globalParsedItems[targetIndex]) return;

  const item = globalParsedItems[targetIndex];

  if (!activeRundownId) {
    showToast("Cannot modify timer: No active Rundown loaded via API.");
    return;
  }

  if (!item.rowId) {
    showToast("Cannot modify timer: This row does not have a valid Row ID on the server.");
    return;
  }

  const isStopping = activeContextMenuRow.classList.contains('on-air');

  try {
    let res;
    if (isStopping) {
      optimisticUpdateTimerUI(0);
      res = await window.api.rundownRequest('startTimingRow', {
        RundownID: activeRundownId,
        RowID: 0
      });
    } else {
      optimisticUpdateTimerUI(item.rowId);
      res = await window.api.rundownRequest('startTimingRow', {
        RundownID: activeRundownId,
        RowID: item.rowId
      });
    }

    if (!res.success) {
      showToast(`Error ${isStopping ? 'stopping' : 'starting'} timer: ` + (res.error || "Unknown error"));
    } else {
      // Force an immediate poll to update the UI visually
      clearTimeout(timerPollTimeout);
      pollOnAirTimer();
    }
  } catch (err) {
    showToast(`Network Error ${isStopping ? 'stopping' : 'starting'} timer: ` + err.message);
  }
});



function getBlockFirstItemIndex(currentIndex) {
  let firstIdx = 0;
  for (let i = currentIndex; i >= 0; i--) {
    if (globalParsedItems[i].isBreak) {
      if (i === currentIndex) return i;
      firstIdx = i + 1;
      break;
    }
  }
  return firstIdx;
}

function optimisticUpdateTimerUI(rowId) {
  timerIgnoreApiUpdatesUntil = Date.now() + 2000; // Ignore stale API data for 2 seconds

  const allRows = document.querySelectorAll('.row-item');
  allRows.forEach(row => row.classList.remove('on-air'));

  if (!rowId || String(rowId) === "0") {
    activeOnAirRowId = null;
    activeOnAirStartDate = null;
    updateLiveTimers();
    return;
  }

  activeOnAirRowId = rowId;
  activeOnAirStartDate = Math.floor((Date.now() + serverTimeOffsetMs) / 1000);

  const targetIndex = globalParsedItems.findIndex(i => String(i.rowId) === String(rowId));
  if (targetIndex > -1) {
    const targetRow = document.getElementById(`row-item-${targetIndex + 1}`);
    if (targetRow) {
      targetRow.classList.add('on-air');
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  updateLiveTimers();
}

function formatDuration(seconds) {
  if (isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTimeOfDay(unixSeconds) {
  if (!unixSeconds) return '--:--:--';
  const d = new Date(unixSeconds * 1000);
  let hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  if (inUse24Hr && inUse24Hr.checked) {
    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
  } else {
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    hh = hh ? hh : 12; // 0 becomes 12
    return `${String(hh).padStart(2, '0')}:${mm}:${ss} ${ampm}`;
  }
}

function formatLiveTime(totalSeconds) {
  const isNegative = totalSeconds < 0;
  const absSec = Math.abs(totalSeconds);
  const m = Math.floor(absSec / 60).toString().padStart(2, '0');
  const s = (absSec % 60).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${m}:${s}`;
}

function updateLiveTimers() {
  const topTimerDisplay = document.getElementById('top-timer-display');
  const timerBlockElapsed = document.getElementById('timer-block-elapsed');
  const timerElapsed = document.getElementById('timer-elapsed');
  const timerRemaining = document.getElementById('timer-remaining');
  const timerBlockRemaining = document.getElementById('timer-block-remaining');

  const timerLiveContent = document.getElementById('timer-live-content');
  const timerIdleContent = document.getElementById('timer-idle-content');
  const timerIdleText = document.getElementById('timer-idle-text');

  if (!topTimerDisplay) return;

  const topClockDisplay = document.getElementById('top-clock-display');
  const nowUnix = Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
  const timeOfDayStr = formatTimeOfDay(nowUnix);

  if (topClockDisplay) {
    topClockDisplay.innerText = timeOfDayStr;
  }

  topTimerDisplay.style.visibility = 'visible';
  topTimerDisplay.style.opacity = '1';

  if (!activeOnAirRowId || !activeOnAirStartDate) {
    if (timerLiveContent) timerLiveContent.style.display = 'none';
    if (timerIdleContent) timerIdleContent.style.display = 'flex';

    if (activeRundownStartTime && activeRundownStartTime > nowUnix) {
      const timeUntil = activeRundownStartTime - nowUnix;
      const hours = Math.floor(timeUntil / 3600);
      const minutes = Math.floor((timeUntil % 3600) / 60);
      const seconds = timeUntil % 60;

      const pad = (num) => String(num).padStart(2, '0');
      let countdownStr = '';
      if (hours > 0) {
        countdownStr = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      } else {
        countdownStr = `${pad(minutes)}:${pad(seconds)}`;
      }

      if (timerIdleText) {
        timerIdleText.innerHTML = `Show Starts in <span style="color: var(--accent); margin-right: 4px;">${countdownStr}</span> at ${formatTimeOfDay(activeRundownStartTime)}`;
      }
    } else {
      if (timerIdleText) {
        timerIdleText.innerHTML = `<span style="color: var(--text-secondary);">Timer Idle</span>`;
      }
    }
    return;
  }

  if (timerLiveContent) timerLiveContent.style.display = 'flex';
  if (timerIdleContent) timerIdleContent.style.display = 'none';

  const targetIndex = globalParsedItems.findIndex(i => String(i.rowId) === String(activeOnAirRowId));
  if (targetIndex === -1) return;

  const currentItem = globalParsedItems[targetIndex];

  if (!isWindowFocused) {
    if (lastScrolledRowId !== activeOnAirRowId) {
      lastScrolledRowId = activeOnAirRowId;
      const rowEl = document.getElementById(`row-item-${targetIndex + 1}`);
      if (rowEl) {
        const contentEl = document.querySelector('.content');
        if (contentEl) {
          const contentRect = contentEl.getBoundingClientRect();
          const rowRect = rowEl.getBoundingClientRect();
          const desiredOffset = 150; // Leave space above for context
          const currentOffset = rowRect.top - contentRect.top;
          const scrollDiff = currentOffset - desiredOffset;
          contentEl.scrollBy({ top: scrollDiff, behavior: 'smooth' });
        }
      }
    }
  } else {
    lastScrolledRowId = null;
  }
  const elapsed = Math.max(0, nowUnix - activeOnAirStartDate);

  // Update Block Elapsed
  const firstItemIndex = getBlockFirstItemIndex(targetIndex);
  const firstItem = globalParsedItems[firstItemIndex];
  if (firstItem) {
    const firstItemRowId = firstItem.rowId;
    if (!blockEarliestRowData[firstItemRowId]) {
      blockEarliestRowData[firstItemRowId] = { rowIndex: targetIndex, startTime: activeOnAirStartDate };
    } else {
      if (targetIndex <= blockEarliestRowData[firstItemRowId].rowIndex) {
        blockEarliestRowData[firstItemRowId] = { rowIndex: targetIndex, startTime: activeOnAirStartDate };
      }
    }

    const earliestData = blockEarliestRowData[firstItemRowId];
    let sumBeforeEarliest = 0;
    for (let i = firstItemIndex; i < earliestData.rowIndex; i++) {
      sumBeforeEarliest += (globalParsedItems[i].estDuration || 0);
    }

    const earliestElapsed = Math.max(0, nowUnix - earliestData.startTime);
    if (timerBlockElapsed) timerBlockElapsed.innerText = formatLiveTime(sumBeforeEarliest + earliestElapsed);
  }

  // Update Elapsed
  timerElapsed.innerText = formatLiveTime(elapsed);

  // Update Remaining
  const estDur = currentItem.estDuration || 0;
  const remaining = estDur - Math.max(0, elapsed); // ensure elapsed is >=0
  timerRemaining.innerText = formatLiveTime(remaining);

  // Update Remaining in Block
  const clampedRemaining = Math.max(0, remaining);
  let subsequentSum = 0;
  for (let i = targetIndex + 1; i < globalParsedItems.length; i++) {
    const nextItem = globalParsedItems[i];
    if (nextItem.isBreak) break; // Reached end of block
    subsequentSum += (nextItem.estDuration || 0);
  }

  timerBlockRemaining.innerText = formatLiveTime(clampedRemaining + subsequentSum);

  // Update Over/Under
  const timerOnOver = document.getElementById('timer-on-over');
  if (timerOnOver && activeRundownEndTime) {
    let subsequentSumToEnd = 0;
    for (let i = targetIndex + 1; i < globalParsedItems.length; i++) {
      subsequentSumToEnd += (globalParsedItems[i].estDuration || 0);
    }
    const projectedEndTime = nowUnix + clampedRemaining + subsequentSumToEnd;
    const overUnderSecs = projectedEndTime - activeRundownEndTime;

    let isOver = overUnderSecs > 0;
    let absOverUnder = Math.floor(Math.abs(overUnderSecs));
    const mm = Math.floor(absOverUnder / 60).toString().padStart(2, '0');
    const ss = (absOverUnder % 60).toString().padStart(2, '0');

    if (absOverUnder === 0) {
      timerOnOver.innerText = "00:00";
      timerOnOver.style.color = "var(--text-primary)";
    } else {
      timerOnOver.innerText = `${isOver ? '+' : '-'}${mm}:${ss}`;
      timerOnOver.style.color = isOver ? "var(--error)" : "var(--success)";
    }
  }
}

// Start 500ms localized tick loop
setInterval(updateLiveTimers, 500);

async function pollOnAirTimer() {
  clearTimeout(timerPollTimeout);
  let nextDelay = 10000; // default 10s

  try {
    if (activeRundownId) {
      const res = await window.api.rundownRequest('getRundowns');
      if (res.success && res.data && Array.isArray(res.data)) {
        if (res.serverDate && !window.hasSyncedServerTime) {
          const sTime = new Date(res.serverDate).getTime();
          if (!isNaN(sTime)) {
            serverTimeOffsetMs = sTime - Date.now();
            window.hasSyncedServerTime = true;
          }
        }
        const activeRundown = res.data.find(r => String(r.RundownID) === String(activeRundownId));
        if (activeRundown) {
          if (Date.now() > timerIgnoreApiUpdatesUntil) {
            activeRundownStartTime = parseInt(activeRundown.Start, 10);
            activeRundownEndTime = parseInt(activeRundown.End, 10);

            const isActive = activeRundown.OnAirTimer_Active &&
              activeRundown.OnAirTimer_Active !== "0" &&
              activeRundown.OnAirTimer_Active !== "false" &&
              activeRundown.OnAirTimer_Active !== "null" &&
              activeRundown.OnAirTimer_RowID &&
              activeRundown.OnAirTimer_RowID !== "0" &&
              activeRundown.OnAirTimer_RowID !== "null" &&
              activeRundown.OnAirTimer_RowID !== "" &&
              activeRundown.OnAirTimer_RowID !== "-1" &&
              activeRundown.OnAirTimer_Date &&
              activeRundown.OnAirTimer_Date !== "0" &&
              activeRundown.OnAirTimer_Date !== "null" &&
              activeRundown.OnAirTimer_Date !== "";
            if (isActive) {
              nextDelay = 2000;
              const serverStartDate = parseInt(activeRundown.OnAirTimer_Date, 10);
              // Prevent 1-second UI jumping by ignoring minor server variance on the same active row
              if (activeOnAirRowId === activeRundown.OnAirTimer_RowID &&
                activeOnAirStartDate !== null &&
                Math.abs(activeOnAirStartDate - serverStartDate) <= 2) {
                // Keep the local activeOnAirStartDate to prevent jitter
              } else {
                activeOnAirRowId = activeRundown.OnAirTimer_RowID;
                activeOnAirStartDate = serverStartDate;
              }
            } else {
              activeOnAirRowId = null;
              activeOnAirStartDate = null;
            }
          } else {
            // Still in optimistic window, keep polling fast
            nextDelay = 2000;
          }

          const onAirRowId = activeRundown.OnAirTimer_RowID;

          // Clear all current on-air highlights
          const allRows = document.querySelectorAll('.row-item');
          allRows.forEach(row => row.classList.remove('on-air'));

          // Apply to the active one if found
          if (onAirRowId) {
            const targetIndex = globalParsedItems.findIndex(i => String(i.rowId) === String(onAirRowId));
            if (targetIndex > -1) {
              const targetRow = document.getElementById(`row-item-${targetIndex + 1}`);
              if (targetRow) {
                targetRow.classList.add('on-air');
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Silently fail on network/API errors so we don't spam the console
  }

  timerPollTimeout = setTimeout(pollOnAirTimer, nextDelay);
}

// Start the loop
pollOnAirTimer();

init(true);

// Global Hotkeys
document.addEventListener('keydown', (e) => {
  // Do not intercept if user is typing in an input, textarea, or select
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }

  // Prevent spacebar from natively clicking focused buttons
  if (e.code === 'Space' && document.activeElement && document.activeElement.tagName === 'BUTTON') {
    document.activeElement.blur();
  }

  // ENTER: Load Next
  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    btnLoadElement.click();
  }

  // CTRL + ENTER: Load Next Block
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    btnLoadBlock.click();
  }

  // SPACE: Start Timer on Next Row, SHIFT+SPACE: Previous Row
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.shiftKey) {
      startTimerOnPrevRow();
    } else {
      startTimerOnNextRow();
    }
  }

  // R: Refresh Rundown
  if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    btnRefreshRundown.click();
  }
});

async function startTimerOnNextRow() {
  if (!activeRundownId || globalParsedItems.length === 0) return;

  let nextItem = null;

  if (activeOnAirRowId) {
    // Find the row after the currently active one
    const currentIndex = globalParsedItems.findIndex(i => String(i.rowId) === String(activeOnAirRowId));
    if (currentIndex > -1 && currentIndex + 1 < globalParsedItems.length) {
      nextItem = globalParsedItems[currentIndex + 1];
    }
  } else {
    // If no timer is active, start on the row pointed to by "Next Slot" (1-indexed)
    const slotIdx = parseInt(inCurrentIndex.value, 10) - 1;
    if (slotIdx >= 0 && slotIdx < globalParsedItems.length) {
      nextItem = globalParsedItems[slotIdx];
    } else {
      nextItem = globalParsedItems[0];
    }
  }

  if (nextItem && nextItem.rowId) {
    try {
      optimisticUpdateTimerUI(nextItem.rowId);
      const res = await window.api.rundownRequest('startTimingRow', {
        RundownID: activeRundownId,
        RowID: nextItem.rowId
      });
      if (res.success) {
        // Force an immediate poll
        clearTimeout(timerPollTimeout);
        pollOnAirTimer();
      } else {
        showToast("Error starting timer: " + (res.error || "Unknown error"));
      }
    } catch (err) {
      showToast("Network Error starting timer: " + err.message);
    }
  }
}

async function startTimerOnPrevRow() {
  if (!activeRundownId || globalParsedItems.length === 0) return;

  let prevItem = null;

  if (activeOnAirRowId) {
    // Find the row before the currently active one
    const currentIndex = globalParsedItems.findIndex(i => String(i.rowId) === String(activeOnAirRowId));
    if (currentIndex > 0) {
      prevItem = globalParsedItems[currentIndex - 1];
    } else if (currentIndex === 0) {
      prevItem = globalParsedItems[0];
    }
  } else {
    // If no timer is active, start on the row pointed to by "Next Slot" (1-indexed) - 1
    const slotIdx = parseInt(inCurrentIndex.value, 10) - 1;
    if (slotIdx > 0 && slotIdx < globalParsedItems.length) {
      prevItem = globalParsedItems[slotIdx - 1];
    } else {
      prevItem = globalParsedItems[0];
    }
  }

  if (prevItem && prevItem.rowId) {
    try {
      optimisticUpdateTimerUI(prevItem.rowId);
      const res = await window.api.rundownRequest('startTimingRow', {
        RundownID: activeRundownId,
        RowID: prevItem.rowId
      });
      if (res.success) {
        // Force an immediate poll
        clearTimeout(timerPollTimeout);
        pollOnAirTimer();
      } else {
        showToast("Error starting timer: " + (res.error || "Unknown error"));
      }
    } catch (err) {
      showToast("Network Error starting timer: " + err.message);
    }
  }
}
