(function(){
 "use strict";
 const root=document.querySelector("[data-cms-slug]");
 if(!root)return;
 const slug=root.getAttribute("data-cms-slug");
 fetch("/api/public-pages?slug="+encodeURIComponent(slug),{headers:{Accept:"application/json"},cache:"no-store"})
  .then(async response=>{const data=await response.json();if(!response.ok||!data.success||!data.page)throw new Error("Page unavailable");return data.page;})
  .then(page=>{
   if(window.EDWISEContent)window.EDWISEContent.render(root,page.content||"");
   else root.textContent=page.content||"";
   document.title=page.meta_title||((page.title||"EDWISE")+" | EDWISE");
   if(page.meta_description){const meta=document.querySelector('meta[name="description"]');if(meta)meta.content=page.meta_description;}
   document.documentElement.dataset.cmsPageLoaded="true";
   document.dispatchEvent(new CustomEvent("edwise:cms-page-loaded",{detail:{slug:slug,page:page}}));
  })
  .catch(error=>{
   root.replaceChildren();
   root.classList.add("cms-page-unavailable");
   const notice=document.createElement("div");notice.className="empty";notice.textContent="Bu sayfa şu anda yayımlanmıyor.";root.append(notice);
   document.documentElement.dataset.cmsPageLoaded="missing";
  });
})();