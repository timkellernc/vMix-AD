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

// Takes have priority over lookahead: while a take is sending commands or a transition is still
// rendering, lookahead loads hold off so they don't compete with it for vMix.
export function markVmixBusy(ms) {
  state.vmixBusyUntil = Math.max(state.vmixBusyUntil || 0, Date.now() + ms);
}

export function isVmixBusy() {
  return Date.now() < (state.vmixBusyUntil || 0);
}

// Resolves once vMix is free, or immediately if the current take needs this file (fileObj.needsNow).
export async function waitForVmixFree(fileObj) {
  while (isVmixBusy() && !(fileObj && fileObj.needsNow)) {
    await new Promise(r => setTimeout(r, 100));
  }
}

const LOAD_RETRY_DELAY_MS = 3000;
const VERIFY_ATTEMPTS = 6;
const VERIFY_INTERVAL_MS = 500;

// Looks up an input by its title in the vMix XML. Returns null if vMix can't be reached,
// otherwise { exists, type, duration } (duration in ms).
export async function getVmixInputInfo(inputName) {
  try {
    const res = await window.api.vmixRequest('');
    if (!res || !res.success) return null;
    const doc = new DOMParser().parseFromString(res.data, "text/xml");
    const node = Array.from(doc.querySelectorAll('input')).find(n => n.getAttribute('title') === inputName);
    if (!node) return { exists: false, type: null, duration: 0 };
    return {
      exists: true,
      type: node.getAttribute('type'),
      duration: parseInt(node.getAttribute('duration'), 10) || 0
    };
  } catch (err) {
    console.error("Failed to read vMix input info:", err);
    return null;
  }
}

// An input is healthy if it exists and, for video, vMix reports a non-zero duration (a failed import reads 0).
export async function isVmixInputHealthy(inputName, isVideo) {
  const info = await getVmixInputInfo(inputName);
  if (!info || !info.exists) return false;
  return !isVideo || info.duration > 0;
}

async function waitForInputHealthy(inputName, isVideo, gate) {
  for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
    if (gate) await gate();
    if (await isVmixInputHealthy(inputName, isVideo)) return true;
    await new Promise(r => setTimeout(r, VERIFY_INTERVAL_MS));
  }
  return false;
}

export async function sendToVmix(item, slotIndex) {
  window.api.logEvent(`LOAD START ${item.originalFile || item.requestedFile} -> slot ${slotIndex}${item._lookahead ? ' (lookahead)' : ''}`);
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
  item.loadFailed = false;
  if (item._sourceFileObj) {
    item._sourceFileObj.loadedSlot = slotIndex;
    item._sourceFileObj.isLoaded = true;
    item._sourceFileObj.loadFailed = false;
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

  const initialInputName = isPlaceholder ? 'placeholder.png' : item.originalFile;
  const parallelCmds = [
    `Function=MoveInput&Value=${firstLoc + slotIndex - 1}&Input=${encodeURIComponent(inputName)}`,
    ...audioCmds,
    `Function=AudioAutoOff&Input=${encodeURIComponent(inputName)}`,
    `Function=AudioOff&Input=${encodeURIComponent(inputName)}`
  ];

  // Lookahead loads yield to takes between every vMix call; takes and manual loads are never gated.
  const gate = item._lookahead ? () => waitForVmixFree(item._sourceFileObj) : null;

  const loadOnce = async () => {
    if (gate) await gate();
    await window.api.vmixRequest(`Function=RemoveInput&Input=${encodeURIComponent(inputName)}`);
    if (gate) await gate();
    await window.api.vmixRequest(`Function=AddInput&Value=${type}|${targetPath}`);
    if (gate) await gate();
    await window.api.vmixRequest(`Function=SetInputName&Value=${encodeURIComponent(inputName)}&Input=${encodeURIComponent(initialInputName)}`);
    for (const cmd of parallelCmds) {
      if (gate) await gate();
      await window.api.vmixRequest(cmd);
    }
  };

  const isVideoLoad = type === 'Video';
  await loadOnce();
  let verified = await waitForInputHealthy(inputName, isVideoLoad, gate);
  if (!verified) {
    console.warn(`[vMix load] ${inputName} failed verification, retrying in ${LOAD_RETRY_DELAY_MS}ms`);
    await new Promise(r => setTimeout(r, LOAD_RETRY_DELAY_MS));
    if (gate) await gate();
    await loadOnce();
    verified = await waitForInputHealthy(inputName, isVideoLoad, gate);
  }

  if (!verified) {
    for (const obj of [item, item._sourceFileObj]) {
      if (!obj) continue;
      obj.loadFailed = true;
      obj.isLoaded = false;
      obj.hasBeenLoaded = false;
      obj.isPlaceholderLoaded = false;
      obj.loadedSlot = null;
    }
    if (state.globalSlotMap[slotIndex] === item) state.globalSlotMap[slotIndex] = null;
    window.api.logEvent(`LOAD FAILED ${initialInputName} -> ${inputName}`);
    showToast(`Failed to load ${initialInputName} into ${inputName}.`, 'error');
    return false;
  }

  window.api.logEvent(`LOAD OK ${initialInputName} -> ${inputName}`);
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
      if (item.isFloated || fileObj.isLoaded || fileObj.isLoading || fileObj.hasBeenLoaded || fileObj.loadFailed || (!fileObj.resolvedPath && !fileObj.requestedFile)) continue;

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
      const batchResult = await sendToVmix(dummyItemForVmix, slotToUse);
      fileObj.isLoading = false;

      syncFileVisualState(item, fIdx);
      if (batchResult === false) continue;

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

  if (isVmixBusy()) return; // a take is running; try again on the next tick

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

        if (!f.isLoaded && !f.isLoading && !f.hasBeenLoaded && !f.loadFailed) {
          f.isLoading = true;

          const baseSlotToUse = parseInt(dom.inCurrentIndex.value) || 1;
          const slotToUse = await getSafeSlot(baseSlotToUse);
          dom.inCurrentIndex.value = (slotToUse + 1 > (parseInt(document.getElementById('setting-poolsize')?.value) || 15)) ? 1 : slotToUse + 1;

          const dummyItemForVmix = { ...item, ...f, _sourceFileObj: f, _sourceRowId: `row-item-${i + 1}`, _sourceFileIndex: fIdx, _automationCode: item.automationCode, _lookahead: true };

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

// Lookahead is event-driven: called whenever something changes that could put a new file inside the
// lookahead window (take finished, on-air row changed, missing file found, ...). Debounced, and held off
// until vMix is free so it never competes with a running take or transition.
export function requestLookahead() {
  clearTimeout(state.lookaheadTimer);
  const busyFor = Math.max(0, (state.vmixBusyUntil || 0) - Date.now());
  state.lookaheadTimer = setTimeout(async () => {
    if (isVmixBusy()) return requestLookahead(); // busy window was extended; wait again
    await processReadAheadQueue();
  }, busyFor + 50);
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
              requestLookahead();

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
                  const replaceResult = await sendToVmix(dummyItemForVmix, fileObj.loadedSlot);

                  if (replaceResult !== false) {
                    fileObj.isPlaceholderLoaded = false;
                    fileObj.isLoaded = true;
                  }
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

export async function clearVmix() {
  const poolSize = parseInt(document.getElementById('setting-poolsize')?.value) || 15;
  const placeholderPath = await window.api.getPlaceholderPath();
  const prefix = dom.inPrefix.value || 'Video';
  const firstLoc = parseInt(dom.inFirstLoc.value) || 9;

  dom.btnClearVmix.disabled = true;
  dom.btnClearVmix.innerText = "Clearing...";

  try {
    const activeTitles = dom.inProtectProgram.checked ? await getVmixActiveSlotTitles() : [];

    for (let slotIndex = 1; slotIndex <= poolSize; slotIndex++) {
      const inputName = `${prefix} ${slotIndex}`;

      if (activeTitles.includes(inputName)) {
        continue;
      }

      await window.api.vmixRequest(`Function=RemoveInput&Input=${encodeURIComponent(inputName)}`);
      
      const urlSafePath = encodeURIComponent(placeholderPath);
      await window.api.vmixRequest(`Function=AddInput&Value=Image|${urlSafePath}`);
      await window.api.vmixRequest(`Function=SetInputName&Value=${encodeURIComponent(inputName)}&Input=placeholder.png`);
      await window.api.vmixRequest(`Function=MoveInput&Value=${firstLoc + slotIndex - 1}&Input=${encodeURIComponent(inputName)}`);
      
      if (state.globalSlotMap[slotIndex]) {
        const oldItem = state.globalSlotMap[slotIndex];
        oldItem.loadedSlot = null;
        if (oldItem._sourceFileObj) {
          oldItem._sourceFileObj.loadedSlot = null;
          oldItem._sourceFileObj.isLoaded = false;
          oldItem._sourceFileObj.isPlaceholderLoaded = false;
        }
        state.globalSlotMap[slotIndex] = null;
      }
    }

    state.globalParsedItems.forEach((item, i) => {
      if (item.files) {
        item.files.forEach((f, fIdx) => {
          syncFileVisualState(item, fIdx);
        });
      }
    });

    dom.inCurrentIndex.value = 1;
    showToast("vMix slots cleared and reset.", "success");
  } catch (err) {
    console.error("Error clearing vMix:", err);
    showToast("Error clearing vMix.", "error");
  } finally {
    dom.btnClearVmix.disabled = false;
    dom.btnClearVmix.innerText = "Clear";
  }
}
