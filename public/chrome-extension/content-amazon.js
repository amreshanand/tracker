// Content script for Amazon India pages
// This script runs on amazon.in and can interact with the actual page

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProductInfo') {
    sendResponse(getProductInfo());
    return true;
  }
  
  if (request.action === 'checkDelivery') {
    checkDelivery(request.pincode).then(sendResponse);
    return true;
  }
});

// Get product information from the page
function getProductInfo() {
  try {
    // Product name
    let name = null;
    const nameEl = document.querySelector('#productTitle') || 
                   document.querySelector('[data-automation-id="title-text"]');
    if (nameEl) {
      name = nameEl.textContent.trim();
    }
    
    // Price
    let price = null;
    const priceEl = document.querySelector('.a-price-whole') ||
                    document.querySelector('#priceblock_ourprice') ||
                    document.querySelector('#priceblock_dealprice') ||
                    document.querySelector('.a-price .a-offscreen');
    if (priceEl) {
      price = '₹' + priceEl.textContent.trim().replace(/[^\d,]/g, '');
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
    // Find pincode input on Amazon
    let pincodeInput = document.querySelector('#GLUXZipUpdateInput') ||
                       document.querySelector('input[name="zipCode"]') ||
                       document.querySelector('#GLUXZipUpdateInput_0');
    
    if (!pincodeInput) {
      // Try clicking the delivery location link
      const deliveryLink = document.querySelector('#nav-global-location-popover-link') ||
                           document.querySelector('#glow-ingress-line2') ||
                           document.querySelector('[data-action="a-popover"]');
      
      if (deliveryLink) {
        deliveryLink.click();
        await sleep(1000);
        
        pincodeInput = document.querySelector('#GLUXZipUpdateInput') ||
                       document.querySelector('input[name="zipCode"]') ||
                       document.querySelector('input[placeholder*="pincode" i]');
      }
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
    
    // Find and click apply button
    await sleep(300);
    
    const applyButton = document.querySelector('#GLUXZipUpdate') ||
                        document.querySelector('[data-action="GLUXPostalUpdateAction"]') ||
                        document.querySelector('input[type="submit"][value*="Apply"]');
    
    if (applyButton) {
      applyButton.click();
      await sleep(2000);
    }
    
    // Check for delivery messages
    const pageText = document.body.innerText.toLowerCase();
    
    const notAvailablePatterns = [
      'currently unavailable',
      'out of stock',
      'not available',
      'we don\'t know when or if this item will be back in stock',
      'cannot be delivered',
      'does not deliver to',
      'not deliverable'
    ];
    
    // Only consider available if we also find positive delivery indicators
    const hasPositiveIndicator = pageText.includes('deliver') || 
                                 pageText.includes('delivery') ||
                                 pageText.includes('in stock') ||
                                 document.querySelector('#delivery-message, #mir-layout-DELIVERY_BLOCK, [data-csa-c-delivery-price]') !== null;
    const hasNegativeIndicator = notAvailablePatterns.some(pattern => pageText.includes(pattern));
    const available = !hasNegativeIndicator && hasPositiveIndicator;
    
    // Try to get delivery info
    let deliveryInfo = null;
    const deliveryEl = document.querySelector('#delivery-message') ||
                       document.querySelector('#mir-layout-DELIVERY_BLOCK') ||
                       document.querySelector('[data-csa-c-delivery-price]');
    
    if (deliveryEl) {
      deliveryInfo = deliveryEl.textContent.trim().substring(0, 100);
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

// Helper sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Notify that content script is loaded
console.log('Product Availability Tracker: Amazon content script loaded');
