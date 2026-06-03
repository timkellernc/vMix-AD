import { state, dom } from './state.js';
import { renderRows } from './dom.js';
import { showToast } from './utils.js';
import { refreshSignatureQuietly, loadApiRundown } from './api.js';

export async function init(isStartup = false) {
  const settings = await window.api.getSettings();
  dom.inStation.value = settings.rundownCreatorRadioStation || '';
  dom.inKey.value = settings.rundownCreatorAPIKey || '';
  dom.inToken.value = settings.rundownCreatorAPIToken || '';
  dom.inShowdir.value = settings.showDirectory || '';
  dom.inDefaultsdir.value = settings.defaultsDirectory || '';
  dom.inVmixip.value = settings.vmixIP || '127.0.0.1:8088';
  dom.inPrefix.value = settings.inputPrefix || 'Video';
  dom.inFirstLoc.value = settings.firstInputLocation || 9;
  dom.inPoolSize.value = settings.poolSize || 15;
  dom.inProtectProgram.checked = settings.protectProgram !== false; 
  dom.inUse24Hr.checked = settings.use24Hr === true;
  state.currentAutomationColumnName = settings.automationColumnName || 'Switcher';
  dom.inAutomationColumn.value = state.currentAutomationColumnName;
  state.automationMappings = settings.automationMappings || [];
  dom.inFadeDuration.value = settings.fadeDuration || 500;
  dom.inUse24Hr.checked = settings.use24Hr === true; 

  if (state.activeRundownId && dom.btnRefreshRundown) {
    dom.btnRefreshRundown.click();
  }

  const defaultBuses = settings.audioBuses || ['A', 'B'];
  const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]');
  busCheckboxes.forEach(cb => {
    cb.checked = defaultBuses.includes(cb.value);
  });

  if (isStartup && settings.lastRundownId) {
    loadApiRundown(settings.lastRundownId, true, settings.lastRundownTitle);
  }
}

export function showConfirm(msg) {
  return new Promise((resolve) => {
    dom.modalConfirmMsg.innerText = msg;
    dom.modalConfirm.classList.add('visible');

    const handleOk = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      dom.modalConfirm.classList.remove('visible');
      dom.btnConfirmOk.removeEventListener('click', handleOk);
      dom.btnConfirmCancel.removeEventListener('click', handleCancel);
    };

    dom.btnConfirmOk.addEventListener('click', handleOk);
    dom.btnConfirmCancel.addEventListener('click', handleCancel);
  });
}

export async function checkUnsavedScriptChanges() {
  if (state.activeScriptItem && dom.modalScriptContent.value !== state.originalScriptText) {
    return await showConfirm("You have unsaved changes in this script. Are you sure you want to discard them?");
  }
  return true;
}

export function setupSettingsListeners() {
  dom.btnOpenSettings.addEventListener('click', () => {
    init(); 
    dom.modalSettings.classList.add('visible');
  });

  dom.btnCloseSettings.addEventListener('click', () => {
    dom.modalSettings.classList.remove('visible');
  });

  dom.btnCloseScript.addEventListener('click', async () => {
    if (!(await checkUnsavedScriptChanges())) return;
    dom.modalScript.classList.remove('visible');
    state.activeScriptItem = null;
  });

  dom.btnCancelScript.addEventListener('click', async () => {
    if (!(await checkUnsavedScriptChanges())) return;
    dom.modalScript.classList.remove('visible');
    state.activeScriptItem = null;
  });

  dom.btnSaveScript.addEventListener('click', async () => {
    if (!state.activeScriptItem || !state.activeScriptItem.rowId) return;

    const newText = dom.modalScriptContent.value;
    dom.btnSaveScript.innerText = "Saving...";
    dom.btnSaveScript.disabled = true;

    try {
      const payload = {
        RowID: state.activeScriptItem.rowId,
        Script: newText
      };

      payload.ReadRate = (state.activeScriptItem.readRate !== undefined && state.activeScriptItem.readRate !== null) ? state.activeScriptItem.readRate : 15;
      payload.ActualDuration = (state.activeScriptItem.actualDuration !== undefined && state.activeScriptItem.actualDuration !== null) ? state.activeScriptItem.actualDuration : 0;

      const res = await window.api.rundownRequest('saveScript', payload);

      if (res.success) {
        state.activeScriptItem.script = newText;
        dom.modalScript.classList.remove('visible');
        refreshSignatureQuietly();
      } else {
        showToast("Error saving script: " + (res.error || "Unknown API error"));
      }
    } catch (err) {
      showToast("Network Error saving script: " + err.message);
    } finally {
      dom.btnSaveScript.innerText = "Save Script";
      dom.btnSaveScript.disabled = true;
      state.originalScriptText = state.activeScriptItem ? state.activeScriptItem.script : '';
    }
  });

  dom.modalScriptContent.addEventListener('input', () => {
    dom.btnSaveScript.disabled = dom.modalScriptContent.value === state.originalScriptText;
  });

  dom.btnCapsScript.addEventListener('click', () => {
    if (dom.modalScriptContent.value) {
      dom.modalScriptContent.value = dom.modalScriptContent.value.toUpperCase();
      dom.modalScriptContent.dispatchEvent(new Event('input'));
    }
  });

  window.addEventListener('mousedown', async (e) => {
    if (e.target.classList.contains('modal')) {
      if (e.target.id === 'modal-confirm') return; 

      if (e.target.id === 'modal-script') {
        if (!(await checkUnsavedScriptChanges())) return;
      }
      e.target.classList.remove('visible');
      if (e.target.id === 'modal-script') state.activeScriptItem = null;
    }
  });

  dom.btnSaveSettings.addEventListener('click', async () => {
    const busCheckboxes = document.querySelectorAll('#setting-audio-buses input[type="checkbox"]:checked');
    const selectedBuses = Array.from(busCheckboxes).map(cb => cb.value);

    const settings = {
      rundownCreatorRadioStation: dom.inStation.value,
      rundownCreatorAPIKey: dom.inKey.value,
      rundownCreatorAPIToken: dom.inToken.value,
      showDirectory: dom.inShowdir.value,
      defaultsDirectory: dom.inDefaultsdir.value,
      vmixIP: dom.inVmixip.value,
      inputPrefix: dom.inPrefix.value,
      firstInputLocation: parseInt(dom.inFirstLoc.value) || 9,
      poolSize: parseInt(dom.inPoolSize.value) || 15,
      protectProgram: dom.inProtectProgram.checked,
      use24Hr: dom.inUse24Hr.checked,
      audioBuses: selectedBuses,
      automationColumnName: dom.inAutomationColumn.value,
      automationMappings: state.automationMappings,
      fadeDuration: parseInt(dom.inFadeDuration.value) || 500
    };
    await window.api.saveSettings(settings);

    renderRows(state.globalParsedItems);

    dom.modalSettings.classList.remove('visible');
  });

  dom.btnSelectShowdir.addEventListener('click', async () => {
    const dir = await window.api.selectDirectory();
    if (dir) dom.inShowdir.value = dir;
  });

  dom.btnSelectDefaultsdir.addEventListener('click', async () => {
    const dir = await window.api.selectDirectory();
    if (dir) dom.inDefaultsdir.value = dir;
  });

  dom.btnOpenMappings.addEventListener('click', () => {
    renderMappingsTable();
    dom.modalAutomationMappings.classList.add('visible');
  });

  dom.btnCloseMappings.addEventListener('click', () => dom.modalAutomationMappings.classList.remove('visible'));
  dom.btnCancelMappings.addEventListener('click', () => dom.modalAutomationMappings.classList.remove('visible'));

  dom.btnSaveMappings.addEventListener('click', async () => {
    const rows = dom.mappingsTbody.querySelectorAll('tr');
    const newMappings = [];
    rows.forEach(row => {
      const prefix = row.querySelector('.map-prefix').value.trim();
      if (!prefix) return;
      newMappings.push({
        prefix: prefix,
        type: row.querySelector('.map-type').value,
        function: row.querySelector('.map-func').value.trim(),
        target: row.querySelector('.map-target').value.trim(),
        value: row.querySelector('.map-value') ? row.querySelector('.map-value').value.trim() : ''
      });
    });

    state.automationMappings = newMappings;
    dom.modalAutomationMappings.classList.remove('visible');
  });

  dom.btnAddMapping.addEventListener('click', () => {
    addMappingRow({ prefix: '', type: 'Input', function: 'Cut', target: '', value: '' });
  });

  dom.btnScanDefaults.addEventListener('click', async () => {
    dom.scanResult.innerText = "Scanning...";
    await window.api.saveSettings({ defaultsDirectory: dom.inDefaultsdir.value });
    const count = await window.api.scanDefaultsNow();
    dom.scanResult.innerText = `Found ${count} fallback files.`;
  });
}

export function renderMappingsTable() {
  dom.mappingsTbody.innerHTML = '';
  if (state.automationMappings.length === 0) {
    addMappingRow({ prefix: 'C', type: 'Input', function: 'Cut', target: 'Camera 1', value: '' });
    addMappingRow({ prefix: 'M', type: 'Mic', function: 'AudioOn', target: 'Anchor Mic', value: '' });
    addMappingRow({ prefix: 'CG', type: 'Overlay', function: 'OverlayInput1In', target: 'LowerThird.gtzip', value: '' });
    addMappingRow({ prefix: 'CGO', type: 'Overlay', function: 'OverlayInput1Out', target: 'LowerThird.gtzip', value: '' });
    addMappingRow({ prefix: 'D', type: 'Transition', function: 'Fade', target: '', value: '' });
  } else {
    state.automationMappings.forEach(m => addMappingRow(m));
  }
}

let draggedMappingRow = null;

export function addMappingRow(mapping) {
  const tr = document.createElement('tr');
  tr.draggable = true;
  tr.innerHTML = `
    <td class="drag-handle" style="cursor: grab; color: var(--text-secondary); text-align: center; user-select: none;">☰</td>
    <td><input type="text" class="map-prefix" value="${mapping.prefix || ''}" placeholder="e.g. C" style="width: 60px;"></td>
    <td>
      <select class="map-type">
        <option value="Input" ${mapping.type === 'Input' ? 'selected' : ''}>Input (Camera/Video)</option>
        <option value="Mic" ${mapping.type === 'Mic' ? 'selected' : ''}>Microphone</option>
        <option value="Overlay" ${mapping.type === 'Overlay' ? 'selected' : ''}>Overlay (CG)</option>
        <option value="Transition" ${mapping.type === 'Transition' ? 'selected' : ''}>Transition</option>
        <option value="Destination" ${mapping.type === 'Destination' ? 'selected' : ''}>Destination (Monitor/Mix)</option>
      </select>
    </td>
    <td><input type="text" class="map-func" value="${mapping.function || ''}" placeholder="e.g. Cut" style="width: 120px;"></td>
    <td><input type="text" class="map-target" value="${mapping.target || ''}" placeholder="e.g. Camera 1" style="width: 150px;"></td>
    <td><input type="text" class="map-value" value="${mapping.value || ''}" placeholder="e.g. 1" style="width: 80px;"></td>
    <td><button class="btn danger small btn-remove-mapping">&times;</button></td>
  `;
  tr.querySelector('.btn-remove-mapping').addEventListener('click', () => tr.remove());

  tr.addEventListener('dragstart', (e) => {
    draggedMappingRow = tr;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', tr.innerHTML);
    tr.style.opacity = '0.5';
  });

  tr.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
  });

  tr.addEventListener('dragenter', (e) => {
    e.preventDefault();
    tr.style.borderTop = '2px solid var(--accent-color)';
  });

  tr.addEventListener('dragleave', () => {
    tr.style.borderTop = '';
  });

  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tr.style.borderTop = '';
    if (draggedMappingRow && draggedMappingRow !== tr) {
      const tbody = tr.parentNode;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const draggedIndex = rows.indexOf(draggedMappingRow);
      const targetIndex = rows.indexOf(tr);
      if (draggedIndex < targetIndex) {
        tbody.insertBefore(draggedMappingRow, tr.nextSibling);
      } else {
        tbody.insertBefore(draggedMappingRow, tr);
      }
    }
    return false;
  });

  tr.addEventListener('dragend', () => {
    tr.style.opacity = '1';
    document.querySelectorAll('#mappings-tbody tr').forEach(row => row.style.borderTop = '');
    draggedMappingRow = null;
  });

  dom.mappingsTbody.appendChild(tr);
}
