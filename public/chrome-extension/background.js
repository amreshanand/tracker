const API_BASE_URL = 'https://your-app-url.com';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok && i < retries) continue;
        return response;
      } catch (err) {
        if (i >= retries) throw err;
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkAlerts', { periodInMinutes: 240 });
  console.log('Product Availability Tracker installed');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAlerts') {
    processAlerts();
  }
});

async function processAlerts() {
  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/notifications/process`, {
      method: 'GET'
    });

    const data = await response.json();

    if (data.results && data.results.notified > 0) {
      const notified = data.results.notifications.filter(n => n.status === 'notified');
      notified.forEach(notification => {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Product Now Available!',
          message: `${notification.productName} is now deliverable to ${notification.pincode}`,
          priority: 2
        });
      });
    }

    console.log('Alert processing complete:', data.message);
  } catch (error) {
    console.error('Error processing alerts:', error);
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: `${API_BASE_URL}/dashboard` });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processAlerts') {
    processAlerts().then(() => sendResponse({ success: true }));
    return true;
  }
});

console.log('Product Availability Tracker background service started');
