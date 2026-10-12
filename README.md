# STS — Stok Takip Sistemi

Bakım atölyesi için yönetici ve personel panelleri. Ürün/depo yönetimi,
malzeme arama, talepler, personel görevleri, vardiyalar, bildirimler ve belge
kayıtlarını ortak Node.js sunucusu üzerinden çalıştırır.

## Yerel çalıştırma

Node.js 20.9 veya üzeri ve npm gereklidir. Windows PowerShell'de depo kökünde:

```powershell
Set-Location -LiteralPath '.\ORTAK'
npm ci
Set-Location -LiteralPath '..'
powershell -ExecutionPolicy Bypass -File '.\LOCAL\START.ps1'
```

- Yönetici: http://localhost:6075/yonetici/
- Personel: http://localhost:6075/personel/
- Sağlık kontrolü: http://localhost:6075/api/health

Terminal açık kaldığı sürece sunucu çalışır. Aynı portta çalışan başka bir
kopya varsa başlatıcı mevcut sunucuyu gösterir; iki kopyayı aynı veri dosyasına
yazacak şekilde çalıştırmayın.

Yeni kurulumda yönetici kullanıcı adı `admin` olur. Başlatıcı rastgele ilk
parolayı ve oturum anahtarını `LOCAL/.local.env` dosyasına kaydeder; bunları
konsola yazmaz. Gerçek parolalar ve personel hesapları GitHub'a gönderilmez.
İsteğe bağlı yerel ayarlar için `LOCAL/.env.example` dosyasını kullanın.

## Kontroller

```powershell
Set-Location -LiteralPath '.\ORTAK'
npm run check
npm test
```

Testler geçici/izole veri kullanır. Windows OCR özelliği işletim sisteminin
OCR desteğine bağlıdır; gerçek kamera ve belge tarama ayrıca cihaz üzerinde
kontrol edilmelidir.

## Proje yapısı

- `ORTAK/API`: sunucu, veri servisleri ve otomatik testler.
- `ORTAK/ASSETS`, `ORTAK/CSS`, `ORTAK/JS`: ortak arayüz kaynakları.
- `PERSONEL`: personel paneli.
- `YÖNETİCİ PANELİ`: yönetici paneli ve belge modülü.
- `LOCAL`: başlatma/durdurma ve bakım araçları.
- `TASARIM`: uygulamaya henüz entegre edilmemiş tasarım referansları.

## Video referanslı raf planı

`TASARIM/atolye-video-raf-plani.html` tarayıcıda ayrı açılabilen taslaktır.
Raf noktası seçme, yumuşak yakınlaşma, +/− ve sürükleyerek gezinme içerir.
Plan yaklaşık yerleşimdir; ürün–raf eşleştirmesi yapılmamıştır ve mevcut
Malzeme Nerede ekranının yerine geçmez. Ayrıntılar `TASARIM/README.md` içinde.

`LOCAL/prepare-workshop-stock.js` yalnız açıkça istenen temiz başlangıç için
hazırlanmış bakım aracıdır; normal kurulum adımı değildir. Veri temizleme
yaptığından mevcut veri üzerinde gelişigüzel çalıştırılmamalıdır.

## Veri ve güvenlik

Git kaynakları ve kilitlenmiş bağımlılık listesini içerir. `node_modules`,
yerel ortam dosyaları, `ORTAK/VERİ` altındaki veritabanı/oturumlar, yüklenen
görseller ve belgeler, loglar ve yedekler `.gitignore` ile hariç tutulur.
Bu nedenle yeni bir klon mevcut 85 malzemeyi veya gerçek kullanıcıları
otomatik taşımaz. Mevcut bilgisayardaki yerel veri kopyası korunur; başka
bir bilgisayara verileri ancak özel ve güvenli yedek aktarımıyla taşıyın.

Bu başlatıcı yerel geliştirme içindir. İnternete açmadan önce HTTPS,
üretim ortamı değişkenleri, güvenli çerezler, erişim sınırları ve ayrı
kalıcı veri/yedek dizinleri yapılandırılmalıdır. Üretim doğrulamaları
`ORTAK/API/src/config.js` içinde yer alır.
