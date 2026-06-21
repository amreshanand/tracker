const API_BASE_URL = 'https://price-tracker-india.vercel.app';
const CONCURRENCY = 5;
const CACHE_TTL_MS = 30 * 60 * 1000;

const PINCODES = [
  { pincode: '110001', city: 'Delhi' },
  { pincode: '400001', city: 'Mumbai' },
  { pincode: '560001', city: 'Bangalore' },
  { pincode: '600001', city: 'Chennai' },
  { pincode: '700001', city: 'Kolkata' },
  { pincode: '201301', city: 'Noida' },
  { pincode: '380001', city: 'Ahmedabad' },
  { pincode: '500001', city: 'Hyderabad' },
  { pincode: '302001', city: 'Jaipur' },
  { pincode: '226001', city: 'Lucknow' },
];

let currentProduct = null;
let results = new Map();

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: `Unexpected response (${response.status})` };
  }
}

async function checkPincode(product, pincode, city) {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/availability/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: product.url,
        productName: product.name,
        pincode: pincode,
      }),
    });
    const data = await safeJson(response);
    if (data && data.result) {
      return {
        pincode,
        city,
        available: data.result.available,
        confidence: data.result.confidence || 'verified',
        deliveryInfo: data.result.deliveryInfo || null,
      };
    }
    return { pincode, city, available: null, confidence: 'unverified' };
  } catch {
    return { pincode, city, available: null, confidence: 'unverified' };
  }
}

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
    }
    return { name: tab.title.split(' - Buy')[0].split('|')[0].trim(), url: tab.url, platform, price: null };
  } catch {
    return null;
  }
}

function displayProduct(product) {
  const el = document.getElementById('product-info');
  if (!product || !product.name) {
    el.innerHTML = '<p>Open a product page on Flipkart or Amazon India</p>';
    el.className = 'product-card empty';
    return;
  }
  el.className = 'product-card';
  el.innerHTML = `
    <div class="product-name">${escapeHtml(product.name)}</div>
    <div class="product-meta">
      <span class="product-platform">${product.platform === 'flipkart' ? 'Flipkart' : 'Amazon India'}</span>
      ${product.price ? `<span class="product-price">${escapeHtml(product.price)}</span>` : ''}
    </div>
  `;
}

function getFromCache(productUrl) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['availCache'], (result) => {
      const cache = result.availCache || {};
      const entry = cache[productUrl];
      if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
        resolve(entry.data);
      } else {
        resolve(null);
      }
    });
  });
}

function saveToCache(productUrl, data) {
  chrome.storage.local.get(['availCache'], (result) => {
    const cache = result.availCache || {};
    cache[productUrl] = { ts: Date.now(), data };
    // Prune old entries
    for (const key of Object.keys(cache)) {
      if (Date.now() - cache[key].ts > CACHE_TTL_MS * 2) delete cache[key];
    }
    chrome.storage.local.set({ availCache: cache });
  });
}

function renderResults() {
  const container = document.getElementById('region-list');
  let html = '';
  let done = 0;
  for (const r of results.values()) {
    const statusClass = !r.available && r.available !== false ? 'pending' : r.available ? 'available' : 'unavailable';
    const badgeClass = !r.available && r.available !== false ? 'checking' : r.available ? 'yes' : 'no';
    const badgeText = !r.available && r.available !== false ? 'Checking...' : r.available ? '✓ In Stock' : 'Not Available';
    if (r.available !== null) done++;
    html += `
      <div class="region-row ${statusClass}">
        <div class="region-icon">${r.available === true ? '✅' : r.available === false ? '❌' : '⏳'}</div>
        <div class="region-info">
          <div class="region-city">${escapeHtml(r.city)}</div>
          <div class="region-code">${r.pincode}</div>
        </div>
        <span class="region-status ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }
  container.innerHTML = html;

  // Update status
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const statusCount = document.getElementById('status-count');
  statusBar.className = 'status-bar';
  if (done === 0) {
    statusBar.classList.add('loading');
    statusText.textContent = '🔍 Checking availability across India...';
    statusCount.textContent = '';
    document.getElementById('status-spinner').style.display = '';
  } else if (done < PINCODES.length) {
    statusBar.classList.add('loading');
    statusText.textContent = `Checked ${done}/${PINCODES.length} regions`;
    statusCount.textContent = '';
    document.getElementById('status-spinner').style.display = '';
  } else {
    const available = [...results.values()].filter(r => r.available === true).length;
    statusBar.classList.add('done');
    statusText.textContent = `✅ Available in ${available}/${PINCODES.length} regions`;
    statusCount.textContent = '';
    document.getElementById('status-spinner').style.display = 'none';
  }

  // Show alert section when done
  const alertSection = document.getElementById('alert-section');
  if (done === PINCODES.length) {
    alertSection.classList.remove('hidden');
    document.getElementById('footer-note').textContent = 'Data may vary by exact address. Verify with the retailer before purchasing.';
  } else {
    alertSection.classList.add('hidden');
  }
}

async function checkAllPincodes(product) {
  const el = document.getElementById('status-bar');
  el.classList.remove('hidden');
  el.classList.add('loading');
  document.getElementById('status-spinner').style.display = '';

  // Initialize all as pending
  for (const p of PINCODES) {
    results.set(p.pincode, { pincode: p.pincode, city: p.city, available: null, confidence: 'pending' });
  }
  renderResults();

  let completed = 0;
  for (let i = 0; i < PINCODES.length; i += CONCURRENCY) {
    const batch = PINCODES.slice(i, i + CONCURRENCY);
    const promises = batch.map(p => checkPincode(product, p.pincode, p.city));
    const batchResults = await Promise.allSettled(promises);
    for (const settled of batchResults) {
      if (settled.status === 'fulfilled' && settled.value) {
        const r = settled.value;
        results.set(r.pincode, r);
      }
      completed++;
    }
    renderResults();
  }

  // Cache
  const cacheData = {};
  for (const [pincode, r] of results) {
    cacheData[pincode] = r;
  }
  saveToCache(product.url, cacheData);
}

async function submitNotification() {
  const name = document.getElementById('alert-name').value.trim();
  const email = document.getElementById('alert-email').value.trim();

  if (!name || !email) {
    document.getElementById('alert-message').innerHTML = '<div class="msg error">Please fill in your name and email</div>';
    return;
  }

  if (!currentProduct) {
    document.getElementById('alert-message').innerHTML = '<div class="msg error">No product detected</div>';
    return;
  }

  const btn = document.getElementById('alert-btn');
  btn.disabled = true;
  document.getElementById('alert-message').innerHTML = '<div class="msg" style="background:#dbeafe;color:#1d4ed8;">Submitting...</div>';

  try {
    const targetPrice = document.getElementById('alert-target-price').value.trim();
    const body = {
      userName: name,
      email: email,
      pincode: PINCODES[0].pincode,
      productUrl: currentProduct.url,
      productName: currentProduct.name,
      ...(targetPrice ? { targetPrice: parseFloat(targetPrice) } : {}),
    };

    const response = await fetchWithTimeout(`${API_BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await safeJson(response);

    if (data.error) {
      document.getElementById('alert-message').innerHTML = `<div class="msg error">${escapeHtml(data.error)}</div>`;
    } else {
      document.getElementById('alert-message').innerHTML = `<div class="msg success">✓ ${escapeHtml(data.message || 'Alert created! Check your email to verify.')}</div>`;
      document.getElementById('alert-name').value = '';
      document.getElementById('alert-email').value = '';
      document.getElementById('alert-target-price').value = '';
    }
  } catch (error) {
    document.getElementById('alert-message').innerHTML = `<div class="msg error">Error: ${escapeHtml(error && error.message || 'Could not reach server')}</div>`;
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  currentProduct = await getCurrentProduct();
  displayProduct(currentProduct);

  document.getElementById('alert-btn').addEventListener('click', submitNotification);

  // Auto-restore saved name/email
  chrome.storage.local.get(['savedName', 'savedEmail'], (result) => {
    if (result.savedName) document.getElementById('alert-name').value = result.savedName;
    if (result.savedEmail) document.getElementById('alert-email').value = result.savedEmail;
  });

  document.getElementById('alert-name').addEventListener('blur', () => {
    chrome.storage.local.set({ savedName: document.getElementById('alert-name').value });
  });
  document.getElementById('alert-email').addEventListener('blur', () => {
    chrome.storage.local.set({ savedEmail: document.getElementById('alert-email').value });
  });

  // Track install once
  chrome.storage.local.get(['installTracked'], (result) => {
    if (!result.installTracked) {
      try {
        fetchWithTimeout(`${API_BASE_URL}/api/analytics/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'install' }),
        }, 3000);
      } catch {}
      chrome.storage.local.set({ installTracked: true });
    }
  });

  if (!currentProduct) return;

  // Check cache first
  const cached = await getFromCache(currentProduct.url);
  if (cached) {
    for (const p of PINCODES) {
      if (cached[p.pincode]) results.set(p.pincode, cached[p.pincode]);
    }
    const done = [...results.values()].filter(r => r.available !== null).length;
    if (done === PINCODES.length) {
      document.getElementById('status-bar').classList.remove('hidden');
      document.getElementById('status-bar').classList.add('done');
      document.getElementById('status-text').textContent = `✅ Available in ${[...results.values()].filter(r => r.available === true).length}/${PINCODES.length} regions`;
      document.getElementById('status-spinner').style.display = 'none';
      document.getElementById('alert-section').classList.remove('hidden');
      document.getElementById('footer-note').textContent = 'Data may vary by exact address. Verify with the retailer before purchasing.';
      renderResults();
      return;
    }
  }

  checkAllPincodes(currentProduct);
});
