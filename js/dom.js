import { state, dom } from './state.js';
import { getExt, formatDuration, parseDuration, formatTimeOfDay, showToast } from './utils.js';
import { enqueueVmixAction, sendToVmix, getSafeSlot } from './media.js';
import { executeTake, parseAutomationCode, syncAutomationUI } from './automation.js';
import { optimisticUpdateTimerUI, pollOnAirTimer } from './timers.js';
import { refreshSignatureQuietly } from './api.js';

export let itemCount = 0;
export let activeContextMenuRow = null;
export let activeContextMenuFileIndex = -1;

export async function syncRowFilesToServer(item) {
  try {
    const rowsRes = await window.api.rundownRequest('getRows', { RundownID: state.activeRundownId });
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
    refreshSignatureQuietly();
  } catch (err) {
    showToast("Error appending element to server: " + err.message);
  }
}

export function appendRowItem(item, insertBeforeNode = null) {
  const empty = dom.rundownList.querySelector('.empty-state');
  if (empty) empty.remove();

  itemCount++;

  const row = document.createElement('div');
  row.className = 'row-item';
  row.id = `row-item-${itemCount}`;
  if (item.rowId) row.dataset.rowId = item.rowId;

  let newFilesSig = item.automationCode || '';
  if (item.files) {
    newFilesSig += '||' + item.files.map(f => `${f.requestedFile}|${f.isLoaded}|${f.isPlaceholderLoaded}|${f.loadedSlot}`).join('||');
  }
  if (item.isCustom) newFilesSig += '||CUSTOM';
  row.dataset.filesSig = newFilesSig;

  if (item.isFloated) row.classList.add('floated');
  if (item.isBreak) row.classList.add('break');
  if (!item.files || item.files.length === 0) row.classList.add('no-media');
  if (item.isLoaded) row.classList.add('loaded', 'sent');
  if (String(item.rowId) === String(state.activeOnAirRowId)) row.classList.add('on-air');

  row.innerHTML = `
    <div class="row-index">${itemCount}</div>
    <div class="row-page">${item.page || ''}</div>
    <div class="row-title" title="${item.slug} ${item.segment || ''}">${item.slug} ${item.segment || ''}</div>
    <div class="row-auto-container" style="width: 140px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center; padding: 0 8px;">
      ${buildAutoHtml(item)}
    </div>
    <div class="row-files-container" style="flex: 4; display: flex; flex-direction: column; min-width: 0;">
      ${buildFilesHtml(item)}
    </div>
    <div class="row-actions">
      <input type="text" class="row-est-duration" value="${formatDuration(item.estDuration)}" title="Est. Duration (click to edit)" />
      <div class="row-front-time" style="width: 95px; text-align: center; color: var(--text-secondary); font-family: monospace; font-size: 0.875rem;">${formatTimeOfDay(item.frontTime)}</div>
      <div class="row-back-time" style="width: 95px; text-align: center; color: var(--text-secondary); font-family: monospace; font-size: 0.875rem;">${formatTimeOfDay(item.backTime)}</div>
    </div>
  `;

  attachFilesEventListeners(item, row);

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
              estInput.value = formatDuration(item.estDuration);
              return;
            }
            refreshSignatureQuietly();
          } catch (err) {
            showToast("Network Error updating duration: " + err.message);
            estInput.value = formatDuration(item.estDuration);
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
        estInput.blur();
      }
    });
    estInput.addEventListener('focus', () => {
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

    const contextMenu = document.getElementById('context-menu');
    const menuStartTimer = document.getElementById('menu-start-timer');
    const menuAddElementAbove = document.getElementById('menu-add-element-above');
    const menuAddElementBelow = document.getElementById('menu-add-element-below');
    const menuAddElement = document.getElementById('menu-add-element');
    const menuEditElement = document.getElementById('menu-edit-element');
    const menuRemoveElement = document.getElementById('menu-remove-element');
    const menuDividerRemove = document.getElementById('menu-divider-remove');
    const menuDividerAdd = document.getElementById('menu-divider-add');

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
    state.activeScriptItem = item;

    if (item.script) {
      dom.modalScriptContent.value = item.script;
      state.originalScriptText = item.script;
    } else {
      dom.modalScriptContent.value = 'Loading script...';
      state.originalScriptText = '';
    }

    const modalScriptTitle = document.getElementById('modal-script-title');
    if (modalScriptTitle) {
      modalScriptTitle.innerText = `${item.slug} ${item.segment || ''} - Script`;
    }
    dom.btnSaveScript.disabled = true;
    dom.modalScript.classList.add('visible');

    if (item.rowId) {
      try {
        let res = await window.api.rundownRequest('getScript', { RowID: item.rowId });
        if (res.success && res.data) {
          let scriptContent = '';
          let dataObj = Array.isArray(res.data) ? res.data[0] : res.data;

          if (dataObj) {
            if (dataObj.ReadRate !== undefined) state.activeScriptItem.readRate = dataObj.ReadRate;
            if (dataObj.ActualDuration !== undefined) state.activeScriptItem.actualDuration = dataObj.ActualDuration;

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

          if (dom.modalScriptContent.value !== scriptContent) {
            if (!dom.btnSaveScript.disabled) {
              showToast("A newer version of the script was found on the server, but you have unsaved changes.", "error");
            } else {
              dom.modalScriptContent.value = scriptContent;
              state.originalScriptText = scriptContent;
              item.script = scriptContent;
            }
          }
        } else if (!item.script) {
          dom.modalScriptContent.value = 'Error loading script or script is empty.';
        }
      } catch (e) {
        if (!item.script) dom.modalScriptContent.value = 'Network Error: ' + e.message;
        console.error('Background script fetch failed:', e);
      }
    } else if (!item.script) {
      showToast('No script available for this item.');
    }
  });

  if (insertBeforeNode) {
    dom.rundownList.insertBefore(row, insertBeforeNode);
  } else {
    dom.rundownList.appendChild(row);
  }

  return row;
}

export function buildAutoHtml(item) {
  if (!item.automationCode) return '';
  const autoCommands = item.automationCode.split(/[ ,;]+/).filter(c => c.trim().length > 0);
  let html = '';
  autoCommands.forEach(cmd => {
    html += `<button class="btn small btn-run-auto" data-auto-cmd="${cmd}" style="margin: 2px;">${cmd}</button>`;
  });
  return html;
}

export function buildFilesHtml(item) {
  let filesHtml = '';

  if (item.files && item.files.length > 0) {
    item.files.forEach((file, index) => {
      let fallbackHtml = '';
      if (file.isFallback) fallbackHtml = '<span class="row-fallback-badge">Fallback</span>';

      const displayFile = file.originalFile;
      const resolvedPath = file.resolvedPath;

      let fileClass = 'row-file';
      if (file.originalFile && !file.resolvedPath) fileClass += ' missing-file';

      let btnText = 'Load';
      let btnClass = 'primary';
      if (file.isPlaceholderLoaded) {
        btnText = 'Searching...';
        btnClass = 'success';
      } else if (file.isLoaded) {
        btnText = file.loadedSlot ? `Loaded [${file.loadedSlot}]` : 'Loaded';
        btnClass = 'success';
      }

      let fileContent = '';
      if (file.isCustom) {
        const prefill = file.requestedFile || file.originalFile || '';
        fileContent = `<input type="text" class="custom-source-input" data-file-index="${index}" placeholder="Type filename..." value="${prefill}" style="width: 100%; background: transparent; color: white; border: none; outline: none; border-bottom: 1px solid var(--accent); font-family: monospace;" />`;
      } else {
        fileContent = `${displayFile || ''} <span class="row-duration"></span> ${fallbackHtml}`;
      }

      filesHtml += `
        <div class="file-entry" data-file-index="${index}" style="display: flex; align-items: center; padding: 4px 0;">
          <div class="${fileClass}" title="${resolvedPath || ''}" style="flex: 1; margin-right: 12px; min-width: 0;">
            ${fileContent}
          </div>
          <button class="btn ${btnClass} small btn-run btn-run-file" data-file-index="${index}">${btnText}</button>
        </div>
      `;
    });
  } else {
    if (item.isCustom) {
      filesHtml += `
        <div class="file-entry" data-file-index="0" style="display: flex; align-items: center; padding: 4px 0;">
          <div class="row-file" style="flex: 1; margin-right: 12px; opacity: 0.4; min-width: 0;">
            <input type="text" class="custom-source-input" data-file-index="0" placeholder="Type filename..." style="width: 100%; background: transparent; color: white; border: none; outline: none; border-bottom: 1px solid var(--accent); font-family: monospace;" />
          </div>
          <button class="btn primary small btn-run btn-run-file" data-file-index="0">LOAD</button>
        </div>
      `;
    } else {
      filesHtml += `
        <div class="file-entry" data-file-index="0" style="display: flex; align-items: center; padding: 4px 0;">
          <div class="row-file" style="flex: 1; margin-right: 12px; opacity: 0.4;">
            <span class="row-duration"></span>
          </div>
        </div>
      `;
    }
  }
  return filesHtml;
}

export function syncFileVisualState(item, fileIndex) {
  const rowId = `row-item-${state.globalParsedItems.findIndex(i => i === item) + 1}`;
  const row = document.getElementById(rowId);
  if (!row) return;

  const fileObj = item.files[fileIndex];
  if (!fileObj) return;

  const entry = row.querySelector(`.file-entry[data-file-index="${fileIndex}"]`);
  if (!entry) return;

  const btnRun = entry.querySelector('.btn-run-file') || entry.querySelector('.btn-run');

  entry.classList.toggle('loaded', !!fileObj.isLoaded);
  entry.classList.toggle('sent', !!fileObj.isLoaded);
  entry.classList.toggle('placeholder-loaded', !!fileObj.isPlaceholderLoaded);

  if (btnRun) {
    if (fileObj.isLoading) {
      btnRun.innerText = "Loading...";
      btnRun.classList.remove('success');
      btnRun.classList.add('primary');
    } else if (fileObj.isPlaceholderLoaded) {
      btnRun.innerText = "Searching...";
      btnRun.classList.remove('primary');
      btnRun.classList.add('success');
    } else if (fileObj.isLoaded) {
      btnRun.innerText = fileObj.loadedSlot ? `Loaded [${fileObj.loadedSlot}]` : "Loaded";
      btnRun.classList.remove('primary');
      btnRun.classList.add('success');
    } else {
      btnRun.innerText = "Load";
      btnRun.classList.remove('success');
      btnRun.classList.add('primary');
      btnRun.style.borderColor = '';
      btnRun.style.color = '';
      btnRun.style.backgroundColor = '';
    }
  }

  const anyLoaded = item.files.some(f => f.isLoaded);
  row.classList.toggle('loaded', anyLoaded);
  row.classList.toggle('sent', anyLoaded);
  item.isLoaded = anyLoaded;
}

export function attachFilesEventListeners(item, row) {
  const autoBtns = row.querySelectorAll('.btn-run-auto');
  autoBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      if (btn.innerText === "Sending...") return;
      const specificCmd = btn.dataset.autoCmd;
      if (!specificCmd) return;

      btn.innerText = "Sending...";
      const parsedTokens = parseAutomationCode(specificCmd);
      executeTake(item, parsedTokens, row).then(() => {
        btn.innerText = specificCmd;

        if (String(state.activeOnAirRowId) !== String(item.rowId)) {
          optimisticUpdateTimerUI(item.rowId, false);
          window.api.rundownRequest('startTimingRow', {
            RundownID: state.activeRundownId,
            RowID: item.rowId
          }).then(() => {
            clearTimeout(state.timerPollTimeout);
            pollOnAirTimer();
          });
        }

        state.activeOnAirCmdIndex = index;
        syncAutomationUI();
      }).catch(err => {
        console.error("Automation error:", err);
        btn.innerText = "ERROR";
      });
    });
  });

  const customInputs = row.querySelectorAll('.custom-source-input');
  customInputs.forEach(customInput => {
    const fileIndex = parseInt(customInput.getAttribute('data-file-index'));
    setTimeout(() => customInput.focus(), 50);

    let finalized = false;
    let isSyncing = false;
    const finalizeCustomRow = async () => {
      if (finalized || isSyncing) return;
      isSyncing = true;
      customInput.disabled = true;

      const val = customInput.value.trim();

      if (!val) {
        if (item.files && item.files[fileIndex]) {
          item.files.splice(fileIndex, 1);
        }
        if (!item.files || item.files.length === 0) item.isCustom = false;

        const nextNode = row.nextSibling;
        row.remove();
        appendRowItem(item, nextNode);

        const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
        allDOMRows.forEach((rowNode, idx) => {
          rowNode.id = `row-item-${idx + 1}`;
          const indexDiv = rowNode.querySelector('.row-index');
          if (indexDiv) indexDiv.innerText = idx + 1;
        });
        itemCount = allDOMRows.length;

        await syncRowFilesToServer(item);
        finalized = true;
        return;
      }

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

      const allDOMRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
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

    const btnRun = entry.querySelector('.btn-run-file') || entry.querySelector('.btn-run');
    const rowFile = entry.querySelector('.row-file');

    if (fileObj.resolvedPath) {
      rowFile.addEventListener('click', () => {
        window.api.openFile(fileObj.resolvedPath);
      });

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

    if (!fileObj.resolvedPath && btnRun) {
      btnRun.disabled = false;
      btnRun.style.opacity = '1';
    }
    syncFileVisualState(item, fileIndex);

    if (btnRun) {
      btnRun.addEventListener('click', async () => {
        if (btnRun.innerText === "Sending...") return;

        if (!fileObj.isLoaded) {
          enqueueVmixAction(async () => {
            btnRun.innerText = "Sending...";
            const baseSlotToUse = parseInt(dom.inCurrentIndex.value) || 1;
            const slotToUse = await getSafeSlot(baseSlotToUse);
            dom.inCurrentIndex.value = (slotToUse + 1 > (parseInt(document.getElementById('setting-poolsize')?.value) || 15)) ? 1 : slotToUse + 1;

            const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: row.id, _sourceFileIndex: fileIndex };
            const result = await sendToVmix(dummyItemForVmix, slotToUse);

            if (result !== false) {
              fileObj.isLoaded = true;
              fileObj.isLoading = false;
              syncFileVisualState(item, fileIndex);
            } else {
              btnRun.innerText = "Load";
            }
          });
        } else {
          if (fileObj.isPlaceholderLoaded) {
            showToast("Cannot transition to a placeholder. File is missing.");
            return;
          }
          const defaultTransitionFunc = 'Cut';
          const prefix = dom.inPrefix.value || 'Video';
          const inputName = `${prefix} ${fileObj.loadedSlot}`;
          if (fileObj.loadedSlot) {
            window.api.vmixRequest(`Function=${defaultTransitionFunc}&Input=${encodeURIComponent(inputName)}`);
            state.activeOnAirCmdIndex = -1;
          }
        }
      });
    }
  });
}

export function updateRowItem(item, row, newIndex) {
  row.id = `row-item-${newIndex}`;
  if (item.rowId) row.dataset.rowId = item.rowId;

  row.classList.toggle('floated', !!item.isFloated);
  row.classList.toggle('break', !!item.isBreak);
  row.classList.toggle('no-media', !item.files || item.files.length === 0);
  row.classList.toggle('loaded', !!item.isLoaded);
  row.classList.toggle('sent', !!item.isLoaded);

  const indexEl = row.querySelector('.row-index');
  if (indexEl) indexEl.innerText = newIndex;

  const pageEl = row.querySelector('.row-page');
  if (pageEl && pageEl.innerText !== (item.page || '')) pageEl.innerText = item.page || '';

  const titleEl = row.querySelector('.row-title');
  const newTitle = `${item.slug} ${item.segment || ''}`.trim();
  if (titleEl && titleEl.innerText !== newTitle) {
    titleEl.innerText = newTitle;
    titleEl.title = newTitle;
  }

  const estDurEl = row.querySelector('.row-est-duration');
  const newDur = formatDuration(item.estDuration);
  if (estDurEl && estDurEl.value !== newDur && document.activeElement !== estDurEl) {
    estDurEl.value = newDur;
  }

  const frontEl = row.querySelector('.row-front-time');
  const newFront = formatTimeOfDay(item.frontTime);
  if (frontEl && frontEl.innerText !== newFront) frontEl.innerText = newFront;

  const backEl = row.querySelector('.row-back-time');
  const newBack = formatTimeOfDay(item.backTime);
  if (backEl && backEl.innerText !== newBack) backEl.innerText = newBack;

  let newFilesSig = item.automationCode || '';
  if (item.files) {
    newFilesSig += '||' + item.files.map(f => `${f.requestedFile}|${f.isLoaded}|${f.isPlaceholderLoaded}|${f.loadedSlot}`).join('||');
  }
  if (item.isCustom) newFilesSig += '||CUSTOM';

  if (row.dataset.filesSig !== newFilesSig) {
    const filesContainer = row.querySelector('.row-files-container');
    if (filesContainer) {
      filesContainer.innerHTML = buildFilesHtml(item);
      const autoContainer = row.querySelector('.row-auto-container');
      if (autoContainer) autoContainer.innerHTML = buildAutoHtml(item);
      attachFilesEventListeners(item, row);
      row.dataset.filesSig = newFilesSig;

      syncAutomationUI();
    }
  }
}

export function renderRows(items) {
  let parsedItems = [...items];

  if (state.activeRundownStartTime) {
    let currentFrontTime = state.activeRundownStartTime;
    for (let i = 0; i < parsedItems.length; i++) {
      parsedItems[i].frontTime = currentFrontTime;
      currentFrontTime += (parsedItems[i].estDuration || 0);
    }
  }

  if (state.activeRundownEndTime) {
    let currentBackTime = state.activeRundownEndTime;
    for (let i = parsedItems.length - 1; i >= 0; i--) {
      currentBackTime -= (parsedItems[i].estDuration || 0);
      parsedItems[i].backTime = currentBackTime;
    }
  }

  state.globalParsedItems = parsedItems;

  const empty = dom.rundownList.querySelector('.empty-state');
  if (empty) empty.remove();

  if (state.globalParsedItems.length === 0) {
    dom.rundownList.innerHTML = '<div class="empty-state"><p>No items found.</p></div>';
    itemCount = 0;
    return;
  }

  const existingRowsMap = new Map();
  const existingRows = Array.from(dom.rundownList.querySelectorAll('.row-item'));
  existingRows.forEach(row => {
    if (row.dataset.rowId) existingRowsMap.set(String(row.dataset.rowId), row);
  });

  itemCount = 0;
  let currentDOMNode = dom.rundownList.firstElementChild;

  for (let i = 0; i < state.globalParsedItems.length; i++) {
    const item = state.globalParsedItems[i];
    const rowIdStr = String(item.rowId);

    if (rowIdStr && existingRowsMap.has(rowIdStr)) {
      const existingRow = existingRowsMap.get(rowIdStr);
      existingRowsMap.delete(rowIdStr);

      itemCount++;
      updateRowItem(item, existingRow, itemCount);

      if (currentDOMNode !== existingRow) {
        dom.rundownList.insertBefore(existingRow, currentDOMNode);
      } else {
        currentDOMNode = currentDOMNode.nextElementSibling;
      }
    } else {
      appendRowItem(item, currentDOMNode);
    }
  }

  existingRowsMap.forEach(row => row.remove());
}
