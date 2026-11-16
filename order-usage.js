const usageButton = document.getElementById('load-usage');
const usageStatus = document.getElementById('usage-status');
const usageResults = document.getElementById('usage-results');

function appendText(parent, tag, label, value = '') {
  const element = document.createElement(tag);
  element.textContent = label;
  if (value) {
    const data = document.createElement('bdi');
    data.textContent = value;
    element.append(data);
  }
  parent.append(element);
}

usageButton.addEventListener('click', async () => {
  usageButton.disabled = true;
  usageStatus.textContent = 'جارٍ جلب بيانات الاستهلاك…';
  try {
    const url = location.pathname.replace(/\/$/, '') + '/usage';
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.usage)) throw new Error('Usage unavailable');

    usageResults.replaceChildren();
    data.usage.forEach((device, index) => {
      if (data.usage.length > 1) appendText(usageResults, 'h3', 'الشريحة ' + (index + 1));
      if (!device) {
        appendText(usageResults, 'p', 'تعذر جلب استهلاك هذه الشريحة حاليًا.');
        return;
      }
      if (device.cumulative) appendText(usageResults, 'p', 'الاستهلاك الإجمالي: ', device.cumulative);
      if (device.daily.length) {
        appendText(usageResults, 'p', 'الاستهلاك اليومي');
        const list = document.createElement('ul');
        device.daily.forEach(entry => appendText(list, 'li', entry.date ? entry.date + ' · ' : '', entry.amount));
        usageResults.append(list);
      }
      if (device.resetTime) appendText(usageResults, 'p', 'وقت تجديد الحصة اليومية: ', device.resetTime);
    });
    usageStatus.textContent = '';
    usageButton.textContent = 'تحديث الاستهلاك';
  } catch {
    usageStatus.textContent = 'تعذر جلب بيانات الاستهلاك حاليًا. حاول تاني بعد قليل.';
  } finally {
    usageButton.disabled = false;
  }
});
