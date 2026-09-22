# إصلاح TV Pro

المشكلة الأساسية ليست في شكل الصفحة، بل في طريقة وصول المتصفح للمصادر:

1. الموقع يعمل عبر HTTPS بينما كثير من اشتراكات IPTV تعطي روابط HTTP. طلبات fetch/XHR من صفحة HTTPS إلى HTTP تُحجب كـ Mixed Content.
2. قوائم M3U/HLS قد تأتي من نطاق مختلف بلا CORS. لذلك يجب تمرير القائمة وملفات HLS التابعة لها عبر HTTPS Gateway، وليس ملف m3u8 الرئيسي فقط.
3. Safari وChrome على iPhone لا يستطيعان تشغيل كل حاويات/ترميزات VOD. MKV/AVI وبعض الترميزات تحتاج نسخة MP4/H.264/AAC أو HLS متوافق، أو Transcoding حقيقي على الخادم. الـ Worker لا يقوم بتحويل الفيديو.

## التثبيت
- انشر `cloudflare-worker.js` كـ Cloudflare Worker.
- افتح رابط الـ Worker وتأكد أن الصفحة تعرض: `TV Pro Stream Gateway OK`.
- في TV Pro: الإعدادات > التشغيل > HTTPS proxy، ضع رابط الـ Worker فقط، مثال: `https://tvpro-gateway.<account>.workers.dev`.
- أعد إضافة القائمة/السيرفر بعد حفظ الإعداد.

## ملاحظة مهمة للأفلام والمسلسلات
إذا بقي فيلم بعينه لا يعمل بينما القنوات تعمل، افحص امتداد/Codec المصدر. الـ Worker يصلح HTTPS/CORS/HLS، لكنه لا يحول MKV/AVI أو Codec غير مدعوم إلى صيغة يدعمها iPhone. للحل الشامل يلزم Transcoding/Remux server-side (مثل FFmpeg على VPS)، وليس Cloudflare Worker.
