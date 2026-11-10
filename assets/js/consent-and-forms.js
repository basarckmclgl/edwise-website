
document.addEventListener('DOMContentLoaded',function(){
 const button=document.getElementById('load-map');
 if(!button)return;
 button.addEventListener('click',function(){
  const box=document.getElementById('map-consent-box');
  const frame=document.createElement('iframe');
  frame.src='https://www.google.com/maps?q=EDWISE+Education+%26+Consultancy,+Zülüflühan,+Yeni+7+Sokak+No+13A,+Antakya,+Hatay&output=embed';
  frame.title='EDWISE konum haritası'; frame.loading='lazy'; frame.referrerPolicy='no-referrer-when-downgrade'; frame.allowFullscreen=true;
  box.replaceChildren(frame);
 });
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
// Başvuru formu: veriler sunucuda saklanmaz; kullanıcı WhatsApp üzerinden kendisi gönderir.
document.getElementById('application-form')?.addEventListener('submit',function(e){
 e.preventDefault();const f=new FormData(this);
 const lines=['EDWISE EĞİTİM BAŞVURUSU','Ad Soyad: '+f.get('name'),'Telefon: '+f.get('phone'),'E-posta: '+(f.get('email')||'-'),'Program: '+f.get('program'),'Eğitim tercihi: '+f.get('format'),'Uygun zaman: '+(f.get('availability')||'-'),'Not: '+(f.get('note')||'-')];
 const url='https://wa.me/905512501701?text='+encodeURIComponent(lines.join('\n'));
 window.open(url,'_blank','noopener');
});
