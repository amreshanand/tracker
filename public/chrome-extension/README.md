# Product Availability Tracker - Chrome Extension

This Chrome Extension allows you to check real product delivery availability on Flipkart and Amazon India directly from the browser.

## Features

- ✅ **Auto-detect products** - Automatically detects product name, price, and platform
- ✅ **Real availability check** - Actually checks delivery from the Flipkart/Amazon page
- ✅ **Notification alerts** - Subscribe to get notified when products become available
- ✅ **Works offline** - Can check availability even without the backend API

## Installation

### Development/Testing

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this `chrome-extension` folder
5. The extension icon will appear in your toolbar

### Configuration

Before using, update the `API_BASE_URL` in these files:
- `popup.js` (line 2)
- `background.js` (line 4)

Change `https://your-app-url.com` to your actual deployed API URL.

## Usage

1. **Open a Product Page**
   - Go to any product on Flipkart or Amazon India
   - Click the extension icon

2. **Check Availability**
   - Enter a 6-digit pincode
   - Click "Check Availability"
   - The extension checks directly from the page for accurate results

3. **Set Up Notifications**
   - Switch to "Notify Me" tab
   - Enter your name, email, and pincode
   - You'll receive an email when the product becomes available

## How It Works

### Real Availability Check

The extension uses content scripts that run on Flipkart/Amazon pages. When you check availability:

1. The content script finds the pincode input field
2. Enters your pincode
3. Clicks the "Check" button
4. Reads the delivery message from the page
5. Returns the real availability status

This is 100% accurate because it uses the same mechanism as if you were manually checking.

### Backend Integration

The extension communicates with the backend API for:
- Storing notification subscriptions
- Processing alerts
- Sending email notifications

## File Structure

```
chrome-extension/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── content-flipkart.js   # Flipkart page interaction
├── content-amazon.js     # Amazon page interaction
├── background.js         # Background service worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Creating Icons

You need to create icons in these sizes:
- 16x16 pixels (icon16.png)
- 48x48 pixels (icon48.png)
- 128x128 pixels (icon128.png)

Use a simple design with a location pin or delivery truck icon.

## Publishing to Chrome Web Store

1. Create a ZIP file of this folder
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Pay the $5 one-time developer fee
4. Upload your ZIP file
5. Fill in the listing details
6. Submit for review

## Troubleshooting

### Extension not detecting products
- Make sure you're on a product page (not search/listing page)
- Refresh the page and try again
- Check the browser console for errors

### Availability check fails
- The page might have changed its structure
- Try refreshing the page
- Report the issue so we can update the selectors

### API errors
- Make sure you've updated the API_BASE_URL
- Check that your backend is deployed and running
- Verify your internet connection

## Support

For issues or feature requests, please open an issue on the GitHub repository.
