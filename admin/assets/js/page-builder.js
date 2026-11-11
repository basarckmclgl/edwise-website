(function(){
"use strict";
const allowedTags=new Set(["P","H2","H3","H4","UL","OL","LI","BLOCKQUOTE","STRONG","B","EM","I","U","A","IMG","FIGURE","FIGCAPTION","HR","DIV","SPAN","VIDEO","SOURCE"]);
function safeUrl(value,image){
 try{const u=new URL(value,location.origin);if(!["http:","https:"].includes(u.protocol))return "";if(image&&u.protocol!=="https:"&&u.origin!==location.origin)return "";return u.href}catch{return ""}}
function makeEditor(textareaId,label){
 const source=document.getElementById(textareaId);if(!source||source.dataset.builderReady)return;
 source.dataset.builderReady="1";source.classList.add("hidden");
 const wrap=document.createElement("div");wrap.className="pb-wrap";
 const bar=document.createElement("div");bar.className="pb-toolbar";
 const canvas=document.createElement("div");canvas.className="pb-canvas";canvas.contentEditable="true";canvas.setAttribute("role","textbox");canvas.setAttribute("aria-multiline","true");
 const help=document.createElement("p");help.className="editor-help";help.textContent="Word benzeri düzenleyici: metni seçip biçimlendirin, blok ekleyin veya seçili bloğu taşıyın. Görselleri sürükleyip bırakabilir ya da dosya/URL ile ekleyebilirsiniz.";
 const groups=[
 [["Kalın","bold"],["İtalik","italic"],["Altı çizili","underline"]],
 [["Paragraf","format:p"],["Başlık","format:h2"],["Alt başlık","format:h3"],["Alıntı","format:blockquote"]],
 [["• Liste","insert:ul"],["1. Liste","insert:ol"],["Bağlantı","link"],["Düğme","button"]],
 [["Görsel Yükle","upload"],["Görsel URL","image"],["Harita / Konum","map"],["Video URL","video"],["Yatay çizgi","hr"]],
 [["Sola","align:left"],["Ortala","align:center"],["Sağa","align:right"],["Metin rengi","color"],["Yazı boyutu","size"]],
 [["↑ Yukarı","up"],["↓ Aşağı","down"],["Bloğu sil","delete"]]
 ];
 groups.forEach(items=>{const g=document.createElement("div");g.className="pb-group";items.forEach(([label,action])=>{const b=document.createElement("button");b.type="button";b.className="editor-tool";b.textContent=label;b.addEventListener("mousedown",e=>e.preventDefault());b.addEventListener("click",()=>run(action));g.appendChild(b)});bar.appendChild(g)});
 wrap.append(bar,canvas,help);source.parentNode.insertBefore(wrap,source);
 const picker=document.createElement("input");picker.type="file";picker.accept="image/jpeg,image/png,image/webp,image/gif";picker.hidden=true;wrap.append(picker);picker.addEventListener("change",async()=>{const file=picker.files?.[0];if(!file)return;if(file.size>5*1024*1024){alert("Görsel en fazla 5 MB olabilir.");picker.value="";return}try{const fd=new FormData();fd.append("file",file);const res=await fetch("/api/media-upload",{method:"POST",credentials:"same-origin",body:fd});const data=await res.json();if(!res.ok||!data.success)throw Error(data.message||"Görsel yüklenemedi");const url=data.file_url||data.url;if(!url)throw Error("Görsel adresi alınamadı");const figure=document.createElement("figure"),img=document.createElement("img");img.src=url;img.alt=file.name;figure.append(img);const active=selected();active?active.after(figure):canvas.append(figure);sync()}catch(err){alert(err.message)}finally{picker.value=""}});
 const existing=source.value.trim();canvas.innerHTML=existing&&/<[a-z][\s\S]*>/i.test(existing)?existing:existing?existing.split(/\n+/).filter(Boolean).map(x=>"<p>"+escapeText(x)+"</p>").join(""):"<p><br></p>";
 function escapeText(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
 function selected(){let n=getSelection()?.anchorNode;if(n?.nodeType===3)n=n.parentElement;while(n&&n.parentElement!==canvas)n=n.parentElement;return n&&n.parentElement===canvas?n:null}
 function sync(){source.value=canvas.innerHTML;source.dispatchEvent(new Event("input",{bubbles:true}))}
 function add(tag,html){const el=document.createElement(tag);el.innerHTML=html||"<br>";const active=selected();if(active)active.after(el);else canvas.append(el);el.focus();sync()}
 function run(a){canvas.focus();const active=selected();
 if(["bold","italic","underline"].includes(a)){document.execCommand(a);sync();return}
 if(a.startsWith("format:")){document.execCommand("formatBlock",false,a.split(":")[1]);sync();return}
 if(a.startsWith("insert:")){add(a.endsWith("ul")?"ul":"ol","<li>Liste öğesi</li>");return}
 if(a.startsWith("align:")){if(active)active.style.textAlign=a.split(":")[1];sync();return}
 if(a==="up"&&active?.previousElementSibling)active.parentNode.insertBefore(active,active.previousElementSibling);
 if(a==="down"&&active?.nextElementSibling)active.parentNode.insertBefore(active.nextElementSibling,active);
 if(a==="delete"&&active)active.remove();
 if(a==="link"){const url=prompt("Bağlantı adresi (https://)");if(url&&safeUrl(url)){document.execCommand("createLink",false,url);sync()}return}
 if(a==="button"){const url=prompt("Düğmenin gideceği adres (https://)");const label=prompt("Düğme metni","Daha fazla bilgi");if(url&&label&&safeUrl(url))add("p",'<a href="'+safeUrl(url)+'">'+escapeText(label)+'</a>');return}
 if(a==="upload"){picker.click();return}
 if(a==="image"){const url=prompt("Görsel URL adresi");if(url&&safeUrl(url,true)){const img=document.createElement("img");img.src=safeUrl(url,true);img.alt=prompt("Görsel açıklaması","");img.style.maxWidth="100%";img.style.height="auto";const figure=document.createElement("figure");figure.append(img);const active=selected();active?active.after(figure):canvas.append(figure);sync()}return}
 if(a==="map"){const url=prompt("Harita bağlantısı (Google Maps veya OpenStreetMap)");if(url&&safeUrl(url))add("p",'<a href="'+safeUrl(url)+'" target="_blank" rel="noopener">Konumu haritada aç</a>');return}
 if(a==="video"){const url=prompt("Video bağlantısı (YouTube/Vimeo)");if(url&&safeUrl(url))add("p",'<a href="'+safeUrl(url)+'" target="_blank" rel="noopener">Videoyu izle</a>');return}
 if(a==="hr")add("hr","");
 if(a==="color"){const color=prompt("Metin rengi (ör. #333333)","#333333");if(color&&/^#[0-9a-f]{6}$/i.test(color)&&active)active.style.color=color}
 if(a==="size"){const size=prompt("Yazı boyutu (12–48 px)","18");if(size&&Number(size)>=12&&Number(size)<=48&&active)active.style.fontSize=Number(size)+"px"}
 sync()}
 canvas.addEventListener("input",sync);
 canvas.addEventListener("dragover",e=>{e.preventDefault();canvas.classList.add("pb-over")});
 canvas.addEventListener("dragleave",()=>canvas.classList.remove("pb-over"));
 canvas.addEventListener("drop",async e=>{e.preventDefault();canvas.classList.remove("pb-over");const file=e.dataTransfer.files?.[0];if(!file||!file.type.startsWith("image/"))return;try{const fd=new FormData();fd.append("file",file);const res=await fetch("/api/media-upload",{method:"POST",credentials:"same-origin",body:fd});const data=await res.json();if(!res.ok||!data.success)throw Error(data.message||"Görsel yüklenemedi");const url=data.file_url||data.url;if(!url)throw Error("Görsel adresi alınamadı");const img=document.createElement("img");img.src=url;img.alt=file.name;img.style.maxWidth="100%";const figure=document.createElement("figure");figure.append(img);canvas.append(figure);sync()}catch(err){alert(err.message)}});
 canvas.addEventListener("paste",()=>setTimeout(sync,0));
}
const style=document.createElement("style");style.textContent='.pb-wrap{margin:10px 0}.pb-toolbar{display:flex;flex-wrap:wrap;gap:7px;padding:10px;background:#11111e;border:1px solid #45405f;border-radius:9px 9px 0 0}.pb-group{display:flex;gap:5px;flex-wrap:wrap;border-right:1px solid #45405f;padding-right:7px}.pb-canvas{min-height:360px;padding:25px;background:#fff;color:#24212b;border:1px solid #c9c5d5;border-radius:0 0 9px 9px;font:17px/1.7 Arial;outline:none}.pb-canvas:focus{border-color:#a78bfa}.pb-canvas>*{margin:0 0 14px}.pb-canvas img{max-width:100%;height:auto}.pb-canvas figure{text-align:center}.pb-canvas blockquote{border-left:4px solid #8055ed;padding:12px 18px;background:#f4f0ff}.pb-over{outline:3px dashed #8055ed}';document.head.append(style);
 document.addEventListener("DOMContentLoaded",()=>{makeEditor("contentText","Sayfa");makeEditor("serviceContent","Hizmet")});
})();