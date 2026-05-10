chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ status: 'active' });
  console.log('[AutoMSTool] Extension installed.');
});
