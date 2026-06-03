import { state, dom } from './state.js';
import { formatTimeOfDay, formatLiveTime, showToast } from './utils.js';
import { syncAutomationUI } from './automation.js';

export function initClock() {
  setInterval(() => {
    const now = new Date();
    const topClockDisplay = document.getElementById('top-clock-display');
    if (topClockDisplay) {
      topClockDisplay.innerText = formatTimeOfDay(Math.floor(now.getTime() / 1000));
    }
    updateLiveTimers();
  }, 1000);
}
export function getBlockFirstItemIndex(currentIndex) {
  let firstIdx = 0;
  for (let i = currentIndex; i >= 0; i--) {
    if (state.globalParsedItems[i].isBreak) {
      if (i === currentIndex) return i;
      firstIdx = i + 1;
      break;
    }
  }
  return firstIdx;
}

export function optimisticUpdateTimerUI(rowId, resetCmdIndex = true) {
  state.timerIgnoreApiUpdatesUntil = Date.now() + 2000;

  const allRows = document.querySelectorAll('.row-item');
  allRows.forEach(row => row.classList.remove('on-air'));

  if (!rowId || String(rowId) === "0") {
    state.activeOnAirRowId = null;
    state.activeOnAirStartDate = null;
    if (resetCmdIndex) state.activeOnAirCmdIndex = -1;
    updateLiveTimers();
    syncAutomationUI();
    return;
  }

  state.activeOnAirRowId = rowId;
  state.activeOnAirStartDate = Math.floor((Date.now() + state.serverTimeOffsetMs) / 1000);
  if (resetCmdIndex) state.activeOnAirCmdIndex = -1;

  const targetIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(rowId));
  if (targetIndex > -1) {
    const targetRow = document.getElementById(`row-item-${targetIndex + 1}`);
    if (targetRow) {
      targetRow.classList.add('on-air');
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  updateLiveTimers();
  syncAutomationUI();
}


export function updateLiveTimers() {
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
  const nowUnix = Math.floor((Date.now() + state.serverTimeOffsetMs) / 1000);
  const timeOfDayStr = formatTimeOfDay(nowUnix);

  if (topClockDisplay) {
    topClockDisplay.innerText = timeOfDayStr;
  }

  topTimerDisplay.style.visibility = 'visible';
  topTimerDisplay.style.opacity = '1';

  if (!state.activeOnAirRowId || !state.activeOnAirStartDate) {
    if (timerLiveContent) timerLiveContent.style.display = 'none';
    if (timerIdleContent) timerIdleContent.style.display = 'flex';

    if (state.activeRundownStartTime && state.activeRundownStartTime > nowUnix) {
      const timeUntil = state.activeRundownStartTime - nowUnix;
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
        timerIdleText.innerHTML = `Show Starts in <span style="color: var(--accent); margin-right: 4px;">${countdownStr}</span> at ${formatTimeOfDay(state.activeRundownStartTime)}`;
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

  const targetIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
  if (targetIndex === -1) return;

  const currentItem = state.globalParsedItems[targetIndex];

  // Auto scroll logic could go here if needed, but omitted for brevity
  const elapsed = Math.max(0, nowUnix - state.activeOnAirStartDate);

  const firstItemIndex = getBlockFirstItemIndex(targetIndex);
  const firstItem = state.globalParsedItems[firstItemIndex];
  if (firstItem) {
    const firstItemRowId = firstItem.rowId;
    if (!state.blockEarliestRowData[firstItemRowId]) {
      state.blockEarliestRowData[firstItemRowId] = { rowIndex: targetIndex, startTime: state.activeOnAirStartDate };
    } else {
      if (targetIndex <= state.blockEarliestRowData[firstItemRowId].rowIndex) {
        state.blockEarliestRowData[firstItemRowId] = { rowIndex: targetIndex, startTime: state.activeOnAirStartDate };
      }
    }

    const earliestData = state.blockEarliestRowData[firstItemRowId];
    let sumBeforeEarliest = 0;
    for (let i = firstItemIndex; i < earliestData.rowIndex; i++) {
      sumBeforeEarliest += (state.globalParsedItems[i].estDuration || 0);
    }

    const earliestElapsed = Math.max(0, nowUnix - earliestData.startTime);
    if (timerBlockElapsed) timerBlockElapsed.innerText = formatLiveTime(sumBeforeEarliest + earliestElapsed);
  }

  if (timerElapsed) timerElapsed.innerText = formatLiveTime(elapsed);

  const estDur = currentItem.estDuration || 0;
  const remaining = estDur - Math.max(0, elapsed); 
  if (timerRemaining) timerRemaining.innerText = formatLiveTime(remaining);

  const clampedRemaining = Math.max(0, remaining);
  let subsequentSum = 0;
  for (let i = targetIndex + 1; i < state.globalParsedItems.length; i++) {
    const nextItem = state.globalParsedItems[i];
    if (nextItem.isBreak) break; 
    subsequentSum += (nextItem.estDuration || 0);
  }

  if (timerBlockRemaining) timerBlockRemaining.innerText = formatLiveTime(clampedRemaining + subsequentSum);

  const timerOnOver = document.getElementById('timer-on-over');
  if (timerOnOver && state.activeRundownEndTime) {
    let subsequentSumToEnd = 0;
    for (let i = targetIndex + 1; i < state.globalParsedItems.length; i++) {
      subsequentSumToEnd += (state.globalParsedItems[i].estDuration || 0);
    }
    const projectedEndTime = nowUnix + clampedRemaining + subsequentSumToEnd;
    const overUnderSecs = projectedEndTime - state.activeRundownEndTime;

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

export async function pollOnAirTimer() {
  if (state.timerPollTimeout) clearTimeout(state.timerPollTimeout);
  let nextDelay = 10000; 

  try {
    if (state.activeRundownId) {
      const res = await window.api.rundownRequest('getRundowns');
      if (res.success && res.data && Array.isArray(res.data)) {
        if (res.serverDate && !window.hasSyncedServerTime) {
          const sTime = new Date(res.serverDate).getTime();
          if (!isNaN(sTime)) {
            state.serverTimeOffsetMs = sTime - Date.now();
            window.hasSyncedServerTime = true;
          }
        }
        const activeRundown = res.data.find(r => String(r.RundownID) === String(state.activeRundownId));
        if (activeRundown) {
          if (Date.now() > state.timerIgnoreApiUpdatesUntil) {
            state.activeRundownStartTime = parseInt(activeRundown.Start, 10);
            state.activeRundownEndTime = parseInt(activeRundown.End, 10);

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
              if (activeRundown.OnAirTimer_RowID) {
                const serverStartDate = parseInt(activeRundown.OnAirTimer_Date, 10);
                if (state.activeOnAirRowId === activeRundown.OnAirTimer_RowID &&
                  state.activeOnAirStartDate !== null &&
                  Math.abs(state.activeOnAirStartDate - serverStartDate) <= 2) {
                } else {
                  if (state.activeOnAirRowId !== activeRundown.OnAirTimer_RowID) {
                    state.activeOnAirCmdIndex = -1; 
                  }
                  state.activeOnAirRowId = activeRundown.OnAirTimer_RowID;
                  state.activeOnAirStartDate = serverStartDate;
                  syncAutomationUI();
                }
              } else {
                if (state.activeOnAirRowId !== null) {
                  state.activeOnAirCmdIndex = -1;
                }
                state.activeOnAirRowId = null;
                state.activeOnAirStartDate = null;
                syncAutomationUI();
              }
            } else {
              state.activeOnAirRowId = null;
              state.activeOnAirStartDate = null;
            }
          } else {
            nextDelay = 2000;
          }

          const onAirRowId = activeRundown.OnAirTimer_RowID;
          const allRows = document.querySelectorAll('.row-item');
          allRows.forEach(row => row.classList.remove('on-air'));

          if (onAirRowId) {
            const targetIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(onAirRowId));
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
  }

  state.timerPollTimeout = setTimeout(pollOnAirTimer, nextDelay);
}

export async function startTimerOnRowId(rowId) {
  if (!state.activeRundownId) return;
  try {
    optimisticUpdateTimerUI(rowId, true);
    const res = await window.api.rundownRequest('startTimingRow', {
      RundownID: state.activeRundownId,
      RowID: rowId
    });
    if (res.success) {
      if (state.timerPollTimeout) clearTimeout(state.timerPollTimeout);
      pollOnAirTimer();
    } else {
      showToast("Error starting timer: " + (res.error || "Unknown error"));
    }
  } catch (err) {
    showToast("Network Error starting timer: " + err.message);
  }
}

export async function startTimerOnNextRow() {
  if (!state.activeRundownId || state.globalParsedItems.length === 0) return;

  let nextItem = null;

  if (state.activeOnAirRowId) {
    const currentIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
    if (currentIndex > -1 && currentIndex + 1 < state.globalParsedItems.length) {
      nextItem = state.globalParsedItems[currentIndex + 1];
    }
  } else {
    const inCurrentIndex = document.getElementById('current-index-input');
    const slotIdx = parseInt(inCurrentIndex ? inCurrentIndex.value : 1, 10) - 1;
    if (slotIdx >= 0 && slotIdx < state.globalParsedItems.length) {
      nextItem = state.globalParsedItems[slotIdx];
    } else {
      nextItem = state.globalParsedItems[0];
    }
  }

  if (nextItem && nextItem.rowId) {
    try {
      optimisticUpdateTimerUI(nextItem.rowId);
      const res = await window.api.rundownRequest('startTimingRow', {
        RundownID: state.activeRundownId,
        RowID: nextItem.rowId
      });
      if (res.success) {
        if (state.timerPollTimeout) clearTimeout(state.timerPollTimeout);
        pollOnAirTimer();
      } else {
        showToast("Error starting timer: " + (res.error || "Unknown error"));
      }
    } catch (err) {
      showToast("Network Error starting timer: " + err.message);
    }
  }
}

export async function startTimerOnPrevRow() {
  if (!state.activeRundownId || state.globalParsedItems.length === 0) return;

  let prevItem = null;

  if (state.activeOnAirRowId) {
    const currentIndex = state.globalParsedItems.findIndex(i => String(i.rowId) === String(state.activeOnAirRowId));
    if (currentIndex > 0) {
      prevItem = state.globalParsedItems[currentIndex - 1];
    } else if (currentIndex === 0) {
      prevItem = state.globalParsedItems[0];
    }
  } else {
    const inCurrentIndex = document.getElementById('current-index-input');
    const slotIdx = parseInt(inCurrentIndex ? inCurrentIndex.value : 1, 10) - 1;
    if (slotIdx > 0 && slotIdx < state.globalParsedItems.length) {
      prevItem = state.globalParsedItems[slotIdx - 1];
    } else {
      prevItem = state.globalParsedItems[0];
    }
  }

  if (prevItem && prevItem.rowId) {
    try {
      optimisticUpdateTimerUI(prevItem.rowId);
      const res = await window.api.rundownRequest('startTimingRow', {
        RundownID: state.activeRundownId,
        RowID: prevItem.rowId
      });
      if (res.success) {
        if (state.timerPollTimeout) clearTimeout(state.timerPollTimeout);
        pollOnAirTimer();
      } else {
        showToast("Error starting timer: " + (res.error || "Unknown error"));
      }
    } catch (err) {
      showToast("Network Error starting timer: " + err.message);
    }
  }
}
