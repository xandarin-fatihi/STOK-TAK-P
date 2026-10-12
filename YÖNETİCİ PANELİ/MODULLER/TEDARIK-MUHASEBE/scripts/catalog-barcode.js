// Barkod fotoğrafları yalnız tarayıcıda okunur; bu modül ürün kaydetmez veya görsel yüklemez.
export function findBarcodeConflict(products, value, currentId = "") {
  return (products || []).find((product) => {
    if (String(product.id) === String(currentId)) return false;
    return [product.barcode || product.gtin, ...(product.barcodes || []), ...(product.alternativeBarcodes || [])].some((item) => {
      const code = item && typeof item === "object" ? item.value ?? item.barcode ?? item.code ?? item.gtin : item;
      return String(code ?? "").trim() === value;
    });
  });
}

export function createCatalogBarcodeScanner({ dialog, getContext, onUse }) {
  const node = (id) => dialog.querySelector(`#${id}`);
  const video = node("catalogBarcodeVideo");
  const image = node("catalogBarcodeImage");
  const placeholder = node("catalogBarcodePlaceholder");
  const status = node("catalogBarcodeStatus");
  const result = node("catalogBarcodeResult");
  const useButton = node("catalogBarcodeUse");
  const cameraButton = node("catalogBarcodeCamera");
  const photoButton = node("catalogBarcodeCapture");
  const fileInput = node("catalogBarcodeFile");
  const cameraInput = node("catalogBarcodeCameraFile");
  const cleanups = [];
  const objectUrls = new Set();
  let reader = null, controls = null, session = 0, pending = "", ownerId = "", busy = false, returnFocus = null;

  function bind(target, event, handler) {
    target.addEventListener(event, handler);
    cleanups.push(() => target.removeEventListener(event, handler));
  }

  function message(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setBusy(value, allowPhoto = false) {
    busy = value && !allowPhoto;
    cameraButton.disabled = value;
    photoButton.disabled = busy;
    node("catalogBarcodePhoto").disabled = busy;
    useButton.disabled = value || !pending;
    dialog.setAttribute("aria-busy", String(value));
  }

  function getReader() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) throw new Error("Barkod okuyucu yüklenemedi. Kodu elle girebilirsiniz.");
    if (!reader) reader = new window.ZXingBrowser.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 600 });
    return reader;
  }

  function stopCamera() {
    session += 1; // Geç gelen kamera/fotoğraf sonucu kapanan veya başka ürüne ait forma yazılamaz.
    try { controls?.stop(); } catch (_error) { /* Already stopped. */ }
    controls = null;
    const stream = video.srcObject;
    stream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    placeholder.hidden = !image.hidden;
    setBusy(false);
  }

  function clearResult() {
    pending = "";
    result.hidden = true;
    node("catalogBarcodeValue").textContent = "";
    node("catalogBarcodeReplace").hidden = true;
    useButton.disabled = true;
  }

  function validContext() {
    const context = getContext();
    return context && String(context.productId || "") === ownerId ? context : null;
  }

  function accept(value) {
    stopCamera();
    clearResult();
    const context = validContext();
    const code = String(value ?? "").trim();
    if (!context || !dialog.open) return;
    if (!code || code.length > 240 || /[\u0000-\u001f\u007f]/.test(code)) {
      message("Geçerli bir barkod okunamadı. Yeniden tarayın veya farklı fotoğraf seçin.", "error");
      return;
    }
    const conflict = findBarcodeConflict(context.products, code, ownerId);
    if (conflict) {
      message(`Bu barkod başka bir üründe kullanılıyor: ${conflict.name || conflict.productName || "Stok ürünü"}.`, "error");
      return;
    }
    pending = code;
    node("catalogBarcodeValue").textContent = code;
    result.hidden = false;
    const replacement = node("catalogBarcodeReplace");
    replacement.hidden = !context.currentBarcode || context.currentBarcode === code;
    replacement.textContent = replacement.hidden ? "" : `Mevcut ana barkod değişecek: ${context.currentBarcode}`;
    message("Barkod algılandı. Kullanmadan önce kodu kontrol edin.", "success");
    setBusy(false);
    useButton.focus();
  }

  function cameraFrame() {
    if (!video.videoWidth || !video.videoHeight) return "";
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", .9);
  }

  function showImage(url) {
    image.src = url;
    image.hidden = false;
    placeholder.hidden = true;
    video.hidden = true;
  }

  async function startCamera() {
    if (!dialog.open || busy || !validContext()) return;
    stopCamera();
    clearResult();
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      message("Kamera kullanılamıyor. Fotoğraf çekebilir, görsel seçebilir veya kodu elle girebilirsiniz.", "error");
      return;
    }
    const token = session;
    setBusy(true, true);
    message("Kamera hazırlanıyor… Tarayıcı sorarsa kamera izni verin.");
    try {
      const active = await getReader().decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }, video, (decoded, error, cameraControls) => {
        if (token !== session || !dialog.open || !validContext()) { cameraControls?.stop(); return; }
        if (decoded) {
          try { const frame = cameraFrame(); if (frame) showImage(frame); } catch (_error) { /* Kod önizlemesi yeterlidir. */ }
          cameraControls?.stop();
          accept(decoded.getText());
        } else if (error && !["NotFoundException", "ChecksumException", "FormatException"].includes(error.name)) {
          stopCamera();
          cameraControls?.stop();
          message("Kamera görüntüsü okunamadı. Yeniden tarayın veya fotoğraf seçin.", "error");
        }
      });
      if (token !== session || !dialog.open || !validContext()) { active?.stop(); return; }
      controls = active;
      video.hidden = false;
      placeholder.hidden = true;
      cameraButton.textContent = "Yeniden Tara";
      message("Barkodu çerçevenin içine hizalayın.");
    } catch (error) {
      if (token !== session || !dialog.open) return;
      stopCamera();
      const text = ["NotAllowedError", "SecurityError"].includes(error.name)
        ? "Kamera izni verilmedi. Görselden okuyabilir veya kodu elle girebilirsiniz."
        : ["NotFoundError", "DevicesNotFoundError"].includes(error.name)
          ? "Kamera bulunamadı. Görselden okuyabilir veya kodu elle girebilirsiniz."
          : error.message || "Kamera açılamadı. Görselden okumayı deneyin.";
      message(text, "error");
    } finally {
      if (token === session) setBusy(false);
    }
  }

  async function decodeImage(url) {
    stopCamera();
    clearResult();
    const token = session;
    showImage(url);
    setBusy(true);
    message("Fotoğraftaki barkod okunuyor…");
    try {
      const decoded = await getReader().decodeFromImageUrl(url);
      if (token === session && dialog.open && validContext()) accept(decoded.getText());
    } catch (_error) {
      if (token === session && dialog.open) message("Fotoğrafta barkod okunamadı. Daha net ve yakın bir fotoğraf deneyin.", "error");
    } finally {
      if (token === session) setBusy(false);
    }
  }

  async function readFile(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !dialog.open || busy) return;
    if (!file.size || file.size > 15 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      clearResult();
      message("En fazla 15 MB boyutunda JPG, PNG veya WebP fotoğraf seçin.", "error");
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    try { await decodeImage(url); }
    finally { URL.revokeObjectURL(url); objectUrls.delete(url); }
  }

  function close({ restoreFocus = true } = {}) {
    if (!dialog.open && !controls && !pending && !busy && !objectUrls.size) return;
    stopCamera();
    clearResult();
    image.hidden = true;
    image.removeAttribute("src");
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    fileInput.value = cameraInput.value = "";
    if (dialog.open) dialog.close();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function open() {
    const context = getContext();
    if (!context || dialog.open) return;
    ownerId = String(context.productId || "");
    returnFocus = document.activeElement;
    clearResult();
    node("catalogBarcodeProductName").textContent = context.name || "Yeni ürün";
    cameraButton.textContent = "Kamerayı Aç";
    dialog.showModal();
    // Kamera yalnız kullanıcının Barkod Tara eylemiyle başlar.
    void startCamera();
  }

  bind(cameraButton, "click", () => { void startCamera(); });
  bind(photoButton, "click", () => {
    if (busy) return;
    if (!video.hidden && video.videoWidth) {
      try { void decodeImage(cameraFrame()); }
      catch (_error) { message("Fotoğraf çekilemedi. Görsel seçmeyi deneyin.", "error"); }
    } else cameraInput.click();
  });
  bind(node("catalogBarcodePhoto"), "click", () => fileInput.click());
  bind(fileInput, "change", () => { void readFile(fileInput); });
  bind(cameraInput, "change", () => { void readFile(cameraInput); });
  bind(useButton, "click", () => {
    if (busy || !pending || !validContext()) return;
    try { onUse(pending); close(); }
    catch (error) { clearResult(); message(error.message || "Barkod aktarılamadı.", "error"); }
  });
  bind(node("catalogBarcodeClose"), "click", () => close());
  bind(dialog, "cancel", (event) => { event.preventDefault(); close(); });
  bind(dialog, "close", () => { stopCamera(); clearResult(); });
  bind(document, "visibilitychange", () => { if (document.hidden) close({ restoreFocus: false }); });
  bind(window, "pagehide", () => close({ restoreFocus: false }));
  return { open, close, destroy() { close({ restoreFocus: false }); cleanups.forEach((cleanup) => cleanup()); } };
}
