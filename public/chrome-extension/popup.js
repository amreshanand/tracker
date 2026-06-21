const API_BASE_URL = 'https://price-tracker-india.vercel.app';

const productInfo = document.getElementById('product-info');
const pincodeInput = document.getElementById('pincode');
const checkBtn = document.getElementById('checkBtn');
const resultsDiv = document.getElementById('results');
const notifyName = document.getElementById('notifyName');
const notifyEmail = document.getElementById('notifyEmail');
const notifyPincode = document.getElementById('notifyPincode');
const notifyTargetPrice = document.getElementById('notifyTargetPrice');
const notifyBtn = document.getElementById('notifyBtn');
const notifyMessage = document.getElementById('notifyMessage');

let currentProduct = null;

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.ok) return response;
      if (response.status < 500) return response;
    } catch (err) {
      if (i >= retries) throw err;
    }
    if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Unexpected response (${response.status}). Please try again.` };
  }
}

async function trackEvent(event, metadata) {
  try {
    await fetchWithTimeout(`${API_BASE_URL}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...metadata }),
    }, 3000);
  } catch {
    // Non-critical
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

async function getCurrentProduct() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    let platform = null;
    if (tab.url.includes('flipkart.com')) platform = 'flipkart';
    else if (tab.url.includes('amazon.in')) platform = 'amazon_india';
    if (!platform) return null;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
      if (response && response.name) {
        return { name: response.name, url: tab.url, platform, price: response.price };
      }
    } catch {
      // Content script not loaded — fall through
    }

    return {
      name: tab.title.split(' - Buy')[0].split('|')[0].trim(),
      url: tab.url,
      platform,
      price: null
    };
  } catch (error) {
    console.error('Error getting product:', error);
    return null;
  }
}

function displayProduct(product) {
  if (!product || !product.name) {
    productInfo.innerHTML = '<p>Open a product page on Flipkart or Amazon India</p>';
    productInfo.classList.add('empty');
    return;
  }
  productInfo.classList.remove('empty');
  productInfo.innerHTML = `
    <div class="product-name">${escapeHtml(product.name)}</div>
    <span class="product-platform">${product.platform === 'flipkart' ? 'Flipkart' : 'Amazon India'}</span>
    ${product.price ? `<span style="margin-left: 8px; font-weight: 600;">${escapeHtml(product.price)}</span>` : ''}
  `;
  trackEvent('product_detected', { productId: product.url });
}

async function checkAvailability() {
  const pincode = pincodeInput.value.trim();

  if (!pincode || pincode.length !== 6) {
    resultsDiv.innerHTML = '<div class="message error">Please enter a valid 6-digit pincode</div>';
    return;
  }

  if (!currentProduct) {
    resultsDiv.innerHTML = '<div class="message error">No product detected. Open a product page first.</div>';
    return;
  }

  checkBtn.disabled = true;
  resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div>Checking availability...</div>';

  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/availability/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: currentProduct.url,
        productName: currentProduct.name,
        pincode: pincode
      })
    });

    const data = await safeJson(response);
    displayAPIResult(data, pincode);
    trackEvent('availability_checked', { pincode, platform: currentProduct.platform });

    // Save pincode for next time
    chrome.storage.local.set({ savedPincode: pincode });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      resultsDiv.innerHTML = '<div class="message error">Request timed out. Please try again.</div>';
    } else {
      resultsDiv.innerHTML = `<div class="message error">Error: ${escapeHtml(error && error.message || 'Unknown error')}</div>`;
    }
  } finally {
    checkBtn.disabled = false;
  }
}

function displayAPIResult(data, pincode) {
  if (!data) {
    resultsDiv.innerHTML = '<div class="message error">No response from server. Please try again.</div>';
    return;
  }

  if (data.error) {
    resultsDiv.innerHTML = `<div class="message error">${escapeHtml(data.error)}</div>`;
    return;
  }

  if (data.result) {
    const r = data.result;
    const statusClass = r.available ? 'available' : 'unavailable';
    const statusBadge = r.available ? 'yes' : 'no';
    const statusText = r.available ? 'In Stock ✓' : (r.confidence === 'unknown' ? 'Could not verify' : 'Not Available');

    let html = `
      <div class="result-item ${statusClass}">
        <div>
          <div class="result-city">${escapeHtml(r.city || r.district || 'Your location')}</div>
          <div class="result-pincode">Pincode: ${escapeHtml(r.pincode)}</div>
        </div>
        <span class="result-status ${statusBadge}">${statusText}</span>
      </div>
    `;

    // One-click CTA: set price alert after availability check
    if (r.available) {
      html += `<button class="btn btn-secondary" id="quickAlertBtn" style="margin-top:12px;">🔔 Set Price Alert</button>`;
    } else {
      html += `<div style="margin-top:12px;font-size:13px;color:#64748b;">
        ${r.deliveryInfo ? escapeHtml(r.deliveryInfo) : 'Not currently available at this pincode.'}
        <br><br>
        <button class="btn btn-secondary" id="quickAlertBtn">🔔 Notify me when back in stock</button>
      </div>`;
    }

    if (data.nearestAvailable && data.nearestAvailable.length > 0 && !r.available) {
      html += '<p class="section-title" style="margin-top: 16px;">Nearest Available:</p>';
      data.nearestAvailable.forEach(loc => {
        html += `
          <div class="result-item available">
            <div>
              <div class="result-city">${escapeHtml(loc.city)}, ${escapeHtml(loc.state)}</div>
              <div class="result-pincode">${escapeHtml(loc.pincode)}</div>
            </div>
            <span class="result-status yes">Available</span>
          </div>
        `;
      });
    }

    resultsDiv.innerHTML = html;

    // Wire up the quick alert button
    const quickBtn = document.getElementById('quickAlertBtn');
    if (quickBtn) {
      quickBtn.addEventListener('click', () => {
        // Pre-fill notify form with detected values
        notifyPincode.value = pincode;
        // Auto-suggest target price 10% below current
        if (currentProduct && currentProduct.price) {
          const priceNum = parseFloat(currentProduct.price.replace(/[^0-9.]/g, ''));
          if (!isNaN(priceNum)) {
            notifyTargetPrice.value = Math.round(priceNum * 0.9);
          }
        }
        // Switch to notify tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="notify"]').classList.add('active');
        document.getElementById('tab-notify').classList.add('active');
      });
    }
    return;
  }

  resultsDiv.innerHTML = '<div class="message error">Unexpected response format. Please try again.</div>';
}

async function submitNotification() {
  const name = notifyName.value.trim();
  const email = notifyEmail.value.trim();
  const pincode = notifyPincode.value.trim();

  if (!name || !email || !pincode || pincode.length !== 6) {
    notifyMessage.innerHTML = '<div class="message error">Please fill all fields correctly</div>';
    return;
  }

  if (!currentProduct) {
    notifyMessage.innerHTML = '<div class="message error">No product detected</div>';
    return;
  }

  notifyBtn.disabled = true;
  notifyMessage.innerHTML = '<div class="loading"><div class="spinner"></div>Submitting...</div>';

  try {
    const targetPrice = notifyTargetPrice.value.trim() ? parseFloat(notifyTargetPrice.value.trim()) : null;

    const response = await fetchWithRetry(`${API_BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: name,
        email: email,
        pincode: pincode,
        productUrl: currentProduct.url,
        productName: currentProduct.name,
        targetPrice: targetPrice
      })
    });

    const data = await safeJson(response);

    if (data.error) {
      if (data.error.includes('Free plan')) {
        notifyMessage.innerHTML = `<div class="message error">⚠️ ${escapeHtml(data.error)}</div>`;
      } else {
        notifyMessage.innerHTML = `<div class="message error">${escapeHtml(data.error)}</div>`;
      }
    } else {
      notifyMessage.innerHTML = `<div class="message success">✓ ${escapeHtml(data.message || 'Alert created!')}</div>`;
      if (data.usage) {
        const usageDiv = document.createElement('div');
        usageDiv.style.cssText = 'font-size:12px;color:#64748b;margin-top:8px;text-align:center;';
        usageDiv.textContent = `${data.usage.activeAlerts}/${data.usage.plan === 'free' ? 5 : '∞'} alerts used`;
        notifyMessage.appendChild(usageDiv);
      }
      chrome.storage.local.get(['alerts'], (result) => {
        const alerts = result.alerts || [];
        alerts.push({
          id: data.alert && data.alert.id,
          productName: currentProduct && currentProduct.name,
          pincode: pincode,
          email: email,
          createdAt: new Date().toISOString()
        });
        chrome.storage.local.set({ alerts });
      });
      trackEvent('alert_created', { pincode, platform: currentProduct.platform });
    }
  } catch (error) {
    notifyMessage.innerHTML = `<div class="message error">Error: ${escapeHtml(error && error.message || 'Could not reach server')}</div>`;
  } finally {
    notifyBtn.disabled = false;
  }
}

checkBtn.addEventListener('click', checkAvailability);
notifyBtn.addEventListener('click', submitNotification);

pincodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') checkAvailability();
});

[pincodeInput, notifyPincode].forEach(input => {
  input.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });
});

document.addEventListener('DOMContentLoaded', async () => {
  currentProduct = await getCurrentProduct();
  displayProduct(currentProduct);

  chrome.storage.local.get(['savedEmail', 'savedName', 'savedPincode'], (result) => {
    if (result.savedEmail) notifyEmail.value = result.savedEmail;
    if (result.savedName) notifyName.value = result.savedName;
    // Auto-fill pincode from last check
    if (result.savedPincode) pincodeInput.value = result.savedPincode;
  });

  // Track popup open
  trackEvent('popup_open', { hasProduct: !!currentProduct });

  // Track install (only once)
  chrome.storage.local.get(['installTracked'], (result) => {
    if (!result.installTracked) {
      trackEvent('install');
      chrome.storage.local.set({ installTracked: true });
    }
  });
});

notifyEmail.addEventListener('blur', () => {
  chrome.storage.local.set({ savedEmail: notifyEmail.value });
});
notifyName.addEventListener('blur', () => {
  chrome.storage.local.set({ savedName: notifyName.value });
});
