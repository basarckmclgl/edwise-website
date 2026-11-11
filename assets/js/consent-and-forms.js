
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
// Başvuru: önce veritabanına kaydet, ardından WhatsApp mesajını hazırla.
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
  privacy:f.get('privacy')==='on'
 };
 button.disabled=true;
 const original=button.textContent;
 button.textContent='Başvurunuz kaydediliyor...';
 try{
  const response=await fetch('/api/applications',{
   method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify(payload)
  });
  const result=await response.json();
  if(!response.ok || !result.success) throw new Error(result.message||'Başvuru gönderilemedi.');
  const lines=['EDWISE EĞİTİM BAŞVURUSU','Ad Soyad: '+payload.name,'Telefon: '+payload.phone,'E-posta: '+(payload.email||'-'),'Program: '+payload.program,'Eğitim tercihi: '+payload.format,'Uygun zaman: '+(payload.availability||'-'),'Not: '+(payload.note||'-'),'Başvuru No: '+result.applicationId];
  const url='https://wa.me/905512501701?text='+encodeURIComponent(lines.join('\\n'));
  const status=document.createElement('p');
  status.className='form-note';
  status.textContent=result.emailSent
   ? 'Başvurunuz kaydedildi ve e-posta bildirimi gönderildi. WhatsApp mesajı da açılıyor.'
   : 'Başvurunuz panele kaydedildi. E-posta bildirimi için gönderim servisi henüz etkinleştirilmedi. WhatsApp mesajı açılıyor.';
  form.appendChild(status);
  window.open(url,'_blank','noopener');
  form.reset();
 }catch(error){
  alert(error.message||'Başvuru sırasında hata oluştu.');
 }finally{
  button.disabled=false;
  button.textContent=original;
 }
});
