
document.addEventListener('click',function(event){
 const button=event.target.closest('#load-map');
 if(!button)return;
 const box=document.getElementById('map-consent-box');
 if(!box)return;
 const frame=document.createElement('iframe');
 frame.src='https://www.google.com/maps?q=EDWISE+Education+%26+Consultancy,+Zülüflühan,+Yeni+7+Sokak+No+13A,+Antakya,+Hatay&output=embed';
 frame.title='EDWISE konum haritası';frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';frame.allowFullscreen=true;
 box.replaceChildren(frame);
});

// Çerez tercihleri: her yeni sayfa girişinde görünür; seçiminiz kaydedilir.
(function(){
 const cookie=document.getElementById('cookie-banner');
 function chooseCookie(value){try{localStorage.setItem('edwise_cookie_choice',value);}catch(e){}if(cookie)cookie.hidden=true;}
 if(cookie)cookie.hidden=false;
 document.getElementById('cookie-accept')?.addEventListener('click',()=>chooseCookie('allowed'));
 document.getElementById('cookie-essential')?.addEventListener('click',()=>chooseCookie('essential'));
 document.getElementById('open-cookie-settings')?.addEventListener('click',()=>{if(cookie)cookie.hidden=false;});
})();
// Anonim başvuru hunisi: kişisel form alanları analiz sistemine gönderilmez.
const EDWISE_TRACKING = (() => {
 let sessionId = "";
 try {
  sessionId = sessionStorage.getItem("edwise_analytics_session") || "";
  if (!sessionId) {
   sessionId = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,"") : Math.random().toString(36).slice(2)+Date.now().toString(36));
   sessionStorage.setItem("edwise_analytics_session",sessionId);
  }
 } catch {
  sessionId = Math.random().toString(36).slice(2)+Date.now().toString(36);
 }
 const consentAllowed = () => {try{return localStorage.getItem("edwise_cookie_choice")==="allowed";}catch(e){return false;}};
 const send = (event, keepalive=false) => {
  if(!consentAllowed())return Promise.resolve(false);
  const payload=JSON.stringify({event,sessionId,path:location.pathname});
  if(keepalive && navigator.sendBeacon){
   try{return navigator.sendBeacon("/api/application-events",new Blob([payload],{type:"application/json"}));}catch(e){}
  }
  return fetch("/api/application-events",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:payload,keepalive}).catch(()=>{});
 };
 return {get sessionId(){return consentAllowed()?sessionId:"";},send};
})();
let edwiseFormStarted=false;
let edwiseSubmitSucceeded=false;
let edwiseAbandonSent=false;
document.addEventListener("click",event=>{
 const link=event.target.closest("a[href]");
 if(!link)return;
 let target;
 try{target=new URL(link.href,location.href)}catch(e){return}
 if(target.origin===location.origin && /\/pages\/basvuru\.html(?:$|[?#])/.test(target.pathname+target.search+target.hash)){
  EDWISE_TRACKING.send("apply_click");
 }
});
if(location.pathname.endsWith("/pages/basvuru.html")){
 EDWISE_TRACKING.send("form_view");
 const applicationForm=document.getElementById("application-form");
 applicationForm?.addEventListener("input",()=>{
  if(!edwiseFormStarted){edwiseFormStarted=true;EDWISE_TRACKING.send("form_start");}
 },{once:true});
 window.addEventListener("pagehide",()=>{
  if(edwiseFormStarted&&!edwiseSubmitSucceeded&&!edwiseAbandonSent){
   edwiseAbandonSent=true;EDWISE_TRACKING.send("form_abandon",true);
  }
 });
 window.addEventListener("focus",()=>{
  if(window.edwiseWhatsAppRedirected){EDWISE_TRACKING.send("site_return");window.edwiseWhatsAppRedirected=false;}
 });
}
// Başvuru: veritabanına kaydet, e-posta bildirimini dene ve WhatsApp mesajını hazırla.
document.addEventListener('submit', async function(e){
 const form=e.target;
 if(!form || form.id!=='application-form') return;
 e.preventDefault();
 const button=form.querySelector('[type="submit"]');
 if(button.disabled) return;
 const f=new FormData(form);
 const payload={
  name:f.get('name'), phone:f.get('phone'), email:f.get('email')||'',
  program:f.get('program'), format:f.get('format'),
  availability:f.get('availability')||'', note:f.get('note')||'',
  privacy:f.get('privacy')==='on',
  trackingSessionId:EDWISE_TRACKING.sessionId
 };
 button.disabled=true;
 const original=button.textContent;
 button.textContent='Başvurunuz kaydediliyor...';
 EDWISE_TRACKING.send("submit_attempt");
 try{
  const response=await fetch('/api/applications',{
   method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify(payload)
  });
  const result=await response.json();
  if(!response.ok || !result.success) throw new Error(result.message||'Başvuru gönderilemedi.');
  edwiseSubmitSucceeded=true;
  const lines=['EDWISE EĞİTİM BAŞVURUSU','Ad Soyad: '+payload.name,'Telefon: '+payload.phone,'E-posta: '+(payload.email||'-'),'Program: '+payload.program,'Eğitim tercihi: '+payload.format,'Uygun zaman: '+(payload.availability||'-'),'Not: '+(payload.note||'-'),'Başvuru No: '+result.applicationId];
  const url='https://wa.me/905512501701?text='+encodeURIComponent(lines.join('\\n'));
  const status=document.createElement('p');
  status.className='form-note';
  status.textContent=result.emailSent
   ? 'Başvurunuz kaydedildi ve e-posta bildirimi gönderildi. WhatsApp mesajı da açılıyor.'
   : 'Başvurunuz panele kaydedildi. E-posta bildirimi gönderilemedi veya henüz etkinleştirilmedi. WhatsApp mesajı açılıyor.';
  form.appendChild(status);
  window.edwiseWhatsAppRedirected=true;
  EDWISE_TRACKING.send("whatsapp_redirect");
  window.open(url,'_blank','noopener');
  form.reset();
 }catch(error){
  alert(error.message||'Başvuru sırasında hata oluştu.');
 }finally{
  button.disabled=false;
  button.textContent=original;
 }
});
