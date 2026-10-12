# FocusLine

Görevlerini takvimle planladığın, odak süreni ölçtüğün, fikirlerini arkadaşlarınla paylaştığın ve spor kayıtlarını tuttuğun bir Windows masaüstü uygulaması.

## Özellikler

- **Görevler**: Gün gün görev listesi, haftalık şerit ve aylık takvim; başlangıç/bitiş saatleri, "şu an" vurgusu.
- **Odak**: Pomodoro (odak / kısa mola / uzun mola) ve serbest çalışma zamanlayıcısı; duraklat-devam et aynı oturumda birikir. Günlük hedef, haftalık grafik ve çalışma geçmişi.
- **Fikirler**
  - *Kişisel*: Sadece bu bilgisayarda saklanan fikirler.
  - *Ortak*: E-posta + şifre ile giriş, e-postayla davet edilen arkadaşlarla gerçek zamanlı ortak alanlar. Fikri sadece yazan düzenler; herkes not ekleyebilir; fikri yazan ya da alan sahibi silebilir. "Alandakiler" listesinde çevrimiçi durumu ve günlük odak süreleri görünür.
- **Spor**: Antrenman kaydı, haftalık dakika grafiği ve geçmiş.
- Açık / karanlık tema, sistem tepsisinde arka planda çalışma, tek pencere.

## Proje yapısı

```
src/
  main.js              Electron ana süreç: pencere, tepsi simgesi, dosyaya kayıt, tema
  preload.js           Ana süreç ile arayüz arasındaki güvenli köprü
  renderer/
    index.html         Arayüz iskeleti
    styles.css         Tasarım (açık ve karanlık tema)
    renderer.js        Uygulama mantığı (görevler, odak, fikirler, spor)
  shared/
    shared.js          Ortak alanlar: Firebase giriş + Firestore senkronizasyonu
    firebase-config.js Firebase proje ayarları
assets/                Uygulama ikonu
firestore.rules        Firestore güvenlik kuralları (Firebase konsoluna yapıştırılır)
```

`src/shared/shared.js`, esbuild ile `src/renderer/shared.bundle.js` dosyasına paketlenir (bu dosya otomatik üretilir, depoda tutulmaz).

## Geliştirme

Gerekenler: [Node.js](https://nodejs.org) 20 veya üzeri.

```bash
npm install
npm start
```

## Kurulum dosyası üretme

```bash
npm run dist
```

Çıktılar `dist/` klasörüne yazılır:

- `FocusLine-Kurulum-<sürüm>.exe`: normal kurulum (önerilen)
- `FocusLine-Tasinabilir-<sürüm>.exe`: kurulumsuz çalışan sürüm

Yeni sürüm çıkarmadan önce `package.json` içindeki `version` artırılmalı.

> `build.appId` değiştirilmemeli: Windows, yeni kurulumun eskisinin yerini alacağını bu kimlikten anlar.

## Veriler nerede?

- Görevler, odak ve spor kayıtları ile kişisel fikirler bilgisayarda saklanır: `%APPDATA%\todo-uygulama\data.json`
- Ortak alanlar (ortak fikirler, notlar, üyeler, davetler) Firebase Firestore'da tutulur. Erişim kuralları `firestore.rules` dosyasındadır.

## Firebase kurulumu (kendi projen için)

1. [Firebase konsolunda](https://console.firebase.google.com) bir proje oluştur.
2. **Authentication → Sign-in method**: *Email/Password* sağlayıcısını aç.
3. **Firestore Database** oluştur, **Rules** sekmesine `firestore.rules` içeriğini yapıştırıp yayınla.
4. **Project settings → Your apps → Web** ile bir web uygulaması ekle ve verilen ayarları `src/shared/firebase-config.js` dosyasına yaz.

Firebase web ayarları gizli bilgi değildir; erişimi güvenlik kuralları belirler.

## Lisans

MIT
