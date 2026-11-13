# EDWISE Yönetim Paneli — İlk Ekran Planı

## 1. Genel Bakış
- İstatistik, ziyaretçi takibi, IP/ülke/ziyaretçi davranışı veya analitik grafik bulunmayacak.
- Sık kullanılan işlemlere kısayollar: yeni sayfa, medya yükleme, menü düzenleme, SEO düzenleme.
- Sistem durumu yalnızca teknik sağlık/erişilebilirlik düzeyinde gösterilebilir; ziyaretçi takibi yapılmaz.

## 2. Sol menü

### Çalışma alanı
1. Genel Bakış
2. Sayfalar
3. Hizmetler
4. Başvurular
5. Medya Kütüphanesi

### Site yönetimi
6. Menü Yönetimi
7. SEO Ayarları
8. Dil Yönetimi
9. Site Ayarları

### Yalnızca Süper Yönetici
10. Kullanıcılar ve Yetkiler
11. Sistem Kayıtları
12. Yedekleme / Geri Yükleme (mevcut altyapı doğrulandıktan sonra)
13. Bakım Modu ve Proje Sonlandırma (ayrı onay ve yetki kontrolüyle)

## 3. Rol matrisi

| İşlem | Admin (site sahibi) | Süper Yönetici |
|---|---:|---:|
| Sayfa/hizmet içeriklerini yönetme | Evet | Evet |
| Başvuruları görüntüleme/yönetme | Evet | Evet |
| Medya, menü, SEO, dil | Evet | Evet |
| Kendi profilini yönetme | Evet | Evet |
| Kullanıcı ve rol yönetimi | Hayır | Evet |
| Sistem kayıtları ve teknik teşhis | Hayır | Evet |
| Güvenlik ve altyapı ayarları | Hayır | Evet |
| Bakım modu / proje sonlandırma | Hayır | Sınırlı ve denetimli |

## 4. Tasarım ilkeleri
- Koyu lacivert/mor tema, sade kartlar ve belirgin gezinme.
- Mobil uyumlu sol menü.
- Admin için yalnızca günlük iş akışına gereken ekranlar.
- Yetki kontrolü sadece arayüzde değil, API tarafında da uygulanmalı.
- Mevcut sayfalar, veritabanı şeması, ayarlar ve canlı yayın akışı korunmalı.

## 5. Uygulama sırası
1. Mevcut API uçlarının rol kontrollerini envanterle.
2. Ekran menüsünü mevcut API yetkileriyle eşleştir.
3. Yeni arayüzü ayrı dalda geliştir ve test et.
4. Admin ve Süper Yönetici hesaplarıyla yetki testleri yap.
5. Geri dönüş planı ve yedek doğrulaması olmadan canlıya alma.

> Bu plan ve HTML dosyası konsept/prototiptir; henüz canlı panelin yerine geçmez ve Cloudflare Pages'e deploy edilmemiştir.
