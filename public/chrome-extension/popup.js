const API_BASE_URL = 'https://your-app-url.com';

const productInfo = document.getElementById('product-info');
const pincodeInput = document.getElementById('pincode');
const checkBtn = document.getElementById('checkBtn');
const resultsDiv = document.getElementById('results');
const notifyName = document.getElementById('notifyName');
const notifyEmail = document.getElementById('notifyEmail');
const notifyPincode = document.getElementById('notifyPincode');
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'checkDelivery',
        pincode: pincode
      });
    } catch {
      result = null;
    }

    if (result && result.checked) {
      displayResult(result, pincode);
    } else {
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
      displayAPIResult(data);
    }
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

function displayResult(result, pincode) {
  const statusClass = result.available ? 'available' : 'unavailable';
  const statusText = result.available ? 'Available' : 'Not Available';
  const statusBadge = result.available ? 'yes' : 'no';

  resultsDiv.innerHTML = `
    <div class="result-item ${statusClass}">
      <div>
        <div class="result-city">Pincode ${escapeHtml(pincode)}</div>
        <div class="result-pincode">${escapeHtml(result.deliveryInfo || (result.available ? 'Delivery available' : 'Not serviceable'))}</div>
      </div>
      <span class="result-status ${statusBadge}">${statusText}</span>
    </div>
    ${!result.available ? '<p style="font-size: 12px; color: #64748b; margin-top: 12px;">Switch to "Notify Me" tab to get alerts when available.</p>' : ''}
  `;
}

function displayAPIResult(data) {
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

    let html = `
      <div class="result-item ${statusClass}">
        <div>
          <div class="result-city">${escapeHtml(r.city || r.district)}, ${escapeHtml(r.state)}</div>
          <div class="result-pincode">Pincode: ${escapeHtml(r.pincode)}</div>
        </div>
        <span class="result-status ${statusBadge}">${r.available ? 'Available' : 'Not Available'}</span>
      </div>
    `;

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
    return;
  }

  // Unknown response shape
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
    const response = await fetchWithRetry(`${API_BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: name,
        email: email,
        pincode: pincode,
        productUrl: currentProduct.url,
        productName: currentProduct.name
      })
    });

    const data = await safeJson(response);

    if (data.error) {
      notifyMessage.innerHTML = `<div class="message error">${escapeHtml(data.error)}</div>`;
    } else {
      notifyMessage.innerHTML = `<div class="message success">✓ ${escapeHtml(data.message || 'Alert created!')}</div>`;
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

  chrome.storage.local.get(['savedEmail', 'savedName'], (result) => {
    if (result.savedEmail) notifyEmail.value = result.savedEmail;
    if (result.savedName) notifyName.value = result.savedName;
  });
});

notifyEmail.addEventListener('blur', () => {
  chrome.storage.local.set({ savedEmail: notifyEmail.value });
});
notifyName.addEventListener('blur', () => {
  chrome.storage.local.set({ savedName: notifyName.value });
});
