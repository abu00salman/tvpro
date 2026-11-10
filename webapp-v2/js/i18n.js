/*
 * TV Pro v2 — minimal i18n/RTL scaffold.
 * Mirrors the existing app's two locales (ar default/RTL, en/LTR) and persists the
 * choice the same way the shipped app does: via html[lang]/html[dir], read back on load.
 */
(function (global) {
  'use strict';

  const STRINGS = {
    ar: {
      'nav.home': 'الرئيسية', 'nav.movies': 'أفلام', 'nav.series': 'مسلسلات', 'nav.anime': 'أنمي',
      'nav.live': 'البث المباشر', 'nav.search': 'بحث', 'nav.favorites': 'المفضلة', 'nav.recent': 'شوهد مؤخرًا',
      'nav.settings': 'الإعدادات',
      'home.featured': 'مميز', 'home.play': 'تشغيل', 'home.more_info': 'التفاصيل',
      'home.continue': 'متابعة المشاهدة', 'home.recent_added': 'أُضيف حديثًا', 'home.live_now': 'مباشر الآن', 'home.top_rated': 'الأعلى تقييمًا',
      'search.placeholder': 'ابحث عن فيلم أو مسلسل أو قناة…', 'search.tab.all': 'الكل', 'search.tab.movie': 'أفلام',
      'search.tab.series': 'مسلسلات', 'search.tab.anime': 'أنمي', 'search.tab.live': 'قنوات',
      'search.empty': 'لا توجد نتائج', 'search.loading': 'جارٍ البحث…', 'search.error': 'تعذّر البحث، حاول مجددًا',
      'filter.genre': 'التصنيف', 'filter.year': 'السنة', 'filter.sort': 'الترتيب', 'filter.platform': 'المصدر',
      'filter.sort.newest': 'الأحدث', 'filter.sort.az': 'أبجديًا', 'filter.all': 'الكل',
      'demo.badge': 'بيانات تجريبية — لا يوجد اشتراك محفوظ على هذا الجهاز',
      'player.quality': 'الجودة', 'player.subtitle': 'الترجمة', 'player.audio': 'الصوت', 'player.sleep': 'مؤقت النوم',
      'player.auto': 'تلقائي', 'player.off': 'إيقاف',
      'title.favorite': 'أضف إلى المفضلة', 'title.unfavorite': 'إزالة من المفضلة', 'title.favorited': 'في المفضلة',
      'title.play': 'تشغيل', 'title.seasons': 'المواسم', 'title.season': 'الموسم', 'title.episode': 'الحلقة',
      'title.synopsis_missing': 'لا يوجد وصف متاح لهذا العنوان.', 'title.loading': 'جارٍ التحميل…',
      'title.not_found': 'تعذّر العثور على هذا العنوان.', 'title.demo_note': 'عنصر تجريبي — لا يمكن حفظ المفضلة فعليًا بدون اشتراك محفوظ.',
      'title.back': 'رجوع',
    },
    en: {
      'nav.home': 'Home', 'nav.movies': 'Movies', 'nav.series': 'Series', 'nav.anime': 'Anime',
      'nav.live': 'Live TV', 'nav.search': 'Search', 'nav.favorites': 'Favorites', 'nav.recent': 'Recently watched',
      'nav.settings': 'Settings',
      'home.featured': 'Featured', 'home.play': 'Play', 'home.more_info': 'More info',
      'home.continue': 'Continue watching', 'home.recent_added': 'Recently added', 'home.live_now': 'Live now', 'home.top_rated': 'Top rated',
      'search.placeholder': 'Search movies, series, channels…', 'search.tab.all': 'All', 'search.tab.movie': 'Movies',
      'search.tab.series': 'Series', 'search.tab.anime': 'Anime', 'search.tab.live': 'Live TV',
      'search.empty': 'No results', 'search.loading': 'Searching…', 'search.error': 'Search failed, try again',
      'filter.genre': 'Genre', 'filter.year': 'Year', 'filter.sort': 'Sort', 'filter.platform': 'Source',
      'filter.sort.newest': 'Newest', 'filter.sort.az': 'A–Z', 'filter.all': 'All',
      'demo.badge': 'Demo data — no subscription saved on this device',
      'player.quality': 'Quality', 'player.subtitle': 'Subtitles', 'player.audio': 'Audio', 'player.sleep': 'Sleep timer',
      'player.auto': 'Auto', 'player.off': 'Off',
      'title.favorite': 'Add to favorites', 'title.unfavorite': 'Remove from favorites', 'title.favorited': 'In favorites',
      'title.play': 'Play', 'title.seasons': 'Seasons', 'title.season': 'Season', 'title.episode': 'Episode',
      'title.synopsis_missing': 'No synopsis available for this title.', 'title.loading': 'Loading…',
      'title.not_found': 'This title could not be found.', 'title.demo_note': 'Demo item — favoriting is not persisted without a saved subscription.',
      'title.back': 'Back',
    },
  };

  function currentLocale() {
    const saved = localStorage.getItem('tvpro-v2:locale');
    if (saved && STRINGS[saved]) return saved;
    return (document.documentElement.lang || 'ar').toLowerCase().indexOf('en') === 0 ? 'en' : 'ar';
  }

  function setLocale(locale) {
    if (!STRINGS[locale]) return;
    try { localStorage.setItem('tvpro-v2:locale', locale); } catch (_e) {}
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    applyTranslations();
    document.dispatchEvent(new CustomEvent('tvpro:locale', { detail: { locale } }));
  }

  function t(key) {
    const loc = currentLocale();
    return (STRINGS[loc] && STRINGS[loc][key]) || (STRINGS.en[key]) || key;
  }

  function applyTranslations(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    (root || document).querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const loc = currentLocale();
    document.documentElement.lang = loc;
    document.documentElement.dir = loc === 'ar' ? 'rtl' : 'ltr';
    applyTranslations();
  });

  global.TvproI18n = { t, setLocale, currentLocale, applyTranslations };
})(window);
