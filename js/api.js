import { state, dom } from './state.js';
import { renderRows } from './dom.js';
import { pollOnAirTimer } from './timers.js';

export function getFileField(r) {
  if (state.sourceColId && r[state.sourceColId]) return r[state.sourceColId];
  const fileKey = Object.keys(r).find(k => ['file', 'source', 'video'].includes(k.toLowerCase()));
  return fileKey ? r[fileKey] : '';
}

export function getAutoCodeField(r) {
  if (state.autoColId && r[state.autoColId]) return r[state.autoColId];
  const colNameLower = (state.currentAutomationColumnName || dom.inAutomationColumn.value || 'Switcher').toLowerCase();
  const rowKey = Object.keys(r).find(k => k.toLowerCase() === colNameLower);
  return rowKey ? r[rowKey] : '';
}

export function getApiRowsSignature(apiRows) {
  return JSON.stringify(apiRows.map(r => ({
    id: r.RowID || r.ID || r.id || '',
    slug: r.StorySlug || '',
    script: r.Script || r.Body || r.StoryBody || '',
    est: r.EstimatedDuration || r.Duration || 0,
    page: r.PageNumber || '',
    type: r.Type || r.RowType || '',
    file: getFileField(r),
    floated: r.Floated || '',
    autoCode: getAutoCodeField(r)
  })));
}

export function startAutoRefreshPolling() {
  if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
  state.autoRefreshInterval = setInterval(async () => {
    if (!state.activeRundownId || dom.btnRefreshRundown.disabled) return;

    try {
      let res = await window.api.rundownRequest('getRows', { RundownID: state.activeRundownId });
      if (res.success) {
        const newSig = getApiRowsSignature(res.data);
        if (state.lastRundownSignature && newSig !== state.lastRundownSignature) {
          if (!state.recentRundownSignatures.has(newSig)) {
            if (Date.now() - state.lastLocalUpdate < 15000) {
              state.lastRundownSignature = newSig;
              state.recentRundownSignatures.add(newSig);
            } else {
              dom.btnRefreshRundown.classList.add('flash-glow');
            }
          }
        } else {
          dom.btnRefreshRundown.classList.remove('flash-glow');
        }
      }
    } catch (e) {
      console.error("Auto-refresh poll failed", e);
    }
  }, 10000); // Check every 10 seconds
}

export async function refreshSignatureQuietly() {
  if (!state.activeRundownId) return;
  state.lastLocalUpdate = Date.now();
  try {
    let res = await window.api.rundownRequest('getRows', { RundownID: state.activeRundownId });
    if (res.success) {
      state.lastRundownSignature = getApiRowsSignature(res.data);
      state.recentRundownSignatures.add(state.lastRundownSignature);
      if (state.recentRundownSignatures.size > 10) {
        const iterator = state.recentRundownSignatures.values();
        state.recentRundownSignatures.delete(iterator.next().value);
      }
      dom.btnRefreshRundown.classList.remove('flash-glow');
    }
  } catch (e) {
    console.error("Quiet signature refresh failed", e);
  }
}

export async function loadApiRundown(rundownId, preserveState = false, rundownTitle = '') {
  dom.btnRefreshRundown.disabled = true;
  state.activeRundownId = rundownId;
  dom.activeRundownTitle.innerText = rundownTitle ? `Loading... (${rundownTitle})` : "Loading...";
  state.lastRundownSignature = null;
  state.recentRundownSignatures.clear();
  dom.btnRefreshRundown.classList.remove('flash-glow');

  let res = await window.api.rundownRequest('getRows', { RundownID: rundownId });
  dom.btnRefreshRundown.disabled = false;
  
  if (!res.success) {
    dom.rundownList.innerHTML = `<div class="empty-state"><p>Error loading rundown: ${res.error}</p></div>`;
    dom.activeRundownTitle.innerText = rundownTitle ? `${rundownTitle} (Error)` : "Error";
    return;
  }

  dom.activeRundownTitle.innerText = rundownTitle || "Active Rundown";
  state.lastRundownSignature = getApiRowsSignature(res.data);
  state.recentRundownSignatures.add(state.lastRundownSignature);
  startAutoRefreshPolling();

  let rdMetaStartTime = null;
  let rdMetaEndTime = null;
  let sourceColId = null;
  let autoColId = null;

  try {
    const [rds, cols] = await Promise.all([
      window.api.rundownRequest('getRundowns'),
      window.api.rundownRequest('getColumns')
    ]);

    if (rds.success && rds.data) {
      const rdMeta = rds.data.find(r => String(r.RundownID) === String(rundownId));
      if (rdMeta) {
        rdMetaStartTime = rdMeta.Start || null;
        rdMetaEndTime = rdMeta.End || null;

        const isActive = rdMeta.OnAirTimer_Active &&
          rdMeta.OnAirTimer_Active !== "0" &&
          rdMeta.OnAirTimer_Active !== "false" &&
          rdMeta.OnAirTimer_Active !== "null" &&
          rdMeta.OnAirTimer_RowID &&
          rdMeta.OnAirTimer_RowID !== "0" &&
          rdMeta.OnAirTimer_RowID !== "null" &&
          rdMeta.OnAirTimer_RowID !== "" &&
          rdMeta.OnAirTimer_RowID !== "-1" &&
          rdMeta.OnAirTimer_Date &&
          rdMeta.OnAirTimer_Date !== "0" &&
          rdMeta.OnAirTimer_Date !== "null" &&
          rdMeta.OnAirTimer_Date !== "";

        if (isActive) {
          state.activeOnAirRowId = rdMeta.OnAirTimer_RowID;
          state.activeOnAirStartDate = parseInt(rdMeta.OnAirTimer_Date, 10);
        } else {
          state.activeOnAirRowId = null;
          state.activeOnAirStartDate = null;
        }

        if (rds.serverDate && !window.hasSyncedServerTime) {
          const sTime = new Date(rds.serverDate).getTime();
          if (!isNaN(sTime)) {
            state.serverTimeOffsetMs = sTime - Date.now();
            window.hasSyncedServerTime = true;
          }
        }
      }
    }
    
    if (cols.success && cols.data) {
      const targetCol = cols.data.find(c => (c.Name_Remapped || '').toLowerCase() === 'source') || 
                        cols.data.find(c => (c.Name_Remapped || '').toLowerCase() === 'file') || 
                        cols.data.find(c => (c.Name_Remapped || '').toLowerCase() === 'video');
      if (targetCol) state.sourceColId = targetCol.ColumnID;

      const userAutoName = (state.currentAutomationColumnName || dom.inAutomationColumn.value || 'Switcher').toLowerCase();
      const targetAutoCol = cols.data.find(c => (c.Name_Remapped || '').toLowerCase() === userAutoName || (c.Name || '').toLowerCase() === userAutoName);
      if (targetAutoCol) state.autoColId = targetAutoCol.ColumnID;
    }
  } catch(e) {
    console.error("Failed to fetch rundown metadata/columns", e);
  }

  state.activeRundownStartTime = rdMetaStartTime;
  state.activeRundownEndTime = rdMetaEndTime;
  
  let currentStartTime = state.activeRundownStartTime;
  
  const newParsedItems = await Promise.all(res.data.map(async (r, i) => {
    let autoCode = getAutoCodeField(r);
    
    let front = currentStartTime;
    if (currentStartTime) {
      currentStartTime += (r.EstimatedDuration || r.Duration || 0);
    }

    let files = [];
    let existing = null;
    if (preserveState) {
      existing = state.globalParsedItems.find(ex => ex.rowId === (r.RowID || r.ID || r.id));
    }

    if (existing && existing.files && existing.files.length > 0) {
      files = existing.files;
    } else {
      let fileField = getFileField(r);
      
      if (i === 0) {
        window.DEBUG_ROW_DATA = JSON.stringify(r);
      }
      
      const filePaths = (fileField || '').split(',').map(f => f.trim()).filter(Boolean);
      for (const t of filePaths) {
        let resolvedPath = null;
        let originalFile = t;
        let isFallback = false;
        
        try {
          const mediaInfo = await window.api.resolveMedia(t);
          if (mediaInfo) {
            resolvedPath = mediaInfo.path;
            originalFile = mediaInfo.path.split(/[\\/]/).pop();
            isFallback = mediaInfo.isFallback;
          }
        } catch (e) { }

        files.push({
          requestedFile: t,
          isLoaded: false,
          isLoading: false,
          isPlaceholderLoaded: false,
          originalFile: originalFile,
          resolvedPath: resolvedPath,
          isFallback: isFallback,
          loadedSlot: null
        });
      }
    }

    return {
      rowId: r.RowID || r.ID || r.id,
      slug: r.StorySlug || '',
      script: r.Script || r.Body || r.StoryBody || '',
      estDuration: r.EstimatedDuration || r.Duration || 0,
      page: r.PageNumber || '',
      type: r.Type || r.RowType || '',
      isFloated: !!r.Floated,
      isBreak: (r.Type || r.RowType || '').toLowerCase().includes('break'),
      automationCode: autoCode,
      files: files,
      frontTime: front,
      backTime: null
    };
  }));

  renderRows(newParsedItems);

  if (state.activeOnAirRowId) {
    const onAirIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
    if (onAirIndex > -1) {
      const allRows = document.querySelectorAll('.row-item');
      if (allRows[onAirIndex]) allRows[onAirIndex].classList.add('on-air');
    }
  }
  
  if (!state.timerPollTimeout) pollOnAirTimer();
}

