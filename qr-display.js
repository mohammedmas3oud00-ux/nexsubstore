const activation = document.getElementById('esim-activation');
const image = document.getElementById('esim-qr');

if (activation && image) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(activation.textContent, 'Byte');
    qr.make();
    image.src = qr.createDataURL(6, 24);
    image.hidden = false;
  } catch {
    document.getElementById('manual-install').open = true;
  }
}
