'use strict';
const { app, Menu, shell, dialog } = require('electron');

const SITE_URL = 'https://tv-pro.app';
const isMac = process.platform === 'darwin';

/** @param {{ getWindow: () => import('electron').BrowserWindow|null, onClearData: () => Promise<void>, isDev: boolean }} opts */
function buildMenu(opts) {
  const send = (channel) => { const w = opts.getWindow(); if (w) w.webContents.send(channel); };

  const appMenu = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'مسح بيانات الاشتراك المحفوظة محليًا…',
        click: async () => {
          const w = opts.getWindow();
          const { response } = await dialog.showMessageBox(w, {
            type: 'warning',
            buttons: ['إلغاء', 'مسح كل شيء'],
            defaultId: 0,
            cancelId: 0,
            title: 'مسح البيانات المحلية',
            message: 'سيتم حذف كل اشتراكات IPTV المحفوظة (Xtream وM3U)، القنوات المفضلة، وسجل المشاهدة المخزَّن على هذا الجهاز فقط. لا يمكن التراجع عن هذا.',
          });
          if (response === 1) await opts.onClearData();
        },
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const editMenu = {
    label: 'تحرير',
    submenu: [
      { role: 'undo', label: 'تراجع' },
      { role: 'redo', label: 'إعادة' },
      { type: 'separator' },
      { role: 'cut', label: 'قص' },
      { role: 'copy', label: 'نسخ' },
      { role: 'paste', label: 'لصق' },
      { role: 'selectAll', label: 'تحديد الكل' },
    ],
  };

  const viewMenu = {
    label: 'عرض',
    submenu: [
      { role: 'reload', label: 'إعادة التحميل' },
      ...(opts.isDev ? [{ role: 'toggleDevTools', label: 'أدوات المطوّر' }] : []),
      { type: 'separator' },
      { role: 'resetZoom', label: 'الحجم الطبيعي' },
      { role: 'zoomIn', label: 'تكبير' },
      { role: 'zoomOut', label: 'تصغير' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'ملء الشاشة' },
    ],
  };

  const windowMenu = {
    label: 'نافذة',
    submenu: [
      { role: 'minimize', label: 'تصغير' },
      { role: 'zoom', label: 'تكبير' },
      ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'إحضار الكل للمقدمة' }] : [{ role: 'close', label: 'إغلاق' }]),
    ],
  };

  const helpMenu = {
    role: 'help',
    label: 'مساعدة',
    submenu: [
      { label: 'زيارة tv-pro.app', click: () => shell.openExternal(SITE_URL) },
      { label: 'فتح صفحة تشخيص الاتصال', click: () => send('menu:open-diagnostics') },
    ],
  };

  const template = isMac ? [appMenu, editMenu, viewMenu, windowMenu, helpMenu] : [editMenu, viewMenu, windowMenu, helpMenu];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu, SITE_URL };
