// Content script for Flipkart pages
// This script runs on flipkart.com and can interact with the actual page

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProductInfo') {
    sendResponse(getProductInfo());
    return true;
  }
  
  if (request.action === 'checkDelivery') {
    checkDelivery(request.pincode).then(sendResponse);
    return true; // Keep channel open for async response
  }
});

// Get product information from the page
function getProductInfo() {
  try {
    // Try multiple selectors for product name
    let name = null;
    const nameSelectors = [
      'h1 span',
      'h1',
      'span.B_NuCI',
      '[class*="VU-ZEz"]'
    ];
    
    for (const selector of nameSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        name = el.textContent.trim();
        break;
      }
    }
    
    // Get price
    let price = null;
    const priceSelectors = [
      'div._30jeq3._16Jk6d',
      'div._30jeq3',
      '[class*="Nx9bqj"]'
    ];
    
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        price = el.textContent.trim();
        break;
      }
    }
    
    return { name, price };
  } catch (error) {
    console.error('Error getting product info:', error);
    return { name: null, price: null };
  }
}

// Check delivery availability for a pincode
async function checkDelivery(pincode) {
  try {
    // Find pincode input
    let pincodeInput = document.querySelector('#pincodeInputId');
    
    if (!pincodeInput) {
      // Try clicking the delivery/pincode change link
      const changeLinks = document.querySelectorAll('span, a, div');
      for (const link of changeLinks) {
        const text = link.textContent.toLowerCase();
        if (text.includes('change') || text.includes('enter pincode') || text.includes('check')) {
          if (link.closest('[class*="pincode"]') || link.closest('[class*="delivery"]')) {
            link.click();
            await sleep(500);
            break;
          }
        }
      }
      
      pincodeInput = document.querySelector('#pincodeInputId') || 
                     document.querySelector('input[class*="cfnctZ"]') ||
                     document.querySelector('input[placeholder*="pincode" i]');
    }
    
    if (!pincodeInput) {
      return { checked: false, error: 'Could not find pincode input' };
    }
    
    // Clear and enter pincode
    pincodeInput.focus();
    pincodeInput.value = '';
    
    // Simulate typing
    for (const char of pincode) {
      pincodeInput.value += char;
      pincodeInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(50);
    }
    
    // Find and click check button
    await sleep(300);
    
    const checkButton = findCheckButton();
    if (checkButton) {
      checkButton.click();
      await sleep(2000);
    } else {
      // Try pressing Enter
      pincodeInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await sleep(2000);
    }
    
    // Check for delivery messages
    const pageText = document.body.innerText.toLowerCase();
    
    const notAvailablePatterns = [
      'currently out of stock',
      'not available',
      'no seller',
      'not serviceable',
      'cannot be delivered',
      'sorry, this item is not available',
      'delivery not available',
      'not deliverable',
      'not available at this pincode'
    ];
    
    // Check if the "Notify Me" button is visible instead of "Buy Now"
    // This is a strong indicator of unserviceability for specific products
    const notifyMeBtn = document.querySelector('button._2KpZ6l._2uS64n, button[text*="Notify Me" i]');
    const outOfStockText = pageText.includes('not available at this pincode') || pageText.includes('currently out of stock');

    const available = !notifyMeBtn && !outOfStockText;
    
    // Try to get delivery info
    let deliveryInfo = null;
    const deliverySelectors = [
      '[class*="delivery"]',
      '[class*="_3XINqE"]',
      '[class*="_1TPvuF"]'
    ];
    
    for (const selector of deliverySelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        const text = el.textContent.trim();
        if (text.length < 200 && (text.includes('Deliver') || text.includes('by'))) {
          deliveryInfo = text;
          break;
        }
      }
    }
    
    return {
      checked: true,
      available,
      deliveryInfo,
      pincode
    };
  } catch (error) {
    console.error('Error checking delivery:', error);
    return { checked: false, error: error.message };
  }
}

// Find the check/apply button
function findCheckButton() {
  const buttons = document.querySelectorAll('span, button, div');
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    if (text === 'check' || text === 'apply') {
      // Make sure it's clickable and visible
      const style = window.getComputedStyle(btn);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        return btn;
      }
    }
  }
  return null;
}

// Helper sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Notify that content script is loaded
console.log('Product Availability Tracker: Flipkart content script loaded');
