// Background service worker for the extension

// Configuration
const API_BASE_URL = 'https://your-app-url.com'; // Change this!
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

// Setup alarm for periodic checks
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkAlerts', { periodInMinutes: 240 }); // Every 4 hours
  console.log('Product Availability Tracker installed');
});

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAlerts') {
    processAlerts();
  }
});

// Process pending alerts by calling the backend
async function processAlerts() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications/process`, {
      method: 'POST'
    });
    
    const data = await response.json();
    
    if (data.results && data.results.notified > 0) {
      // Show notification for each notified alert
      data.results.notifications
        .filter(n => n.status === 'notified')
        .forEach(notification => {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '🎉 Product Now Available!',
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

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  // Open the dashboard
  chrome.tabs.create({ url: `${API_BASE_URL}/dashboard` });
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processAlerts') {
    processAlerts().then(() => sendResponse({ success: true }));
    return true;
  }
});

console.log('Product Availability Tracker background service started');
