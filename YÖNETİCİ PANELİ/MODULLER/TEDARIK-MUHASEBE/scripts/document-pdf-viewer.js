// PDF rendering stays on this origin; scripts/actions embedded in documents are never executed.
let library;
function pdfLibrary() {
  if (!library) library = import("../vendor/pdfjs/pdf.min.mjs").then((pdf) => {
    pdf.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    return pdf;
  }).catch((error) => { library = null; throw error; });
  return library;
}

export function renderDocumentPdf(container, blob, { signal, onError } = {}) {
  let loading;
  let document;
  let rendering;
  let destroyed = false;
  let page = 1;
  let zoom = 100;
  let sequence = 0;
  container.innerHTML = '<div class="doc-pdf"><div class="doc-pdf-controls"><button type="button" data-pdf="previous" aria-label="Önceki PDF sayfası">‹</button><span class="doc-pdf-page">PDF yükleniyor…</span><button type="button" data-pdf="next" aria-label="Sonraki PDF sayfası">›</button><span class="doc-controls-space"></span><button type="button" data-pdf="out" aria-label="PDF küçült">−</button><button type="button" data-pdf="reset" aria-label="PDF yakınlaştırmayı sıfırla">100%</button><button type="button" data-pdf="in" aria-label="PDF büyüt">＋</button></div><div class="doc-pdf-canvas"><canvas aria-label="PDF sayfası"></canvas></div></div>';
  const shell = container.querySelector(".doc-pdf");
  const controls = shell.querySelector(".doc-pdf-controls");
  const canvas = shell.querySelector("canvas");
  const error = (cause) => { if (!destroyed && cause?.name !== "RenderingCancelledException") { shell.querySelector(".doc-pdf-page").textContent = "PDF okunamadı"; onError?.("PDF önizlemesi hazırlanamadı. İndir ile özgün dosyayı açabilirsiniz."); } };
  const dispose = () => { if (destroyed) return; destroyed = true; ++sequence; rendering?.cancel(); if(loading) void loading.destroy().catch(()=>{}); };
  if (signal?.aborted) { dispose(); return dispose; }
  signal?.addEventListener("abort", dispose, { once: true });
  const draw = async () => {
    if (destroyed || !document) return;
    const run = ++sequence;
    rendering?.cancel();
    controls.querySelector(".doc-pdf-page").textContent = `Sayfa ${page} / ${document.numPages}`;
    controls.querySelector('[data-pdf="previous"]').disabled = page === 1;
    controls.querySelector('[data-pdf="next"]').disabled = page === document.numPages;
    controls.querySelector('[data-pdf="reset"]').textContent = `${zoom}%`;
    const pdfPage = await document.getPage(page);
    if(destroyed || run !== sequence) return;
    const original = pdfPage.getViewport({ scale:1 });
    const width = Math.max(160, Math.min(1200,canvas.parentElement.clientWidth-24-18));
    const scale = width/original.width * zoom/100;
    const viewport = pdfPage.getViewport({scale});
    const density = Math.min(2,window.devicePixelRatio || 1);
    canvas.width = Math.ceil(viewport.width*density); canvas.height = Math.ceil(viewport.height*density);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-label",`PDF sayfası ${page} / ${document.numPages}`);
    rendering = pdfPage.render({canvasContext:canvas.getContext("2d"),viewport,transform:[density,0,0,density,0,0]});
    await rendering.promise;
  };
  controls.querySelectorAll("button").forEach((button)=>{button.disabled=true;});
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pdf]"); if(!button || button.disabled || !document) return;
    const action = button.dataset.pdf;
    if(action === "previous") page = Math.max(1,page-1);
    if(action === "next") page = Math.min(document.numPages,page+1);
    if(action === "out") zoom = Math.max(50,zoom-25);
    if(action === "in") zoom = Math.min(250,zoom+25);
    if(action === "reset") zoom = 100;
    void draw().catch(error);
  });
  void (async () => {
    const pdf = await pdfLibrary();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if(destroyed) return;
    loading = pdf.getDocument({ data:bytes, isEvalSupported:false, stopAtErrors:true, standardFontDataUrl:new URL("../vendor/pdfjs/standard_fonts/",import.meta.url).href });
    document = await loading.promise;
    if(destroyed) return;
    controls.querySelectorAll("button").forEach((button)=>{button.disabled=false;});
    await draw();
  })().catch(error);
  return dispose;
}
