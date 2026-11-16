const trackingUrl = document.getElementById('tracking-url');
const copyButton = document.getElementById('copy-tracking');
const copyStatus = document.getElementById('copy-status');

trackingUrl.value = location.origin + location.pathname;

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(trackingUrl.value);
    copyStatus.textContent = 'تم نسخ الرابط. احفظه في مكان تقدر ترجع له.';
  } catch {
    trackingUrl.focus();
    trackingUrl.select();
    copyStatus.textContent = 'تم تحديد الرابط. انسخه من الخانة.';
  }
});

