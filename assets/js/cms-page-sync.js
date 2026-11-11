(function(){
 "use strict";
 const routes={
  "/":"anasayfa","/index.html":"anasayfa",
  "/pages/hizmetlerimiz.html":"hizmetlerimiz",
  "/pages/hakkimizda.html":"hakkimizda",
  "/pages/basvuru.html":"basvuru",
  "/pages/iletisim.html":"iletisim",
  "/edwise-rehber.html":"edwise-rehber",
  "/pages/egitim-danismanligi.html":"egitim-danismanligi",
  "/pages/coaching-mentoring.html":"coaching-mentoring",
  "/pages/ielts.html":"ielts","/pages/toefl.html":"toefl",
  "/pages/yds.html":"yds","/pages/yokdil.html":"yokdil",
  "/pages/speaking-club.html":"speaking-club",
  "/pages/yasal-bilgilendirme.html":"yasal-bilgilendirme"
 };
 const path=location.pathname;
 const params=new URLSearchParams(location.search);
 if(path==="/pages/sayfa.html"&&params.has("slug"))return;
 const slug=routes[path];
 if(!slug)return;
 const root=document.querySelector("[data-cms-slug]")||
  document.querySelector(".single-page-content")||
  document.querySelector(".guide-page")||
  document.querySelector("main");
 if(!root)return;
 const setMeta=(selector,value)=>{const node=document.querySelector(selector);if(node&&value)node.setAttribute("content",value)};
 fetch("/api/public-pages?slug="+encodeURIComponent(slug),{headers:{Accept:"application/json"},cache:"no-store"})
  .then(async response=>{const data=await response.json();if(!response.ok||!data.success||!data.page)throw new Error("Page unavailable");return data.page;})
  .then(page=>{
   const liveNodes=["services-list","guide-content"].map(id=>document.getElementById(id)).filter(Boolean);
   if(window.EDWISEContent)window.EDWISEContent.render(root,page.content||"");
   else root.textContent=page.content||"";
   liveNodes.forEach(node=>{const replacement=root.querySelector("#"+node.id);if(replacement)replacement.replaceWith(node);});
   document.title=page.meta_title||((page.title||"EDWISE")+" | EDWISE");
   setMeta('meta[name="description"]',page.meta_description);
   setMeta('meta[property="og:title"]',page.meta_title||page.title);
   setMeta('meta[property="og:description"]',page.meta_description);
   const robots=document.querySelector('meta[name="robots"]');if(robots)robots.content="index, follow, max-image-preview:large";
   document.documentElement.dataset.cmsPageLoaded="true";
   document.dispatchEvent(new CustomEvent("edwise:cms-page-loaded",{detail:{slug:slug,page:page}}));
  })
  .catch(()=>{
   root.replaceChildren();
   root.classList.add("cms-page-unavailable");
   const notice=document.createElement("div");notice.className="empty";notice.textContent="Bu sayfa şu anda yayımlanmıyor veya kaldırılmış.";
   root.append(notice);
   const robots=document.querySelector('meta[name="robots"]');if(robots)robots.content="noindex, nofollow";
   document.documentElement.dataset.cmsPageLoaded="missing";
  });
})();