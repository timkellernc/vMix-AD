import { state, dom } from './state.js';
import { renderRows } from './dom.js';
import { showToast } from './utils.js';
import { refreshSignatureQuietly, loadApiRundown } from './api.js';
import { testRawAutomation } from './automation.js';

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

  if (settings.mappingGroups) {
    state.mappingGroups = settings.mappingGroups;
  } else if (settings.automationMappings) {
    // Migration from old flat array to grouped format
    const groups = {};
    settings.automationMappings.forEach(m => {
      if (!groups[m.prefix]) {
        groups[m.prefix] = {
          id: 'group-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          prefix: m.prefix,
          title: m.prefix + ' Actions',
          commands: []
        };
      }
      groups[m.prefix].commands.push({
        type: m.type,
        function: m.function,
        target: m.target,
        value: m.value
      });
    });
    state.mappingGroups = Object.values(groups);
  } else {
    state.mappingGroups = [];
  }

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
      mappingGroups: state.mappingGroups,
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
  dom.btnCloseMappingsFooter.addEventListener('click', () => dom.modalAutomationMappings.classList.remove('visible'));

  dom.btnRunAutomationTest.addEventListener('click', async () => {
    const code = dom.inAutomationTest.value.trim();
    if (!code) {
      showToast('Please enter an automation string to test.', 'warning');
      return;
    }
    
    dom.btnRunAutomationTest.disabled = true;
    dom.btnRunAutomationTest.innerText = 'Running...';
    try {
      await testRawAutomation(code);
      showToast('Test executed successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error executing test', 'error');
    } finally {
      dom.btnRunAutomationTest.disabled = false;
      dom.btnRunAutomationTest.innerText = '▶ Run Test';
    }
  });

  dom.btnAddMappingGroup.addEventListener('click', () => {
    openGroupEditModal({
      id: 'group-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      prefix: '',
      title: '',
      commands: []
    }, true); 
  });

  dom.btnCloseGroup.addEventListener('click', () => dom.modalEditMappingGroup.classList.remove('visible'));
  dom.btnCancelGroup.addEventListener('click', () => dom.modalEditMappingGroup.classList.remove('visible'));

  dom.btnSaveGroup.addEventListener('click', async () => {
    if (!state.currentlyEditingGroup) return;
    
    state.currentlyEditingGroup.prefix = dom.groupPrefixInput.value.trim();
    state.currentlyEditingGroup.title = dom.groupTitleInput.value.trim();
    
    const cmdRows = dom.groupCommandsTbody.querySelectorAll('tr');
    const newCmds = [];
    cmdRows.forEach(row => {
      newCmds.push({
        type: row.querySelector('.map-type').value,
        function: row.querySelector('.map-func').value.trim(),
        target: row.querySelector('.map-target').value.trim(),
        value: row.querySelector('.map-value') ? row.querySelector('.map-value').value.trim() : ''
      });
    });
    
    state.currentlyEditingGroup.commands = newCmds;
    
    if (state.isNewGroup) {
      state.mappingGroups.push(state.currentlyEditingGroup);
    }
    
    const settings = { mappingGroups: state.mappingGroups };
    await window.api.saveSettings(settings);
    
    dom.modalEditMappingGroup.classList.remove('visible');
    renderMappingsTable();
  });

  dom.btnAddGroupCommand.addEventListener('click', () => {
    addGroupCommandRow({ type: 'Input', function: '', target: '', value: '' });
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
  if (state.mappingGroups.length === 0) {
    const defaults = [
      { id: '1', prefix: 'C', title: 'Cut to Camera', commands: [{ type: 'Input', function: 'Cut', target: 'Camera 1', value: '' }] },
      { id: '2', prefix: 'M', title: 'Anchor Mic Auto', commands: [{ type: 'Mic', function: 'AudioOn', target: 'Anchor Mic', value: '' }] },
      { id: '3', prefix: 'CG', title: 'Lower Third In', commands: [{ type: 'Overlay', function: 'OverlayInput1In', target: 'LowerThird.gtzip', value: '' }] },
      { id: '4', prefix: 'CGO', title: 'Lower Third Out', commands: [{ type: 'Overlay', function: 'OverlayInput1Out', target: 'LowerThird.gtzip', value: '' }] },
      { id: '5', prefix: 'D', title: 'Fade Transition', commands: [{ type: 'Transition', function: 'Fade', target: '', value: '' }] }
    ];
    state.mappingGroups = defaults;
    window.api.saveSettings({ mappingGroups: state.mappingGroups });
  }
  
  state.mappingGroups.forEach(group => addMappingGroupRow(group));
}

let draggedGroupRow = null;

export function addMappingGroupRow(group) {
  const tr = document.createElement('tr');
  tr.draggable = false;
  tr.dataset.groupId = group.id;
  
  const cmdSummary = group.commands.map(c => c.function || c.type).join(', ');
  
  tr.innerHTML = `
    <td class="drag-handle" style="cursor: grab; color: var(--text-secondary); text-align: center; user-select: none;">☰</td>
    <td><span class="badge" style="font-size: 0.9rem;">${group.prefix || '-'}</span></td>
    <td style="font-weight: 500;">${group.title || 'Untitled Group'}</td>
    <td style="color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${cmdSummary}">
      ${cmdSummary || 'No commands'}
    </td>
    <td>
      <button class="btn secondary small btn-edit-group" style="margin-right: 4px;">Edit</button>
      <button class="btn danger small btn-remove-group">&times;</button>
    </td>
  `;
  
  tr.querySelector('.btn-remove-group').addEventListener('click', async () => {
    state.mappingGroups = state.mappingGroups.filter(g => g.id !== group.id);
    tr.remove();
    await window.api.saveSettings({ mappingGroups: state.mappingGroups });
  });
  
  tr.querySelector('.btn-edit-group').addEventListener('click', () => {
    openGroupEditModal(group, false);
  });

  const dragHandle = tr.querySelector('.drag-handle');
  dragHandle.addEventListener('mousedown', () => { tr.draggable = true; });
  dragHandle.addEventListener('mouseup', () => { tr.draggable = false; });
  dragHandle.addEventListener('mouseleave', () => { tr.draggable = false; });

  tr.addEventListener('dragstart', (e) => {
    draggedGroupRow = tr;
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

  tr.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    tr.style.borderTop = '';
    if (draggedGroupRow && draggedGroupRow !== tr) {
      const tbody = tr.parentNode;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const draggedIndex = rows.indexOf(draggedGroupRow);
      const targetIndex = rows.indexOf(tr);
      if (draggedIndex < targetIndex) {
        tbody.insertBefore(draggedGroupRow, tr.nextSibling);
      } else {
        tbody.insertBefore(draggedGroupRow, tr);
      }
      
      const newRows = Array.from(tbody.querySelectorAll('tr'));
      const newGroups = newRows.map(row => state.mappingGroups.find(g => g.id === row.dataset.groupId));
      state.mappingGroups = newGroups;
      await window.api.saveSettings({ mappingGroups: state.mappingGroups });
    }
    return false;
  });

  tr.addEventListener('dragend', () => {
    tr.draggable = false;
    tr.style.opacity = '1';
    document.querySelectorAll('#mappings-tbody tr').forEach(row => row.style.borderTop = '');
    draggedGroupRow = null;
  });

  dom.mappingsTbody.appendChild(tr);
}

export function openGroupEditModal(group, isNew) {
  state.currentlyEditingGroup = group;
  state.isNewGroup = isNew;
  
  dom.modalGroupTitle.innerText = isNew ? "Add New Mapping Group" : "Edit Mapping Group";
  dom.groupPrefixInput.value = group.prefix || '';
  dom.groupTitleInput.value = group.title || '';
  
  dom.groupCommandsTbody.innerHTML = '';
  if (group.commands && group.commands.length > 0) {
    group.commands.forEach(cmd => addGroupCommandRow(cmd));
  } else if (isNew) {
    addGroupCommandRow({ type: 'Input', function: '', target: '', value: '' });
  }
  
  dom.modalEditMappingGroup.classList.add('visible');
}

let draggedCommandRow = null;

export function addGroupCommandRow(cmd) {
  const tr = document.createElement('tr');
  tr.draggable = false;
  tr.innerHTML = `
    <td class="drag-handle" style="cursor: grab; color: var(--text-secondary); text-align: center; user-select: none;">☰</td>
    <td>
      <select class="map-type" style="width: 100%; box-sizing: border-box;">
        <option value="Input" ${cmd.type === 'Input' ? 'selected' : ''}>Input (Camera/Video)</option>
        <option value="Macro" ${cmd.type === 'Macro' ? 'selected' : ''}>Macro (SOT/VO)</option>
        <option value="Mic" ${cmd.type === 'Mic' ? 'selected' : ''}>Microphone</option>
        <option value="Overlay" ${cmd.type === 'Overlay' ? 'selected' : ''}>Overlay (CG)</option>
        <option value="Transition" ${cmd.type === 'Transition' ? 'selected' : ''}>Transition</option>
        <option value="Destination" ${cmd.type === 'Destination' ? 'selected' : ''}>Destination (Monitor/Mix)</option>
        <option value="Custom API" ${cmd.type === 'Custom API' ? 'selected' : ''}>Custom API</option>
      </select>
    </td>
    <td><input type="text" class="map-func" value="${cmd.function || ''}" placeholder="e.g. Cut" style="width: 100%; box-sizing: border-box;"></td>
    <td><input type="text" class="map-target" value="${cmd.target || ''}" placeholder="e.g. Camera 1" style="width: 100%; box-sizing: border-box;"></td>
    <td><input type="text" class="map-value" value="${cmd.value || ''}" placeholder="e.g. 1" style="width: 100%; box-sizing: border-box;"></td>
    <td><button class="btn danger small btn-remove-cmd">&times;</button></td>
  `;
  
  tr.querySelector('.btn-remove-cmd').addEventListener('click', () => tr.remove());

  const dragHandle = tr.querySelector('.drag-handle');
  dragHandle.addEventListener('mousedown', () => { tr.draggable = true; });
  dragHandle.addEventListener('mouseup', () => { tr.draggable = false; });
  dragHandle.addEventListener('mouseleave', () => { tr.draggable = false; });

  tr.addEventListener('dragstart', (e) => {
    draggedCommandRow = tr;
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
    if (draggedCommandRow && draggedCommandRow !== tr) {
      const tbody = tr.parentNode;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const draggedIndex = rows.indexOf(draggedCommandRow);
      const targetIndex = rows.indexOf(tr);
      if (draggedIndex < targetIndex) {
        tbody.insertBefore(draggedCommandRow, tr.nextSibling);
      } else {
        tbody.insertBefore(draggedCommandRow, tr);
      }
    }
    return false;
  });

  tr.addEventListener('dragend', () => {
    tr.draggable = false;
    tr.style.opacity = '1';
    document.querySelectorAll('#group-commands-tbody tr').forEach(row => row.style.borderTop = '');
    draggedCommandRow = null;
  });

  dom.groupCommandsTbody.appendChild(tr);
}
