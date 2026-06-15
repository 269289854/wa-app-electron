const mode = document.querySelector('#mode');
const state = document.querySelector('#state');
const retry = document.querySelector('#retry');

chrome.storage.local.get({ mode: 'api' }, (data) => {
  mode.value = data.mode;
});

mode.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'set-mode', mode: mode.value }, refresh);
});

retry.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'retry-now' }, refresh);
});

function refresh() {
  chrome.runtime.sendMessage({ type: 'get-state' }, (data) => {
    state.textContent = JSON.stringify(data || {}, null, 2);
  });
}

refresh();
setInterval(refresh, 1500);
