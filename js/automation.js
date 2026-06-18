import { state, dom } from './state.js';
import { optimisticUpdateTimerUI, pollOnAirTimer } from './timers.js';
import { getSafeSlot, sendToVmix, enqueueVmixAction, processReadAheadQueue, resolveMixIndex } from './media.js';
import { syncFileVisualState, updateRowItem } from './dom.js';
import { showToast } from './utils.js';

export function getNextStepCursor() {
  const getFirstCmdOfRow = (rIdx) => {
    if (rIdx >= state.globalParsedItems.length) return null;
    const item = state.globalParsedItems[rIdx];
    const cmds = item.automationCode ? item.automationCode.split(';').map(c => c.trim()).filter(c => c.length > 0) : [];
    return { row: rIdx, cmd: cmds.length > 0 ? 0 : -1 };
  };

  if (!state.activeOnAirRowId) {
    return getFirstCmdOfRow(0);
  }

  const currentIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
  if (currentIndex === -1) return getFirstCmdOfRow(0);

  const currentItem = state.globalParsedItems[currentIndex];
  const cmds = currentItem.automationCode ? currentItem.automationCode.split(';').map(c => c.trim()).filter(c => c.length > 0) : [];

  if (state.activeOnAirCmdIndex + 1 < cmds.length) {
    return { row: currentIndex, cmd: state.activeOnAirCmdIndex + 1 };
  } else {
    return getFirstCmdOfRow(currentIndex + 1);
  }
}

export async function calculatePreviewDelay() {
  let previewDelayMs = 1000;
  if (state.activeOnAirRowId && state.globalParsedItems) {
    const onAirIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
    if (onAirIndex >= 0) {
      const currentItem = state.globalParsedItems[onAirIndex];
      const cmds = currentItem.automationCode ? currentItem.automationCode.split(';').map(c => c.trim()).filter(c => c.length > 0) : [];
      if (state.activeOnAirCmdIndex >= 0 && state.activeOnAirCmdIndex < cmds.length) {
        const cmdStr = cmds[state.activeOnAirCmdIndex];
        const parsedArrays = parseAutomationCode(cmdStr);
        const tokens = parsedArrays.flat();
        
        let func = 'Cut';
        let explicitDur = null;

        const transToken = tokens.find(t => t.type === 'Transition');
        if (transToken) {
          if (transToken.function) func = transToken.function;
          if (transToken.number !== null) explicitDur = transToken.number;
        }

        const destToken = tokens.find(t => t.type === 'Destination');
        if (!transToken && destToken && destToken.function) {
          func = destToken.function;
        } else if (!transToken && !destToken) {
           const inputToken = tokens.find(t => t.type === 'Input');
           if (inputToken && inputToken.function) func = inputToken.function;
        }

        if (func.toLowerCase() === 'cut') {
           return 500; // Cut is instant, just wait 500ms
        }

        let defaultDur = parseInt(dom.inFadeDuration ? dom.inFadeDuration.value : '500', 10) || 500;

        if (!func.toLowerCase().includes('stinger')) {
           return (explicitDur !== null ? explicitDur : defaultDur) + 500;
        }

        try {
          const res = await window.api.vmixRequest('');
          if (res && res.success) {
            const parser = new DOMParser();
            const xml = parser.parseFromString(res.data, "text/xml");
            const transitions = xml.querySelectorAll('transitions transition');
            for (let t of transitions) {
              const eff = t.getAttribute('effect');
              const dur = t.getAttribute('duration');
              if (eff === func) {
                if (dur && parseInt(dur, 10) > 0) {
                  let parsedDur = parseInt(dur, 10);
                  previewDelayMs = (parsedDur * 2) + 200;
                }
                break;
              }
            }
          }
        } catch (e) { }
      }
    }
  }
  return previewDelayMs;
}

export function syncAutomationUI() {
  const nextCursor = getNextStepCursor();

  if (nextCursor) {
    if (nextCursor.row !== state.lastPreviewCursorRow || nextCursor.cmd !== state.lastPreviewCursorCmd) {
      state.lastPreviewCursorRow = nextCursor.row;
      state.lastPreviewCursorCmd = nextCursor.cmd;
      if (state.previewTimeout) clearTimeout(state.previewTimeout);
      
      calculatePreviewDelay().then(delayMs => {
        if (state.lastPreviewCursorRow === nextCursor.row && state.lastPreviewCursorCmd === nextCursor.cmd) {
          if (state.previewTimeout) clearTimeout(state.previewTimeout);
          state.previewTimeout = setTimeout(() => {
            previewNextCommand(nextCursor);
          }, delayMs);
        }
      });
    }
  } else {
    state.lastPreviewCursorRow = -1;
    state.lastPreviewCursorCmd = -1;
  }

  const onAirIndex = state.activeOnAirRowId ? state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId)) : -1;

  const allRows = document.querySelectorAll('.row-item');
  allRows.forEach((rowNode, rIdx) => {
    const autoBtns = rowNode.querySelectorAll('.btn-run-auto');
    autoBtns.forEach((btn, cIdx) => {
      btn.classList.remove('success', 'preview', 'program');

      if (rIdx < onAirIndex) {
        btn.classList.add('success'); 
      }
      else if (rIdx === onAirIndex) {
        if (cIdx < state.activeOnAirCmdIndex) {
          btn.classList.add('success'); 
        } else if (cIdx === state.activeOnAirCmdIndex) {
          btn.classList.add('program'); 
        } else if (nextCursor && nextCursor.row === rIdx && nextCursor.cmd === cIdx) {
          btn.classList.add('preview'); 
        }
      }
      else {
        if (nextCursor && nextCursor.row === rIdx && nextCursor.cmd === cIdx) {
          btn.classList.add('preview'); 
        }
      }
    });
  });
}

export async function executeNextSpacebarAction() {
  const nextCursor = getNextStepCursor();
  if (!nextCursor) return; 

  if (state.activeAutomationPromise) {
    state.flushAutomation = true;
    if (state.activeAutomationAbortController) {
      state.activeAutomationAbortController.abort();
    }
    try {
      await state.activeAutomationPromise;
    } catch(e) {}
  }
  state.flushAutomation = false;

  const item = state.globalParsedItems[nextCursor.row];
  if (nextCursor.cmd === -1) {
    const { startTimerOnRowId } = await import('./timers.js');
    startTimerOnRowId(item.rowId);
  } else {
    if (String(state.activeOnAirRowId) !== String(item.rowId)) {
      const { startTimerOnRowId } = await import('./timers.js');
      await startTimerOnRowId(item.rowId);
    }

    const cmds = item.automationCode ? item.automationCode.split(';').map(c => c.trim()).filter(c => c.length > 0) : [];
    const cmdToTake = cmds[nextCursor.cmd];
    const rowEl = document.getElementById(`row-item-${nextCursor.row + 1}`);

    const promise = executeTake(item, parseAutomationCode(cmdToTake), rowEl);
    state.activeAutomationPromise = promise;
    promise.finally(() => {
      if (state.activeAutomationPromise === promise) {
        state.activeAutomationPromise = null;
        state.flushAutomation = false;
      }
    });

    state.activeOnAirCmdIndex = nextCursor.cmd;
    syncAutomationUI();
  }
}

export async function previewNextCommand(cursor) {
  if (cursor.row < 0 || cursor.row >= state.globalParsedItems.length) return;
  const item = state.globalParsedItems[cursor.row];
  const cmds = item.automationCode ? item.automationCode.split(';').map(c => c.trim()).filter(c => c.length > 0) : [];
  if (cursor.cmd < 0 || cursor.cmd >= cmds.length) return;

  const cmdStr = cmds[cursor.cmd];
  const parsedArrays = parseAutomationCode(cmdStr);
  const tokens = parsedArrays.flat();

  const destToken = tokens.find(t => t.type === 'Destination');
  let destMix = null;
  if (destToken) {
    destMix = destToken.number !== null ? destToken.number : (destToken.target !== undefined ? destToken.target : null);
  }
    let mixParam = '';
    if (destMix !== null && destMix !== '') {
      const mixIndex = await resolveMixIndex(destMix);
      if (mixIndex !== undefined && mixIndex !== null && mixIndex !== '') {
        mixParam = `&Mix=${mixIndex}`;
      }
    }
  const inputToken = tokens.find(t => t.type === 'Input');

  if (inputToken) {
    let target = inputToken.target;
    if (inputToken.number !== null) {
      target = inputToken.number !== null ? `${inputToken.target}${inputToken.target.endsWith(' ') ? '' : ' '}${inputToken.number}` : inputToken.target;
    }
    if (target) {
      window.api.vmixRequest(`Function=PreviewInput&Input=${encodeURIComponent(target)}`);
    }
    return;
  }

  const hasSot = tokens.some(t => t.type === 'Macro' && t.function === 'SOT');
  const hasVo = tokens.some(t => t.type === 'Macro' && t.function === 'VO');
  const hasDest = tokens.some(t => t.type === 'Destination');
  const hasTrans = tokens.some(t => t.type === 'Transition');

  if (hasSot || hasVo || hasDest) {
    const prefix = dom.inPrefix.value || 'Video';
    if (item.files && item.files.length > 0) {
      const targetFileObj = item.files[0];
      if (targetFileObj && targetFileObj.loadedSlot) {
        const inputName = `${prefix} ${targetFileObj.loadedSlot}`;
        window.api.vmixRequest(`Function=PreviewInput&Input=${encodeURIComponent(inputName)}`);
      }
    }
    return;
  }

  if (!hasTrans) {
    try {
      const res = await window.api.vmixRequest('');
      if (res && res.success) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(res.data, "text/xml");
        const activeNode = xml.querySelector('active');
        if (activeNode) {
          const activeNumber = activeNode.textContent;
          window.api.vmixRequest(`Function=PreviewInput&Input=${activeNumber}`);
        }
      }
    } catch (e) {
      console.error("Failed to sync preview to active program:", e);
    }
  }
}

export function parseAutomationCode(codeString) {
  if (!codeString) return [];
  const commands = [];

  // Decode HTML entities that Rundown Creator might send
  let decodedCode = codeString
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  let quotes = [];
  let cleanCode = decodedCode.replace(/(["'“”‘’])(.*?)\1/g, (match, quote, content) => {
    quotes.push(content);
    return `__Q${quotes.length - 1}__`;
  });

  const subCommands = cleanCode.split(/[\s,]+/).filter(c => c.trim().length > 0);

  for (let subCmd of subCommands) {
    let text = subCmd.toUpperCase();

    const sortedMappings = [...state.automationMappings].sort((a, b) => b.prefix.length - a.prefix.length);

    const macros = [
      { prefix: 'SOT', type: 'Macro', function: 'SOT', target: '' },
      { prefix: 'VO', type: 'Macro', function: 'VO', target: '' },
      { prefix: 'V', type: 'Macro', function: 'VO', target: '' },
      { prefix: 'FS', type: 'Macro', function: 'VO', target: '' },
      { prefix: 'BWAIT', type: 'Macro', function: 'BWAIT', target: '' },
      { prefix: 'WAIT', type: 'Macro', function: 'WAIT', target: '' },
      { prefix: 'MOFF', type: 'Macro', function: 'MOFF', target: '' },
      { prefix: 'MO', type: 'Macro', function: 'MOFF', target: '' },
      { prefix: 'CGOFF', type: 'Macro', function: 'CGOFF', target: '' }
    ].sort((a, b) => b.prefix.length - a.prefix.length);

    const allTokens = [...macros, ...sortedMappings].sort((a, b) => b.prefix.length - a.prefix.length);

    let parsedTokens = [];
    while (text.length > 0) {
      let matched = false;
      for (const token of allTokens) {
        if (text.startsWith(token.prefix.toUpperCase())) {
          const matchedPrefix = token.prefix.toUpperCase();
          const remaining = text.substring(matchedPrefix.length);
          let num = null;
          let val = null;
          let advancedRemaining = remaining;

          const quoteMatch = remaining.match(/^__Q(\d+)__/);
          if (quoteMatch) {
            val = quotes[parseInt(quoteMatch[1], 10)];
            advancedRemaining = remaining.substring(quoteMatch[0].length);
          } else {
            const numMatch = remaining.match(/^(\d+)/);
            if (numMatch) {
              num = parseInt(numMatch[1], 10);
              advancedRemaining = remaining.substring(numMatch[0].length);
            }
          }

          const matchingTokens = allTokens.filter(t => t.prefix.toUpperCase() === matchedPrefix);
          const hasOverlay = matchingTokens.some(t => t.type === 'Overlay');
          let isOff = false;

          if (hasOverlay) {
            if (advancedRemaining.startsWith('OFF')) {
              isOff = true;
              advancedRemaining = advancedRemaining.substring(3);
            } else if (advancedRemaining.startsWith('O')) {
              isOff = true;
              advancedRemaining = advancedRemaining.substring(1);
            }
          }

          for (const t of matchingTokens) {
            parsedTokens.push({
              ...t,
              number: num,
              parsedValue: val,
              isOff: isOff
            });
          }

          text = advancedRemaining;
          matched = true;
          break;
        }
      }

      if (!matched) {
        console.warn("Unknown automation token at: ", text);
        text = text.substring(1);
      }
    }
    commands.push(parsedTokens);
  }
  return commands;
}

export async function executeTake(item, parsedTokensArray, rowElement) {
  let autoIncrementVideoIndex = 0;

  for (const tokens of parsedTokensArray) {
    await executeAutomationTokens(item, tokens, () => {
      let current = autoIncrementVideoIndex;
      autoIncrementVideoIndex++;
      return current;
    }, rowElement);
  }
  
  await processReadAheadQueue();
}

export async function executeAutomationTokens(item, tokens, getNextVideoIndex, rowElement) {
  state.hasTriggeredAutomation = true;
  let transitionToken = tokens.find(t => t.type === 'Transition');
  let explicitTransitionFunc = transitionToken ? transitionToken.function : null;
  let defaultDuration = dom.inFadeDuration ? dom.inFadeDuration.value : '500';
  let explicitTransitionDuration = transitionToken ? `&Duration=${transitionToken.number !== null ? transitionToken.number : defaultDuration}` : '';
  let defaultTransitionFunc = 'Cut';

  const micTokens = tokens.filter(t => t.type === 'Mic');
  const hasMoff = tokens.some(t => t.type === 'Macro' && (t.function === 'MOFF' || t.function === 'SOT'));

  if (hasMoff || micTokens.length > 0) {
    const allMics = state.automationMappings.filter(m => m.type === 'Mic');
    for (const m of allMics) {
      if (m.target) {
        await window.api.vmixRequest(`Function=AudioOff&Input=${encodeURIComponent(m.target)}`);
      }
    }

    for (const mt of micTokens) {
      let target = mt.target;
      if (mt.number !== null) {
        target = mt.number !== null ? `${mt.target}${mt.target.endsWith(' ') ? '' : ' '}${mt.number}` : mt.target;
      }
      if (target) {
        await window.api.vmixRequest(`Function=AudioOn&Input=${encodeURIComponent(target)}`);
      }
    }
  }

  let currentDestination = null;
  let currentDestFunc = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    
    const isRegularWait = (token.type === 'Macro' && token.function === 'WAIT') || token.type === 'Wait';
    const isBackgroundWait = (token.type === 'Macro' && token.function === 'BWAIT') || token.type === 'Background Wait';

    if (isRegularWait || isBackgroundWait) {
      let delayMs = token.number !== null ? token.number : (parseInt(token.value, 10) || parseInt(token.parsedValue, 10) || 0);

      if (delayMs > 0) {
        if (isBackgroundWait) {
          const remainingTokens = tokens.slice(i + 1);
          setTimeout(async () => {
             await executeAutomationTokens(item, remainingTokens, getNextVideoIndex, rowElement);
          }, delayMs);
          return; 
        } else {
          if (!state.flushAutomation) {
            state.activeAutomationAbortController = new AbortController();
            try {
              await new Promise((resolve) => {
                const timeout = setTimeout(resolve, delayMs);
                state.activeAutomationAbortController.signal.addEventListener('abort', () => {
                  clearTimeout(timeout);
                  resolve();
                });
              });
            } catch (e) {}
            state.activeAutomationAbortController = null;
          }
        }
      }
      continue;
    }

    if (token.type === 'Destination') {
      currentDestination = token.number !== null ? token.number : (token.target !== undefined ? token.target : null);
      currentDestFunc = token.function;
      continue;
    }

    let mixParam = '';
    if (currentDestination !== null && currentDestination !== '') {
      const mixIndex = await resolveMixIndex(currentDestination);
      if (mixIndex !== undefined && mixIndex !== null && mixIndex !== '') {
        mixParam = `&Mix=${mixIndex}`;
      }
    }

    if (token.type === 'Macro') {
      if (token.function === 'SOT' || token.function === 'VO') {
        let fileIndex = 0;
        if (token.number !== null && token.number > 0) {
          fileIndex = token.number - 1;
        } else {
          fileIndex = getNextVideoIndex();
        }

        let targetFileObj = item.files && item.files[fileIndex];
        if (!targetFileObj) {
          console.warn("executeTake: SOT/VO index out of bounds", fileIndex);
          continue;
        }

        let finalSlot = null;
        if (!targetFileObj.isLoaded || !targetFileObj.loadedSlot) {
          const inCurrentIndex = document.getElementById('current-index-input');
          const inPoolSize = document.getElementById('setting-poolsize');
          const baseSlotToUse = parseInt(inCurrentIndex.value) || 1;
          const slotToUse = await getSafeSlot(baseSlotToUse);
          inCurrentIndex.value = (slotToUse + 1 > (parseInt(inPoolSize ? inPoolSize.value : 15) || 15)) ? 1 : slotToUse + 1;

          const dummyItemForVmix = { ...item, ...targetFileObj, _sourceFileObj: targetFileObj, _sourceRowId: rowElement.id, _sourceFileIndex: fileIndex };
          await sendToVmix(dummyItemForVmix, slotToUse);
          finalSlot = slotToUse;

          targetFileObj.isLoaded = dummyItemForVmix.isLoaded;
          targetFileObj.loadedSlot = dummyItemForVmix.loadedSlot;
          targetFileObj.isPlaceholderLoaded = dummyItemForVmix.isPlaceholderLoaded;
          syncFileVisualState(item, fileIndex);

          const rowIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(item.rowId));
          if (rowIndex > -1) {
            updateRowItem(item, rowElement, rowIndex + 1);
            syncAutomationUI();
          }
        } else {
          finalSlot = targetFileObj.loadedSlot;
        }

        const prefix = dom.inPrefix.value || 'Video';
        const inputName = `${prefix} ${finalSlot}`;
        const funcToUse = explicitTransitionFunc || (currentDestination && currentDestFunc ? currentDestFunc : defaultTransitionFunc);
        const durParam = (funcToUse === explicitTransitionFunc) ? explicitTransitionDuration : `&Duration=${defaultDuration}`;
        if (!targetFileObj.isPlaceholderLoaded) {
          await window.api.vmixRequest(`Function=${funcToUse}&Input=${encodeURIComponent(inputName)}${mixParam}${durParam}`);

          if (token.function === 'SOT') {
            await window.api.vmixRequest(`Function=AudioOn&Input=${encodeURIComponent(inputName)}`);
          }
        }

        currentDestination = null;
      } else if (token.function === 'CGOFF') {
        const cgs = state.automationMappings.filter(m => m.type === 'Overlay');
        for (const c of cgs) {
          if (c.target) {
            await window.api.vmixRequest(`Function=OverlayInput1Out&Input=${encodeURIComponent(c.target)}`);
          }
        }
      }
    } else if (token.type === 'Input') {
      let target = token.target;
      if (token.number !== null) {
        target = token.number !== null ? `${token.target}${token.target.endsWith(' ') ? '' : ' '}${token.number}` : token.target;
      }
      if (target) {
        const funcToUse = explicitTransitionFunc || (currentDestination && currentDestFunc ? currentDestFunc : (token.function || defaultTransitionFunc));
        const durParam = (funcToUse === explicitTransitionFunc) ? explicitTransitionDuration : `&Duration=${defaultDuration}`;
        const valParam = token.parsedValue ? `&Value=${encodeURIComponent(token.parsedValue)}` : '';
        await window.api.vmixRequest(`Function=${funcToUse}&Input=${encodeURIComponent(target)}${mixParam}${durParam}${valParam}`);
      }
      currentDestination = null;
    } else if (token.type === 'Overlay') {
      let target = token.target;
      if (token.number !== null) {
        target = token.number !== null ? `${token.target}${token.target.endsWith(' ') ? '' : ' '}${token.number}` : token.target;
      }
      let func = token.function;

      if (currentDestination) {
        func = explicitTransitionFunc || currentDestFunc || defaultTransitionFunc;
        const durParam = (func === explicitTransitionFunc) ? explicitTransitionDuration : `&Duration=${defaultDuration}`;
        if (target) await window.api.vmixRequest(`Function=${func}&Input=${encodeURIComponent(target)}${mixParam}${durParam}`);
        currentDestination = null;
      } else {
        if (token.isOff) {
          if (func.endsWith('In')) func = func.substring(0, func.length - 2) + 'Out';
          else if (func.endsWith('On')) func = func.substring(0, func.length - 2) + 'Off';
          else if (func.match(/OverlayInput\d$/)) func = func + 'Out';
          else func = func + "Out";
        }
        const valParam = token.parsedValue ? `&Value=${encodeURIComponent(token.parsedValue)}` : '';
        if (target) await window.api.vmixRequest(`Function=${func}&Input=${encodeURIComponent(target)}${valParam}`);
      }
    } else if (token.type === 'Virtual Set') {
      let target = token.target;
      if (token.number !== null) {
        target = token.number !== null ? `${token.target}${token.target.endsWith(' ') ? '' : ' '}${token.number}` : token.target;
      }
      if (target) {
        const valParam = token.number !== null ? `&Value=${token.number}` : (token.parsedValue ? `&Value=${encodeURIComponent(token.parsedValue)}` : '');
        await window.api.vmixRequest(`Function=SelectIndex&Input=${encodeURIComponent(target)}${valParam}`);
      }
    } else if (token.type === 'Custom API') {
      let apiStr = "";
      
      if (token.function && token.function.toLowerCase() !== 'custom') {
        apiStr += `Function=${token.function}`;
      }
      
      if (token.target) {
        if (apiStr && !apiStr.endsWith('&')) apiStr += '&';
        if (!token.target.includes('=')) {
          apiStr += `Input=${encodeURIComponent(token.target)}`;
        } else {
          apiStr += token.target;
        }
      }
      
      if (token.value) {
        if (apiStr && !apiStr.endsWith('&')) apiStr += '&';
        apiStr += `Value=${token.value}`;
      }

      if (apiStr) {
        if (!apiStr.toLowerCase().startsWith('function=')) {
          apiStr = 'Function=' + apiStr;
        }

        if (token.parsedValue !== null) {
          apiStr = apiStr.replace(/\{value\}/gi, encodeURIComponent(token.parsedValue));
        } else if (token.number !== null) {
          apiStr = apiStr.replace(/\{value\}/gi, encodeURIComponent(token.number));
        } else {
          apiStr = apiStr.replace(/\{value\}/gi, '');
        }
        await window.api.vmixRequest(apiStr);
      }
    }
  }

  if (currentDestination !== null) {
    let targetFileObj = item.files && item.files[0];
    if (targetFileObj) {
      let finalSlot = null;
      if (!targetFileObj.isLoaded || !targetFileObj.loadedSlot) {
        const inCurrentIndex = document.getElementById('current-index-input');
        const inPoolSize = document.getElementById('setting-poolsize');
        const baseSlotToUse = parseInt(inCurrentIndex.value) || 1;
        const slotToUse = await getSafeSlot(baseSlotToUse);
        if (inCurrentIndex) inCurrentIndex.value = (slotToUse + 1 > (parseInt(inPoolSize ? inPoolSize.value : 15) || 15)) ? 1 : slotToUse + 1;

        const dummyItemForVmix = { ...item, ...targetFileObj, _sourceFileObj: targetFileObj, _sourceRowId: rowElement.id, _sourceFileIndex: 0 };
        await sendToVmix(dummyItemForVmix, slotToUse);
        finalSlot = slotToUse;
        targetFileObj.isLoaded = dummyItemForVmix.isLoaded;
        targetFileObj.loadedSlot = dummyItemForVmix.loadedSlot;
        targetFileObj.isPlaceholderLoaded = dummyItemForVmix.isPlaceholderLoaded;
        syncFileVisualState(item, 0);
      } else {
        finalSlot = targetFileObj.loadedSlot;
      }

      const prefix = dom.inPrefix.value || 'Video';
      const inputName = `${prefix} ${finalSlot}`;
      let mixParam = '';
      if (currentDestination !== null && currentDestination !== '') {
        const mixIndex = await resolveMixIndex(currentDestination);
        if (mixIndex !== undefined && mixIndex !== null && mixIndex !== '') {
          mixParam = `&Mix=${mixIndex}`;
        }
      }
      const funcToUse = explicitTransitionFunc || currentDestFunc || defaultTransitionFunc;
      const durParam = (funcToUse === explicitTransitionFunc) ? explicitTransitionDuration : `&Duration=${defaultDuration}`;
      if (!targetFileObj.isPlaceholderLoaded) {
        await window.api.vmixRequest(`Function=${funcToUse}&Input=${encodeURIComponent(inputName)}${mixParam}${durParam}`);
      }
    }
  }
}

export async function testRawAutomation(codeString) {
  if (!codeString) return;
  const parsedTokensArray = parseAutomationCode(codeString);
  if (parsedTokensArray.length === 0) return;
  
  let defaultSlot = parseInt(dom.inFirstLoc.value) || 9;
  
  try {
    const mediaModule = await import('./media.js');
    if (mediaModule.usedSlots && mediaModule.usedSlots.length > 0) {
      defaultSlot = mediaModule.usedSlots[0];
    }
  } catch (e) {
    console.warn("Could not load used media slots for Sandbox Tester", e);
  }

  const mockItem = {
    rowId: 'sandbox_test',
    title: 'Sandbox Tester',
    automationCode: codeString,
    files: Array(10).fill({ loadedSlot: defaultSlot, isPlaceholderLoaded: false })
  };

  for (const tokens of parsedTokensArray) {
    let mockVideoIndex = 0;
    await executeAutomationTokens(mockItem, tokens, () => {
      let current = mockVideoIndex;
      mockVideoIndex++;
      return current;
    }, null);
  }
}
