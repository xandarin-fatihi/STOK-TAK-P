# Commit hazırlık kontrolü — 12.10.2026

Güncel masaüstü sürümünden kaynak kopyası hazırlanmıştır. Asıl çalışan
kurulum değiştirilmemiştir. İlk hazırlık çalışmasında commit ve push yapılmamıştır.

## Raf taslağı eşitlemesi — 12.10.2026

Eşitleme başlangıcında kullanıcı tarafından oluşturulmuş `53f166e STOK`
commit'i ve temiz çalışma ağacı görüldü; mevcut commit korunmuştur.
272 ortak kaynak dosyası masaüstü sürümüyle karşılaştırıldı; daha önceki
yalnız boşluk/taşınabilir test yolu düzenlemeleri dışında yeni uygulama
farkı bulunmadı. Ortam örneği ve OCR fixture yolu repo için taşınabilir kalır.

`TASARIM/atolye-video-raf-plani.html` ayrı açılan tasarım referansı olarak
eklendi. Plan yaklaşık konumlar içerir; video, kareleri ve ürün eşleştirmeleri
depoya eklenmedi. Uygulama entegrasyonu yapılmadı. Kullanıcının sonraki açık
isteğiyle bu eşitleme yerel `main` commit'ine hazırlanmıştır. Uzak GitHub
bağlantısındaki hesap doğrulaması tamamlanamadığından gönderim ayrıca
doğrulanmalıdır; yerel commit tek başına başarılı push anlamına gelmez.

## Doğrulananlar

- Kilit dosyasından `npm ci` ile bağımlılıklar kurulmuştur.
- Tam otomatik test paketi: 324 başarılı, 0 başarısız, 0 atlanan.
- Stok kapsamı ve white-label kaynak kontrolleri başarılıdır.
- Gizli yerel ayarlar, oturum/veritabanı, belgeler/görseller, yedekler ve
  eski ekran görüntüleri commit dışındadır; yerel kopyaları silinmemiştir.
- Sentetik OCR test resmi test fixtures dizinine alınmıştır; testler özel
  DENETIM klasörüne bağımlı değildir.
- Örnek ortam dosyasında kullanıcıya özel mutlak yollar ve gerçek şifre
  yoktur. Başlatıcı yolları ilgili checkout içinde oluşturur.

Staged dosyalar için ek kontrol: `node LOCAL/check-git-safety.cjs`.

## Açık güvenlik uyarıları

`npm audit --omit=dev` 12.10.2026 tarihinde **8 paket uyarısı** bildirmiştir:
1 kritik, 2 yüksek, 5 orta. Bu durum testlerin geçmesinden bağımsızdır.

- Kritik: `proxy-addr`.
- Yüksek: `nodemailer`, `sharp`.
- Orta: `exceljs`, `express`, `morgan`, `qs`, `uuid`.

Sürüm yükseltmeleri veya ExcelJS geri alma önerisi otomatik uygulanmamıştır;
uyumluluk riski vardır. Özellikle major/0.x minor değişimleri, Excel aktarımı,
görsel işleme, SMTP ve proxy/kimlik doğrulama akışları ayrı test edilmelidir.
`npm audit fix --force` gelişigüzel çalıştırılmamalıdır.

Bu commit kaynakların sürüm kontrolüne alınması içindir; internet erişimine
açık üretim yayınına güvenlik onayı anlamına gelmez. Üretim yayını öncesinde
bu uyarılar değerlendirilip giderilmeli, ardından testler yeniden koşulmalıdır.
