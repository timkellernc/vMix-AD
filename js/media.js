import { state, dom } from './state.js';
import { getExt, showToast } from './utils.js';
import { syncFileVisualState } from './dom.js';

export function enqueueVmixAction(actionFn) {
  state.vmixActionQueue = state.vmixActionQueue.then(() => actionFn()).catch(err => console.error(err));
}

export async function getVmixActiveSlotTitles() {
  try {
    const res = await window.api.vmixRequest('');
    if (!res.success) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(res.data, "text/xml");

    const activeNodes = doc.querySelectorAll('active');
    const titles = [];

    activeNodes.forEach(node => {
      const activeNumber = node.textContent;
      const inputNode = doc.querySelector(`input[number="${activeNumber}"]`);
      if (inputNode) {
        titles.push(inputNode.getAttribute('title'));
      }
    });

    return titles;
  } catch (err) {
    console.error("Failed to parse vMix active slots:", err);
  }
  return [];
}

export async function resolveMixIndex(target) {
  if (target === null || target === undefined || target === '') return '';
  if (String(target).toLowerCase() === 'main') return 0;
  
  try {
    const res = await window.api.vmixRequest('');
    if (!res.success) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(res.data, "text/xml");
    
    let mixIndex = null;
    if (!isNaN(target)) {
      mixIndex = parseInt(target, 10);
    } else {
      const mixInputs = Array.from(doc.querySelectorAll('input[type="Mix"]'));
      const matchedIndex = mixInputs.findIndex(i => i.getAttribute('title') === target || i.getAttribute('shortTitle') === target);
      if (matchedIndex !== -1) {
        mixIndex = matchedIndex + 1;
      }
    }
    
    if (mixIndex !== null) {
      if (mixIndex === 0) return 0; // Main Mix
      
      const mixExists = doc.querySelector(`mix[number="${mixIndex + 1}"]`);
      if (mixExists) {
        return mixIndex;
      } else {
        return null;
      }
    }
  } catch (err) {
    console.error("Failed to resolve mix index:", err);
  }
  return null;
}

export async function getSafeSlot(desiredSlot) {
  if (!dom.inProtectProgram.checked) return desiredSlot;
  const activeTitles = await getVmixActiveSlotTitles();
  let slot = desiredSlot;
  const prefix = dom.inPrefix.value || 'Video';
  const poolSize = parseInt(document.getElementById('setting-poolsize')?.value) || 15;
  let attempts = 0;
  while (activeTitles.includes(`${prefix} ${slot}`) && attempts <= poolSize) {
    slot++;
    if (slot > poolSize) slot = 1;
    attempts++;
  }
  return slot;
}

export async function sendToVmix(item, slotIndex) {
  const prevItem = state.globalSlotMap[slotIndex];
  if (prevItem && prevItem !== item) {
    prevItem.loadedSlot = null;
    prevItem.isPlaceholderLoaded = false;

    if (prevItem._sourceFileObj) {
      if (prevItem._sourceFileObj.loadedSlot === slotIndex) {
        prevItem._sourceFileObj.loadedSlot = null;
        prevItem._sourceFileObj.isLoaded = false;
        prevItem._sourceFileObj.isPlaceholderLoaded = false;
        
        if (prevItem._sourceRowId && prevItem._sourceFileIndex !== undefined) {
          const row = document.getElementById(prevItem._sourceRowId);
          if (row) {
            const entry = row.querySelector(`.file-entry[data-file-index="${prevItem._sourceFileIndex}"]`);
            if (entry) {
              const btn = entry.querySelector('.btn-run');
              if (btn && btn.innerText === "Searching...") {
                btn.innerText = "Skipped";
                btn.classList.remove('success', 'primary');
                btn.style.borderColor = 'var(--text-secondary)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.backgroundColor = 'var(--panel-bg)';
                btn.style.animation = 'none'; 
              } else {
                // Determine the correct item to pass to syncFileVisualState
                const targetRowIdStr = prevItem._sourceRowId.replace('row-item-', '');
                const targetItemIndex = parseInt(targetRowIdStr) - 1;
                if (targetItemIndex >= 0 && targetItemIndex < state.globalParsedItems.length) {
                  const itemToSync = state.globalParsedItems[targetItemIndex];
                  if (itemToSync) {
                    syncFileVisualState(itemToSync, prevItem._sourceFileIndex);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  state.globalSlotMap[slotIndex] = item;
  item.loadedSlot = slotIndex;
  if (item._sourceFileObj) {
    item._sourceFileObj.loadedSlot = slotIndex;
    item._sourceFileObj.isLoaded = true;
  }

  let targetPath = item.resolvedPath;
  let isPlaceholder = false;

  if (targetPath) {
    const recheck = await window.api.resolveMedia(targetPath);
    if (!recheck || !recheck.path) {
      targetPath = null;
      item.resolvedPath = null;
      if (item._sourceFileObj) item._sourceFileObj.resolvedPath = null;
    } else {
      targetPath = recheck.path;
      item.resolvedPath = recheck.path;
      if (item._sourceFileObj) item._sourceFileObj.resolvedPath = recheck.path;
    }
  }

  if (!targetPath) {
    if (!item.requestedFile) return; 
    isPlaceholder = true;
    item.isPlaceholderLoaded = true;
    if (item._sourceFileObj) item._sourceFileObj.isPlaceholderLoaded = true;
    targetPath = await window.api.getPlaceholderPath();
  } else {
    item.isPlaceholderLoaded = false;
    if (item._sourceFileObj) item._sourceFileObj.isPlaceholderLoaded = false;
  }

  const ext = isPlaceholder ? 'png' : getExt(item.originalFile);
  let type = "Video";
  if (state.imageExts.includes(ext) || isPlaceholder) type = "Image";
  else if (state.audioExts.includes(ext)) type = "AudioFile";
  else if (state.titleExts.includes(ext)) type = "Title";

  const prefix = dom.inPrefix.value || 'Video';
  const firstLoc = parseInt(dom.inFirstLoc.value) || 9;
  const inputName = `${prefix} ${slotIndex}`;

  const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]');
  let audioCmds = [];
  busCheckboxes.forEach(cb => {
    if (cb.checked) {
      audioCmds.push(`Function=AudioBusOn&Value=${encodeURIComponent(cb.value)}&Input=${encodeURIComponent(inputName)}`);
    } else {
      audioCmds.push(`Function=AudioBusOff&Value=${encodeURIComponent(cb.value)}&Input=${encodeURIComponent(inputName)}`);
    }
  });

  await window.api.vmixRequest(`Function=RemoveInput&Input=${encodeURIComponent(inputName)}`);
  await window.api.vmixRequest(`Function=AddInput&Value=${type}|${targetPath}`);

  const initialInputName = isPlaceholder ? 'placeholder.png' : item.originalFile;
  await window.api.vmixRequest(`Function=SetInputName&Value=${encodeURIComponent(inputName)}&Input=${encodeURIComponent(initialInputName)}`);

  const parallelCmds = [
    `Function=MoveInput&Value=${firstLoc + slotIndex - 1}&Input=${encodeURIComponent(inputName)}`,
    ...audioCmds,
    `Function=AudioAutoOff&Input=${encodeURIComponent(inputName)}`,
    `Function=AudioOff&Input=${encodeURIComponent(inputName)}`
  ];

  for (const cmd of parallelCmds) {
    await window.api.vmixRequest(cmd);
  }

  item.isLoaded = true;
  item.hasBeenLoaded = true;
  if (item._sourceFileObj) {
    item._sourceFileObj.isLoaded = true;
    item._sourceFileObj.hasBeenLoaded = true;
  }
}

export async function processBatch(count, limitToSegment = false) {
  state.isBatchProcessing = true;
  try {
    const poolSize = parseInt(dom.inPoolSize.value) || 15;
    let itemsSent = 0;
    let targetSegment = null;
    const usedSlots = new Set();
  
    let startIndex = 0;
    if (state.activeOnAirRowId) {
      const activeIdx = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
      if (activeIdx > -1) {
        startIndex = activeIdx;
      }
    }
  
    for (let i = startIndex; i < state.globalParsedItems.length; i++) {
      const item = state.globalParsedItems[i];
  
      if (!item.files || item.files.length === 0) continue;

    for (let fIdx = 0; fIdx < item.files.length; fIdx++) {
      const fileObj = item.files[fIdx];

      if (itemsSent >= count) return;
      if (item.isFloated || fileObj.isLoaded || fileObj.isLoading || fileObj.hasBeenLoaded || (!fileObj.resolvedPath && !fileObj.requestedFile)) continue;

      if (limitToSegment) {
        const getBlockLetter = (item) => {
          const match = (item.page || '').match(/^[a-zA-Z]+/);
          return match ? match[0].toUpperCase() : item.segment;
        };
        const itemBlock = getBlockLetter(item);

        if (targetSegment === null) {
          targetSegment = itemBlock;
        } else if (itemBlock !== targetSegment) {
          return; 
        }
      }

      fileObj.isLoading = true; 
      const baseSlotToUse = parseInt(dom.inCurrentIndex.value) || 1;

      const row = document.getElementById(`row-item-${i + 1}`);
      const entry = row ? row.querySelector(`.file-entry[data-file-index="${fIdx}"]`) : null;
      const btn = entry ? entry.querySelector('.btn-run') : null;

      const slotToUse = await getSafeSlot(baseSlotToUse);
      if (usedSlots.has(slotToUse)) {
        fileObj.isLoading = false;
        return; 
      }
      usedSlots.add(slotToUse);

      dom.inCurrentIndex.value = (slotToUse + 1 > (parseInt(dom.inPoolSize.value) || 15)) ? 1 : slotToUse + 1;

      if (btn) btn.innerText = "Sending...";

      const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx };
      await sendToVmix(dummyItemForVmix, slotToUse);
      fileObj.isLoading = false;

      syncFileVisualState(item, fIdx);

      let nextSlot = slotToUse + 1;
      if (nextSlot > poolSize) nextSlot = 1; 
      dom.inCurrentIndex.value = nextSlot;

      if (row) row.classList.add('sent', 'loaded'); 

      itemsSent++;
    }
  }
  } finally {
    state.isBatchProcessing = false;
  }
}

export async function processReadAheadQueue() {
  if (state.isBatchProcessing) return;
  if (!state.globalParsedItems || state.globalParsedItems.length === 0) return;

  const allRows = Array.from(document.querySelectorAll('.row-item'));
  let currentIndex = allRows.findIndex(r => r.classList.contains('on-air'));

  if (currentIndex === -1) {
    state.hasTriggeredAutomation = false;
    return;
  }

  if (!state.hasTriggeredAutomation) {
    return;
  }

  const enableLookaheadEl = document.getElementById('setting-enable-lookahead');
  if (enableLookaheadEl && !enableLookaheadEl.checked) return;

  const lookaheadElementsEl = document.getElementById('setting-lookahead-elements');
  const maxLookAhead = lookaheadElementsEl ? (parseInt(lookaheadElementsEl.value) || 3) : 3;

  let lookAheadCount = 0;

  for (let i = currentIndex; i < state.globalParsedItems.length && lookAheadCount < maxLookAhead; i++) {
    const item = state.globalParsedItems[i];
    if (item && item.files && item.files.length > 0 && !item.isFloated) {
      let hasValidVideo = false;

      for (let fIdx = 0; fIdx < item.files.length; fIdx++) {
        const f = item.files[fIdx];
        if (f.hasBeenPlayed) continue;

        if (lookAheadCount >= maxLookAhead) break;

        if (!f.resolvedPath && !f.requestedFile) continue;

        if (!f.isLoaded && !f.isLoading && !f.hasBeenLoaded) {
          f.isLoading = true;

          const baseSlotToUse = parseInt(dom.inCurrentIndex.value) || 1;
          const slotToUse = await getSafeSlot(baseSlotToUse);
          dom.inCurrentIndex.value = (slotToUse + 1 > (parseInt(document.getElementById('setting-poolsize')?.value) || 15)) ? 1 : slotToUse + 1;

          const dummyItemForVmix = { ...item, ...f, _sourceFileObj: f, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx, _automationCode: item.automationCode };

          const entry = allRows[i] ? allRows[i].querySelector(`.file-entry[data-file-index="${fIdx}"]`) : null;
          const btn = entry ? (entry.querySelector('.btn-run-file') || entry.querySelector('.btn-run')) : null;
          if (btn) btn.innerText = "Loading...";

          enqueueVmixAction(async () => {
            try {
              const result = await sendToVmix(dummyItemForVmix, slotToUse);
              f.loadedSlot = dummyItemForVmix.loadedSlot;
              f.isPlaceholderLoaded = dummyItemForVmix.isPlaceholderLoaded;
              if (result !== false) {
                f.isLoaded = true;
                f.hasBeenLoaded = true;
                f.isLoading = false;
                syncFileVisualState(item, fIdx);
              } else {
                f.isLoading = false;
                syncFileVisualState(item, fIdx);
              }
            } catch (e) {
              console.error("Auto Load error:", e);
              f.isLoading = false;
              if (btn) {
                btn.innerText = "ERROR";
                btn.classList.replace('primary', 'danger');
              }
              f.isLoading = false;
            }
          });
        }
        lookAheadCount++;
      }
    }
  }
}

export function startReadAheadQueue() {
  if (state.readAheadInterval) clearInterval(state.readAheadInterval);
  const tick = async () => {
    await processReadAheadQueue();
  };
  tick();
  state.readAheadInterval = setInterval(tick, 4000);
}

export async function pollMissingMedia() {
  clearTimeout(state.missingMediaPollTimeout);
  try {
    if (state.globalParsedItems.length === 0) return;

    for (let i = 0; i < state.globalParsedItems.length; i++) {
      const item = state.globalParsedItems[i];
      if (!item.files || item.files.length === 0) continue;

      for (let fIdx = 0; fIdx < item.files.length; fIdx++) {
        const fileObj = item.files[fIdx];

        if (!fileObj.requestedFile || (fileObj.resolvedPath && !fileObj.isFallback && !fileObj.isPlaceholderLoaded)) continue;

        const searchName = fileObj.requestedFile;
        const mediaInfo = await window.api.resolveMedia(searchName);

        if (mediaInfo && (!mediaInfo.isFallback || !fileObj.resolvedPath)) {
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

              if (fileObj.isPlaceholderLoaded && fileObj.loadedSlot) {
                enqueueVmixAction(async () => {
                  if (!fileObj.isPlaceholderLoaded || !fileObj.loadedSlot) return;

                  if (!entry) return;
                  const runBtn = entry.querySelector('.btn-run');
                  if (runBtn) runBtn.innerText = "Replacing...";

                  const dummyItemForVmix = { ...item, ...fileObj, _sourceFileObj: fileObj, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx };
                  await sendToVmix(dummyItemForVmix, fileObj.loadedSlot);

                  fileObj.isPlaceholderLoaded = false;
                  fileObj.isLoaded = true;
                  syncFileVisualState(item, fIdx);
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
    state.missingMediaPollTimeout = setTimeout(pollMissingMedia, 5000);
  }
}
