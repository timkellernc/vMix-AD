import { state, dom } from './state.js';
import { init, setupSettingsListeners } from './settings.js';
import { renderRows, appendRowItem, syncFileVisualState, syncRowFilesToServer, updateRowItem } from './dom.js';
import { startTimerOnNextRow, startTimerOnPrevRow, optimisticUpdateTimerUI, pollOnAirTimer, initClock } from './timers.js';
import { executeNextSpacebarAction } from './automation.js';
import { enqueueVmixAction, processBatch, startReadAheadQueue, pollMissingMedia } from './media.js';
import { refreshSignatureQuietly, getApiRowsSignature, loadApiRundown } from './api.js';
import { showToast } from './utils.js';

// Setup settings modal and settings-related listeners
setupSettingsListeners();

// Start background loops
pollOnAirTimer();
pollMissingMedia();
initClock();

// Initialize the app state
init(true);

// ============================================
// Main UI Button Listeners
// ============================================

dom.btnLoadCsv.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    dom.activeRundownTitle.innerText = file.name;
    state.activeRundownId = null;

    const reader = new FileReader();
    reader.onload = async event => {
      const text = event.target.result;
      const lines = text.split('\n');
      if (lines.length === 0) return;

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
      const slugIdx = headers.findIndex(h => h.includes('slug') || h.includes('story'));
      const fileIdx = headers.findIndex(h => h.includes('file') || h.includes('source') || h.includes('video'));
      const pageIdx = headers.findIndex(h => h.includes('page'));
      const segmentIdx = headers.findIndex(h => h.includes('segment'));
      const typeIdx = headers.findIndex(h => h.includes('type') || h.includes('format'));
      const scriptIdx = headers.findIndex(h => h.includes('script') || h.includes('body'));

      state.globalParsedItems = [];
      state.itemCount = 0;

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
            state.globalParsedItems.push({ page, slug, segment, script, requestedFile: '', originalFile: '', resolvedPath: null, isFallback: false, isFloated: false, isLoaded: false, isBreak });
          } else {
            for (const f of fileNames) {
              let searchName = f.trim();
              const mediaInfo = await window.api.resolveMedia(searchName);
              state.globalParsedItems.push({
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
      renderRows(state.globalParsedItems);
      
      const { syncAutomationUI } = await import('./automation.js');
      syncAutomationUI();

      await window.api.saveSettings({ lastRundownId: null, lastRundownTitle: null });
    };
    reader.readAsText(file);
  };
  input.click();
});

dom.btnInit.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    dom.btnInit.disabled = true;

    state.globalParsedItems.forEach(item => {
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

    const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
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

    dom.inCurrentIndex.value = 1; 
    const poolSize = parseInt(dom.inPoolSize.value) || 15;
    await processBatch(poolSize, false);
    dom.btnInit.disabled = false;
  });
});

dom.btnLoadBlock.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    dom.btnLoadBlock.disabled = true;
    const poolSize = parseInt(dom.inPoolSize.value) || 15;
    await processBatch(poolSize, true); 
    dom.btnLoadBlock.disabled = false;
  });
});

dom.btnLoadElement.addEventListener('click', () => {
  enqueueVmixAction(async () => {
    await processBatch(1, false);
  });
});

dom.inAutomationColumn.addEventListener('change', () => {
  state.currentAutomationColumnName = dom.inAutomationColumn.value;
  dom.btnRefreshRundown.click();
});

dom.inCurrentIndex.addEventListener('change', () => {
  const max = parseInt(dom.inPoolSize.value, 10) || 15;
  let val = parseInt(dom.inCurrentIndex.value, 10);

  if (isNaN(val)) return;
  if (val < 1) dom.inCurrentIndex.value = max;
  else if (val > max) dom.inCurrentIndex.value = 1;
});

dom.inCurrentIndex.addEventListener('keydown', (e) => {
  const max = parseInt(dom.inPoolSize.value, 10) || 15;
  let val = parseInt(dom.inCurrentIndex.value, 10);

  if (e.key === 'ArrowDown' && val === 1) {
    e.preventDefault();
    dom.inCurrentIndex.value = max;
  } else if (e.key === 'ArrowUp' && val === max) {
    e.preventDefault();
    dom.inCurrentIndex.value = 1;
  }
});

dom.btnRefreshRundown.addEventListener('click', () => {
  if (!state.activeRundownId) return;
  window.api.resetCompanionPush();
  refreshSignatureQuietly();
});

dom.btnResetRundown.addEventListener('click', async () => {
  if (!state.activeRundownId) return;
  window.api.resetCompanionPush();
  await loadApiRundown(state.activeRundownId, false, dom.activeRundownTitle.innerText);
});

dom.btnCloseRundowns.addEventListener('click', () => {
  dom.modalRundowns.classList.remove('visible');
});

dom.activeRundownTitle.addEventListener('click', async () => {
  const previousTitle = dom.activeRundownTitle.innerText;
  dom.activeRundownTitle.innerText = "Fetching...";
  try {
    let res = await window.api.rundownRequest('getRundowns');
    if (!res.success) throw new Error(res.error);
    if (!res.data || res.data.length === 0) throw new Error("No rundowns found.");

    const settings = await window.api.getSettings();
    if (dom.inRundownShowdir) dom.inRundownShowdir.value = settings.showDirectory || '';

    dom.selectRundown.innerHTML = '';
    let activeRundowns = res.data.filter(rd => rd.Archived !== 1 && rd.Template !== 1);

    activeRundowns.sort((a, b) => b.Start - a.Start);

    if (activeRundowns.length === 0) {
      throw new Error("No active (unarchived) rundowns found.");
    }

    activeRundowns.forEach(rd => {
      const option = document.createElement('option');
      option.value = rd.RundownID;
      option.innerText = rd.Title || rd.RundownID;
      dom.selectRundown.appendChild(option);
    });

    dom.modalRundowns.classList.add('visible');

  } catch (err) {
    console.error("Error fetching rundowns:", err);
    dom.selectRundown.innerHTML = '<option value="">Offline / Error - Use CSV Backup</option>';
    dom.modalRundowns.classList.add('visible');
  } finally {
    dom.activeRundownTitle.innerText = previousTitle;
  }
});

dom.btnLoadRundown.addEventListener('click', async () => {
  const option = dom.selectRundown.options[dom.selectRundown.selectedIndex];
  const title = option ? option.innerText : dom.selectRundown.value;
  
  const newShowDir = dom.inRundownShowdir ? dom.inRundownShowdir.value : '';
  if (dom.inShowdir) dom.inShowdir.value = newShowDir;
  
  await window.api.saveSettings({ 
    lastRundownId: dom.selectRundown.value, 
    lastRundownTitle: title,
    showDirectory: newShowDir
  });
  
  await loadApiRundown(dom.selectRundown.value, false, title);
  dom.modalRundowns.classList.remove('visible');
});

dom.btnRefreshRundown.addEventListener('click', async () => {
  const settings = await window.api.getSettings();
  if (settings.lastRundownId) {
    await loadApiRundown(settings.lastRundownId, true, settings.lastRundownTitle);
  } else {
    alert("No API rundown is currently loaded. Use 'Select Rundown' first.");
  }
});

if (dom.btnRundownSelectShowdir) {
  dom.btnRundownSelectShowdir.addEventListener('click', async () => {
    const dir = await window.api.selectDirectory();
    if (dir && dom.inRundownShowdir) dom.inRundownShowdir.value = dir;
  });
}

dom.btnResetRundown.addEventListener('click', async () => {
  const settings = await window.api.getSettings();
  if (settings.lastRundownId) {
    if (state.activeOnAirRowId) {
      optimisticUpdateTimerUI(0);
      try {
        await window.api.rundownRequest('startTimingRow', {
          RundownID: settings.lastRundownId,
          RowID: 0
        });
      } catch (e) {
        console.error("Failed to stop timer during reset", e);
      }
    }
    
    // Reset Next Slot to 1
    if (dom.inCurrentIndex) dom.inCurrentIndex.value = 1;
    
    // Explicitly zero out all items to clear "Loaded" DOM labels
    state.globalParsedItems = [];
    if (dom.rundownList) dom.rundownList.innerHTML = '';
    
    dom.btnResetRundown.innerText = "Resetting...";
    dom.btnResetRundown.disabled = true;
    
    await loadApiRundown(settings.lastRundownId, false, settings.lastRundownTitle);
    
    // Rescan durations for valid media files
    for (const item of state.globalParsedItems) {
      if (item.files) {
        for (const file of item.files) {
          if (file.resolvedPath && file.resolvedPath.match(/\.(mp4|mov|webm|mkv|mxf|mpg|m4v|ts)$/i)) {
            try {
              const dur = await window.api.getVideoDuration(file.resolvedPath);
              if (dur && !isNaN(dur) && Math.abs((item.estDuration || 0) - dur) > 1) {
                item.estDuration = dur;
                // Update the row-est-duration UI span visually
                const row = document.querySelector(`.row-item[data-row-id="${item.rowId}"]`);
                if (row) {
                  const estInput = row.querySelector('.row-est-duration');
                  if (estInput) {
                    const mins = Math.floor(dur / 60);
                    const secs = Math.floor(dur % 60).toString().padStart(2, '0');
                    estInput.value = `${mins}:${secs}`;
                  }
                }
                // Push back to Rundown Creator (Disabled per user request)
                // await window.api.rundownRequest('updateRowField', {
                //   RundownID: settings.lastRundownId,
                //   RowID: item.rowId,
                //   EstimatedDuration: dur
                // });
              }
            } catch (err) {}
          }
        }
      }
    }
    
    dom.btnResetRundown.innerText = "Reset";
    dom.btnResetRundown.disabled = false;
  } else {
    alert("No API rundown is currently loaded. Use 'Select Rundown' first.");
  }
});

// ============================================
// Context Menu Actions
// ============================================
import { activeContextMenuRow, activeContextMenuFileIndex, itemCount } from './dom.js';

document.addEventListener('click', () => {
  dom.contextMenu.classList.add('hidden');
});

dom.menuAddElement.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const anchorItem = state.globalParsedItems[targetIndex];
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

  const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
});

dom.menuAddElementAbove.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const anchorItem = state.globalParsedItems[targetIndex];
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

  const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
});

dom.menuAddElementBelow.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const anchorItem = state.globalParsedItems[targetIndex];
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

  const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
});

dom.menuEditElement.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const anchorItem = state.globalParsedItems[targetIndex];
  if (anchorItem.files && anchorItem.files[activeContextMenuFileIndex]) {
    anchorItem.files[activeContextMenuFileIndex].isCustom = true;
    anchorItem.files[activeContextMenuFileIndex].isNewInjection = false;
  }

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });
});

dom.menuRemoveElement.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const anchorItem = state.globalParsedItems[targetIndex];

  if (anchorItem.files && anchorItem.files.length > 0) {
    anchorItem.files.splice(activeContextMenuFileIndex, 1);
  }

  const nextNode = activeContextMenuRow.nextSibling;
  activeContextMenuRow.remove();
  appendRowItem(anchorItem, nextNode);

  const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  allDOMRows.forEach((rowNode, idx) => {
    rowNode.id = `row-item-${idx + 1}`;
    const indexDiv = rowNode.querySelector('.row-index');
    if (indexDiv) indexDiv.innerText = idx + 1;
  });

  syncRowFilesToServer(anchorItem);
});

dom.menuMarkPrevLoaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex > -1) {
    for (let i = 0; i <= targetIndex; i++) {
      const gItem = state.globalParsedItems[i];
      if (gItem && gItem.files && gItem.files.length > 0) {
        if (i < targetIndex || activeContextMenuFileIndex === -1) {
          gItem.files.forEach((f, fIdx) => {
            f.isLoaded = true;
            syncFileVisualState(gItem, fIdx);
          });
        } else {
          for (let fIdx = 0; fIdx <= activeContextMenuFileIndex; fIdx++) {
            if (gItem.files[fIdx]) {
              gItem.files[fIdx].isLoaded = true;
              syncFileVisualState(gItem, fIdx);
            }
          }
        }
      }
    }
  }
});

dom.menuMarkLoaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  const gItem = state.globalParsedItems[targetIndex];
  if (targetIndex > -1 && gItem && gItem.files && gItem.files.length > 0) {
    if (activeContextMenuFileIndex === -1) {
      gItem.files.forEach((f, fIdx) => {
        f.isLoaded = true;
        syncFileVisualState(gItem, fIdx);
      });
    } else {
      if (gItem.files && gItem.files[activeContextMenuFileIndex]) {
        gItem.files[activeContextMenuFileIndex].isLoaded = true;
        syncFileVisualState(gItem, activeContextMenuFileIndex);
      }
    }
  }
  if (gItem.files && gItem.files.every(f => f.isLoaded)) {
    gItem.isLoaded = true;
    activeContextMenuRow.classList.add('loaded', 'sent');
  }
});

dom.menuMarkUnloaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  const gItem = state.globalParsedItems[targetIndex];
  if (targetIndex > -1 && gItem) {
    if (activeContextMenuFileIndex === -1) {
      if (gItem.files) gItem.files.forEach((f, fIdx) => {
        f.isLoaded = false;
        f.isLoading = false;
        f.isPlaceholderLoaded = false;
        syncFileVisualState(gItem, fIdx);
      });
    } else {
      if (gItem.files && gItem.files[activeContextMenuFileIndex]) {
        gItem.files[activeContextMenuFileIndex].isLoaded = false;
        gItem.files[activeContextMenuFileIndex].isLoading = false;
        gItem.files[activeContextMenuFileIndex].isPlaceholderLoaded = false;
        syncFileVisualState(gItem, activeContextMenuFileIndex);
      }
    }
  }
});

dom.menuMarkFutureUnloaded.addEventListener('click', () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex > -1) {
    for (let i = targetIndex; i < allRows.length; i++) {
      const gItem = state.globalParsedItems[i];
      if (gItem && gItem.files && gItem.files.length > 0) {
        if (i === targetIndex && activeContextMenuFileIndex !== -1) {
          for (let fIdx = activeContextMenuFileIndex; fIdx < gItem.files.length; fIdx++) {
            if (gItem.files[fIdx]) {
              gItem.files[fIdx].isLoaded = false;
              gItem.files[fIdx].isLoading = false;
              gItem.files[fIdx].isPlaceholderLoaded = false;
              syncFileVisualState(gItem, fIdx);
            }
          }
        } else {
          gItem.files.forEach((f, fIdx) => {
            f.isLoaded = false;
            f.isLoading = false;
            f.isPlaceholderLoaded = false;
            syncFileVisualState(gItem, fIdx);
          });
        }
      }
    }
  }
});

dom.menuMarkFloated.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const item = state.globalParsedItems[targetIndex];
  const newFloatedState = !item.isFloated;

  if (item.rowId) {
    try {
      const setRes = await window.api.rundownRequest('setRowProperties', {
        RowID: item.rowId,
        Floated: newFloatedState ? "true" : "false"
      });
      if (!setRes.success) throw new Error(setRes.error);
      refreshSignatureQuietly();
    } catch (err) {
      showToast("Error toggling floated state on server: " + (err.message || "Unknown error"));
      return;
    }
  }

  item.isFloated = newFloatedState;

  if (newFloatedState) {
    activeContextMenuRow.classList.add('floated');
  } else {
    activeContextMenuRow.classList.remove('floated');
  }

  updateRowItem(item, activeContextMenuRow, targetIndex + 1);
});

dom.menuStartTimer.addEventListener('click', async () => {
  if (!activeContextMenuRow) return;
  const allRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  const targetIndex = allRows.indexOf(activeContextMenuRow);
  if (targetIndex === -1 || !state.globalParsedItems[targetIndex]) return;

  const item = state.globalParsedItems[targetIndex];

  if (!state.activeRundownId) {
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
        RundownID: state.activeRundownId,
        RowID: 0
      });
    } else {
      optimisticUpdateTimerUI(item.rowId);
      res = await window.api.rundownRequest('startTimingRow', {
        RundownID: state.activeRundownId,
        RowID: item.rowId
      });
    }

    if (!res.success) {
      showToast(`Error ${isStopping ? 'stopping' : 'starting'} timer: ` + (res.error || "Unknown error"));
    } else {
      if (state.timerPollTimeout) clearTimeout(state.timerPollTimeout);
      pollOnAirTimer();
    }
  } catch (err) {
    showToast(`Network Error ${isStopping ? 'stopping' : 'starting'} timer: ` + err.message);
  }
});

// ============================================
// Global Hotkeys
// ============================================

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }

  if (e.code === 'Space' && document.activeElement && document.activeElement.tagName === 'BUTTON') {
    document.activeElement.blur();
  }

  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    dom.btnLoadElement.click();
  }

  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    dom.btnLoadBlock.click();
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (e.shiftKey) {
      startTimerOnPrevRow();
    } else {
      executeNextSpacebarAction();
    }
  }

  if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    dom.btnRefreshRundown.click();
  }
});

// ============================================
// Companion API Integration
// ============================================

window.api.onCompanionAction((event, payload) => {
  if (!payload || !payload.action) return;
  switch (payload.action) {
    case 'spacebar':
      executeNextSpacebarAction();
      break;
    case 'loadBlock':
      dom.btnLoadBlock.click();
      break;
    case 'loadNext':
      dom.btnLoadElement.click();
      break;
    case 'initialize':
      dom.btnInitializeRundown.click();
      break;
  }
});

window.api.onCompanionError((event, errMessage) => {
  showToast("Companion API Push disabled due to connection error. Refresh to try again.");
});

export function pushStateToCompanion() {
  if (!state.globalParsedItems) return;
  
  const allRows = Array.from(document.querySelectorAll('.row-item'));
  const onAirIndex = allRows.findIndex(r => r.classList.contains('on-air'));
  
  let currentSlug = 'None';
  let nextSlug = 'None';
  
  if (onAirIndex !== -1 && state.globalParsedItems[onAirIndex]) {
    const item = state.globalParsedItems[onAirIndex];
    currentSlug = `${item.slug} ${item.segment || ''}`.trim();
    
    // Find next non-floated row
    for (let i = onAirIndex + 1; i < state.globalParsedItems.length; i++) {
      if (!state.globalParsedItems[i].isFloated) {
        const nextItem = state.globalParsedItems[i];
        nextSlug = `${nextItem.slug} ${nextItem.segment || ''}`.trim();
        break;
      }
    }
  }

  let liveCommand = 'None';
  let nextCommand = 'None';

  const liveBtn = document.querySelector('.btn-run-auto.program');
  if (liveBtn) liveCommand = liveBtn.innerText;

  const nextBtn = document.querySelector('.btn-run-auto.preview');
  if (nextBtn) nextCommand = nextBtn.innerText;

  const elBlockElapsed = document.getElementById('timer-block-elapsed');
  const elRowElapsed = document.getElementById('timer-elapsed');
  const elRemaining = document.getElementById('timer-remaining');
  const elBlockRemaining = document.getElementById('timer-block-remaining');
  const elOverUnder = document.getElementById('timer-on-over');

  const payload = {
    currentSlug,
    nextSlug,
    liveCommand,
    nextCommand,
    blockElapsed: elBlockElapsed ? elBlockElapsed.innerText : '00:00',
    rowElapsed: elRowElapsed ? elRowElapsed.innerText : '00:00',
    remaining: elRemaining ? elRemaining.innerText : '00:00',
    blockRemaining: elBlockRemaining ? elBlockRemaining.innerText : '00:00',
    overUnderTimer: elOverUnder ? elOverUnder.innerText : '--:--',
    isBatchProcessing: state.isBatchProcessing
  };

  window.api.syncCompanionState(payload);
}

// Ensure the sync happens periodically
setInterval(pushStateToCompanion, 250);
