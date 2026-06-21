const API_BASE_URL = 'https://your-app-url.com';
const MAX_RETRIES = 2;

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return response;
      if (response.status < 500) return response; // don't retry 4xx
    } catch {
      if (i >= retries) throw new Error('Request failed after retries');
    } finally {
      clearTimeout(timer);
    }
    if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: 'Invalid response from server' };
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

    const data = await safeJson(response);

    if (data.results && data.results.notified > 0) {
      const notified = data.results.notifications.filter(n => n.status === 'notified');
      notified.forEach(notification => {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Product Now Available!',
          message: `${notification.productName || 'A product'} is now deliverable to ${notification.pincode}`,
          priority: 2
        });
      });
    }

    console.log('Alert processing complete:', data.message || 'done');
  } catch (error) {
    console.error('Error processing alerts:', error);
  }
}

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${API_BASE_URL}/dashboard` });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processAlerts') {
    processAlerts().then(() => sendResponse({ success: true }));
    return true;
  }
});

console.log('Product Availability Tracker background service started');
