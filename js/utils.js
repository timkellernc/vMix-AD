import { dom } from './state.js';

export function getExt(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function formatDuration(sec) {
  if (isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function parseDuration(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  val = String(val).trim();
  if (val.includes(':')) {
    const parts = val.split(':');
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return (m * 60) + s;
  }
  return parseInt(val, 10) || 0;
}

export function formatTimeOfDay(unixSeconds) {
  if (!unixSeconds || isNaN(unixSeconds)) return "--:--:--";
  const d = new Date(unixSeconds * 1000);
  let h = d.getHours();
  let m = d.getMinutes();
  let s = d.getSeconds();
  
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;

  m = m < 10 ? '0' + m : m;
  s = s < 10 ? '0' + s : s;
  return `${h}:${m}:${s} ${ampm}`;
}

export function formatLiveTime(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : '';
  const absSec = Math.abs(totalSeconds);
  const h = Math.floor(absSec / 3600);
  const m = Math.floor((absSec % 3600) / 60);
  const s = absSec % 60;
  
  const hStr = h > 0 ? `${h}:` : '';
  const mStr = h > 0 && m < 10 ? `0${m}` : `${m}`;
  const sStr = s < 10 ? `0${s}` : `${s}`;
  
  return `${sign}${hStr}${mStr}:${sStr}`;
}

export function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function showConfirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    
    const box = document.createElement('div');
    box.className = 'confirm-box';
    
    const text = document.createElement('p');
    text.innerText = msg;
    box.appendChild(text);
    
    const btns = document.createElement('div');
    btns.className = 'confirm-btns';
    
    const btnYes = document.createElement('button');
    btnYes.className = 'btn danger';
    btnYes.innerText = 'Yes';
    btnYes.onclick = () => { overlay.remove(); resolve(true); };
    
    const btnNo = document.createElement('button');
    btnNo.className = 'btn secondary';
    btnNo.innerText = 'No';
    btnNo.onclick = () => { overlay.remove(); resolve(false); };
    
    btns.appendChild(btnNo);
    btns.appendChild(btnYes);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}
