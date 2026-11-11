(function () {
"use strict";

const FONT_OPTIONS = [
  ["Arial", "Arial, Helvetica, sans-serif"],
  ["Times New Roman", "'Times New Roman', Times, serif"],
  ["Calibri", "Calibri, Arial, sans-serif"],
  ["Georgia", "Georgia, serif"],
  ["Verdana", "Verdana, sans-serif"],
  ["Tahoma", "Tahoma, sans-serif"]
];

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
  });
}

function makeEditor(textareaId, label) {
  const source = document.getElementById(textareaId);
  if (!source || source.dataset.builderReady) return;
  source.dataset.builderReady = "1";
  source.classList.add("hidden");

  const wrap = document.createElement("div");
  wrap.className = "pb-wrap";
  const bar = document.createElement("div");
  bar.className = "pb-toolbar";
  const canvas = document.createElement("div");
  canvas.className = "pb-canvas";
  canvas.contentEditable = "true";
  canvas.setAttribute("role", "textbox");
  canvas.setAttribute("aria-label", label + " içerik düzenleyicisi");
  canvas.setAttribute("aria-multiline", "true");

  let savedRange = null;
  let selectedImage = null;

  function saveSelection() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && canvas.contains(selection.anchorNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
  }
  function restoreSelection() {
    canvas.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  function sync() {
    source.value = canvas.innerHTML;
    source.dispatchEvent(new Event("input", {bubbles:true}));
  }
  function currentBlock() {
    const selection = window.getSelection();
    let node = selection && selection.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node.parentElement !== canvas) node = node.parentElement;
    return node && node.parentElement === canvas ? node : null;
  }
  function addHtml(html) {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    saveSelection();
    sync();
  }
  function button(group, labelText, action, title) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "editor-tool";
    item.textContent = labelText;
    item.title = title || labelText;
    item.addEventListener("mousedown", function (event) { event.preventDefault(); });
    item.addEventListener("click", action);
    group.appendChild(item);
    return item;
  }
  function group() {
    const element = document.createElement("div");
    element.className = "pb-group";
    bar.appendChild(element);
    return element;
  }
  function selectControl(groupElement, labelText, options, action) {
    const label = document.createElement("label");
    label.className = "pb-select-label";
    label.textContent = labelText;
    const select = document.createElement("select");
    select.className = "pb-select";
    options.forEach(function (option) {
      const item = document.createElement("option");
      item.value = option[1];
      item.textContent = option[0];
      select.appendChild(item);
    });
    select.addEventListener("mousedown", saveSelection);
    select.addEventListener("change", function () { action(select.value); select.selectedIndex = 0; });
    label.appendChild(select);
    groupElement.appendChild(label);
  }
  function applyInlineStyle(property, value) {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      const block = currentBlock();
      if (block) block.style[property] = value;
    } else {
      const span = document.createElement("span");
      span.style[property] = value;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      const next = document.createRange();
      next.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(next);
    }
    saveSelection();
    sync();
  }
  function runCommand(command, value) {
    restoreSelection();
    document.execCommand(command, false, value || null);
    saveSelection();
    sync();
  }

  let g = group();
  button(g, "B", function () { runCommand("bold"); }, "Kalın");
  button(g, "I", function () { runCommand("italic"); }, "İtalik");
  button(g, "U", function () { runCommand("underline"); }, "Altı çizili");
  button(g, "S", function () { runCommand("strikeThrough"); }, "Üstü çizili");

  g = group();
  selectControl(g, "Yazı tipi", [["Yazı tipi seç", ""], ...FONT_OPTIONS], function (font) {
    if (font) applyInlineStyle("fontFamily", font);
  });
  selectControl(g, "Boyut", [["Boyut", ""], ...[12,14,16,18,20,22,24,28,32,36,42,48].map(function (n) { return [n + " px", n + "px"]; })], function (size) {
    if (!size) return;
    applyInlineStyle("fontSize", size);
  });
  const colorLabel = document.createElement("label");
  colorLabel.className = "pb-color-label";
  colorLabel.textContent = "Metin rengi";
  const colorInput = document.createElement("input");
  colorInput.type = "color"; colorInput.value = "#24212b"; colorInput.title = "Metin rengi";
  colorInput.addEventListener("mousedown", saveSelection);
  colorInput.addEventListener("input", function () { applyInlineStyle("color", colorInput.value); });
  colorLabel.appendChild(colorInput); g.appendChild(colorLabel);
  const markLabel = document.createElement("label");
  markLabel.className = "pb-color-label";
  markLabel.textContent = "Vurgu";
  const markInput = document.createElement("input");
  markInput.type = "color"; markInput.value = "#fff2a8"; markInput.title = "Metin vurgusu";
  markInput.addEventListener("mousedown", saveSelection);
  markInput.addEventListener("input", function () { applyInlineStyle("backgroundColor", markInput.value); });
  markLabel.appendChild(markInput); g.appendChild(markLabel);

  g = group();
  button(g, "Paragraf", function () { runCommand("formatBlock", "p"); });
  button(g, "Başlık", function () { runCommand("formatBlock", "h2"); });
  button(g, "Alt başlık", function () { runCommand("formatBlock", "h3"); });
  button(g, "Alıntı", function () { runCommand("formatBlock", "blockquote"); });
  button(g, "• Liste", function () { runCommand("insertUnorderedList"); });
  button(g, "1. Liste", function () { runCommand("insertOrderedList"); });

  g = group();
  button(g, "Bağlantı", function () {
    const url = prompt("Bağlantı adresini girin (https://)");
    if (url && safeUrl(url)) runCommand("createLink", safeUrl(url));
  });
  button(g, "Düğme", function () {
    const url = prompt("Düğmenin açacağı adres (https://)");
    const text = prompt("Düğme üzerinde görünecek yazı", "Bilgi al");
    if (url && text && safeUrl(url)) addHtml('<p><a class="cms-button" href="' + escapeHtml(safeUrl(url)) + '">' + escapeHtml(text) + '</a></p>');
  });
  button(g, "Harita / Konum", function () {
    const url = prompt("Google Maps veya OpenStreetMap bağlantısı");
    if (url && safeUrl(url)) addHtml('<p><a href="' + escapeHtml(safeUrl(url)) + '" target="_blank" rel="noopener">Konumu haritada aç</a></p>');
  });
  button(g, "Video URL", function () {
    const url = prompt("YouTube veya Vimeo video bağlantısı");
    if (!url || !safeUrl(url)) return;
    addHtml('<p><a href="' + escapeHtml(safeUrl(url)) + '" target="_blank" rel="noopener">Videoyu izle</a></p>');
  });
  button(g, "Yatay çizgi", function () { addHtml("<hr>"); });

  g = group();
  const picker = document.createElement("input");
  picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp,image/gif"; picker.hidden = true;
  button(g, "Görsel Yükle", function () { saveSelection(); picker.click(); });
  button(g, "Görsel URL", function () {
    const url = prompt("Görselin https:// adresi");
    if (!url || !safeUrl(url)) return;
    const alt = prompt("Görsel açıklaması", "");
    addHtml('<figure><img src="' + escapeHtml(safeUrl(url)) + '" alt="' + escapeHtml(alt || "") + '" style="width:70%;height:auto"><figcaption>' + escapeHtml(alt || "") + '</figcaption></figure>');
  });
  picker.addEventListener("change", async function () {
    const file = picker.files && picker.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Görsel en fazla 5 MB olabilir."); picker.value = ""; return; }
    try {
      const data = new FormData(); data.append("file", file);
      const response = await fetch("/api/media-upload", {method:"POST",credentials:"same-origin",body:data});
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Görsel yüklenemedi.");
      const url = safeUrl(result.file_url || result.url);
      if (!url) throw new Error("Görsel adresi alınamadı.");
      addHtml('<figure><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(file.name) + '" style="width:70%;height:auto"><figcaption>' + escapeHtml(file.name) + '</figcaption></figure>');
    } catch (error) { alert(error.message); }
    finally { picker.value = ""; }
  });
  wrap.appendChild(picker);

  g = group();
  button(g, "Sola", function () { runCommand("justifyLeft"); });
  button(g, "Ortala", function () { runCommand("justifyCenter"); });
  button(g, "Sağa", function () { runCommand("justifyRight"); });
  button(g, "Görseli küçült", function () { resizeImage("60%"); });
  button(g, "Görseli büyüt", function () { resizeImage("100%"); });
  button(g, "Metin yanı", function () { imageFloat("left"); });
  button(g, "Sağda", function () { imageFloat("right"); });
  button(g, "Alt alta", function () { imageFloat("none"); });

  g = group();
  button(g, "↑ Yukarı", function () { moveBlock(-1); });
  button(g, "↓ Aşağı", function () { moveBlock(1); });
  button(g, "Bloğu sil", function () { const block = currentBlock(); if (block && confirm("Seçili içerik bloğu silinsin mi?")) { block.remove(); selectedImage = null; sync(); } });

  const help = document.createElement("p");
  help.className = "editor-help";
  help.textContent = "Word benzeri düzenleme: metni seçerek biçimlendirin. Görseli seçerek boyutunu ve metinle konumunu ayarlayın. Değişiklikler kaydedilen içerikle birlikte yayımlanır.";
  wrap.append(bar, canvas, help);
  source.parentNode.insertBefore(wrap, source);

  function resizeImage(width) {
    if (!selectedImage) { alert("Önce düzenlemek istediğiniz görsele tıklayın."); return; }
    selectedImage.style.width = width; selectedImage.style.maxWidth = "100%"; selectedImage.style.height = "auto"; sync();
  }
  function imageFloat(direction) {
    if (!selectedImage) { alert("Önce düzenlemek istediğiniz görsele tıklayın."); return; }
    selectedImage.style.float = direction === "none" ? "none" : direction;
    selectedImage.style.display = direction === "none" ? "block" : "inline-block";
    selectedImage.style.margin = direction === "left" ? "8px 20px 12px 0" : direction === "right" ? "8px 0 12px 20px" : "12px auto";
    if (direction === "none" && selectedImage.parentElement.tagName === "FIGURE") selectedImage.parentElement.style.textAlign = "center";
    sync();
  }
  function moveBlock(direction) {
    const block = currentBlock();
    if (!block) return;
    const sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) block.parentNode.insertBefore(block, sibling);
    else block.parentNode.insertBefore(sibling, block);
    sync();
  }

  const existing = source.value.trim();
  canvas.innerHTML = existing && /<[a-z][\s\S]*>/i.test(existing)
    ? existing
    : existing ? existing.split(/\n+/).filter(Boolean).map(function (line) { return "<p>" + escapeHtml(line) + "</p>"; }).join("") : "<p><br></p>";

  canvas.addEventListener("input", function () { saveSelection(); sync(); });
  canvas.addEventListener("keyup", saveSelection);
  canvas.addEventListener("mouseup", saveSelection);
  canvas.addEventListener("click", function (event) {
    selectedImage = event.target && event.target.tagName === "IMG" ? event.target : null;
    canvas.querySelectorAll("img.pb-selected").forEach(function (img) { img.classList.remove("pb-selected"); });
    if (selectedImage) selectedImage.classList.add("pb-selected");
    saveSelection();
  });
  canvas.addEventListener("dragover", function (event) { event.preventDefault(); canvas.classList.add("pb-over"); });
  canvas.addEventListener("dragleave", function () { canvas.classList.remove("pb-over"); });
  canvas.addEventListener("drop", async function (event) {
    event.preventDefault(); canvas.classList.remove("pb-over");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) { alert("Görsel en fazla 5 MB olabilir."); return; }
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media-upload", {method:"POST",credentials:"same-origin",body:form});
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Görsel yüklenemedi.");
      const url = safeUrl(result.file_url || result.url);
      if (!url) throw new Error("Görsel adresi alınamadı.");
      addHtml('<figure><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(file.name) + '" style="width:70%;height:auto"><figcaption>' + escapeHtml(file.name) + '</figcaption></figure>');
    } catch (error) { alert(error.message); }
  });
  canvas.addEventListener("paste", function () { setTimeout(function () { saveSelection(); sync(); }, 0); });
}

const style = document.createElement("style");
style.textContent = [
  ".pb-wrap{margin:12px 0;min-width:0}",
  ".pb-toolbar{display:flex;flex-wrap:wrap;gap:7px;padding:11px;background:#11111e;border:1px solid #45405f;border-radius:9px 9px 0 0}",
  ".pb-group{display:flex;align-items:center;gap:5px;flex-wrap:wrap;border-right:1px solid #45405f;padding:0 8px 0 0}",
  ".pb-group:last-child{border-right:0}",
  ".pb-select-label,.pb-color-label{display:flex;align-items:center;gap:5px;color:#ddd6f5;font-size:11px}",
  ".pb-select{width:auto;min-width:100px;padding:7px 8px;background:#242039;color:#fff;border:1px solid #45405f;border-radius:6px;font-size:12px}",
  ".pb-color-label input{width:30px;height:29px;padding:2px;border:1px solid #45405f;background:#242039;border-radius:5px}",
  ".pb-canvas{min-height:440px;padding:30px;background:#fff;color:#24212b;border:1px solid #c9c5d5;border-radius:0 0 9px 9px;font:17px/1.75 Arial,Helvetica,sans-serif;outline:none;overflow-wrap:anywhere}",
  ".pb-canvas:focus{border-color:#a78bfa;box-shadow:0 0 0 2px #8055ed22}",
  ".pb-canvas>*{margin:0 0 16px}",
  ".pb-canvas h2{font-size:30px;line-height:1.3}.pb-canvas h3{font-size:24px;line-height:1.4}",
  ".pb-canvas blockquote{border-left:4px solid #8055ed;padding:13px 18px;background:#f4f0ff;color:#51446d}",
  ".pb-canvas img{max-width:100%;height:auto;cursor:pointer;border-radius:5px}",
  ".pb-canvas img.pb-selected{outline:3px solid #8055ed;outline-offset:3px}",
  ".pb-canvas figure{margin:18px 0;text-align:center;clear:both}.pb-canvas figcaption{font-size:13px;color:#777;margin-top:7px}",
  ".pb-canvas .cms-button{display:inline-block;padding:11px 18px;border-radius:7px;background:#5632a8;color:#fff;text-decoration:none}",
  ".pb-over{outline:3px dashed #8055ed;outline-offset:-5px}",
  ".editor-help{font-size:12px;color:#aaa7c0;line-height:1.6;margin:9px 0 0}",
  "@media(max-width:650px){.pb-canvas{padding:18px 14px;min-height:350px}.pb-group{border:0}.pb-toolbar{gap:8px}}"
].join("");
document.head.appendChild(style);

function init() {
  makeEditor("contentText", "Sayfa");
  makeEditor("serviceContent", "Hizmet");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();