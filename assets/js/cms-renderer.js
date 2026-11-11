(function(){
"use strict";
window.EDWISEContent={
 render:function(target,raw){
  const root=typeof target==="string"?document.querySelector(target):target;if(!root)return;
  const value=String(raw||"");if(!value.trim()){root.replaceChildren();return}
  if(!/<\/?[a-z][\s\S]*>/i.test(value)){root.textContent=value;return}
  const parsed=new DOMParser().parseFromString(value,"text/html");
  const tags=new Set(["P","H2","H3","H4","UL","OL","LI","BLOCKQUOTE","STRONG","B","EM","I","U","A","IMG","FIGURE","FIGCAPTION","HR","DIV","SPAN","TABLE","TBODY","THEAD","TR","TD","TH"]);
  const fonts=["Arial","Helvetica","Times New Roman","Times","Calibri","Georgia","Verdana","Tahoma"];
  const clean=node=>{
   if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
   if(node.nodeType!==Node.ELEMENT_NODE)return document.createDocumentFragment();
   if(!tags.has(node.tagName)){const fragment=document.createDocumentFragment();node.childNodes.forEach(child=>fragment.append(clean(child)));return fragment}
   const el=document.createElement(node.tagName.toLowerCase());
   if(node.tagName==="A"){const href=safe(node.getAttribute("href"));if(href){el.href=href;el.rel="noopener noreferrer";el.target="_blank"}}
   if(node.tagName==="IMG"){const src=safe(node.getAttribute("src"));if(!src)return document.createTextNode("");el.src=src;el.alt=node.getAttribute("alt")||"";el.loading="lazy"}
   const style=node.getAttribute("style")||"";
   const align=style.match(/text-align\s*:\s*(left|center|right)/i);if(align)el.style.textAlign=align[1].toLowerCase();
   const color=style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|[a-z]{3,20})/i);if(color)el.style.color=color[1];
   const bg=style.match(/background-color\s*:\s*(#[0-9a-f]{3,8}|[a-z]{3,20})/i);if(bg)el.style.backgroundColor=bg[1];
   const size=style.match(/font-size\s*:\s*(1[2-9]|[2-4][0-9])px/i);if(size)el.style.fontSize=size[1]+"px";
   const family=style.match(/font-family\s*:\s*([^;]+)/i);if(family){const cleanFamily=family[1].replace(/["']/g,"").split(",")[0].trim();if(fonts.some(font=>font.toLowerCase()===cleanFamily.toLowerCase()))el.style.fontFamily=family[1]}
   if(node.tagName==="IMG"){
    const width=style.match(/width\s*:\s*(\d{1,3}%|\d{1,3}px)/i);if(width)el.style.width=width[1];
    const float=style.match(/float\s*:\s*(left|right|none)/i);if(float)el.style.float=float[1].toLowerCase();
    const margin=style.match(/margin\s*:\s*([^;]+)/i);if(margin)el.style.margin=margin[1];
    el.style.maxWidth="100%";el.style.height="auto";
   }
   node.childNodes.forEach(child=>el.append(clean(child)));return el;
  };
  const safe=value=>{try{const u=new URL(value,location.origin);return ["http:","https:"].includes(u.protocol)?u.href:""}catch{return ""}};
  const fragment=document.createDocumentFragment();parsed.body.childNodes.forEach(node=>fragment.append(clean(node)));root.replaceChildren(fragment);
 }
};
})();