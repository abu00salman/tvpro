'use strict';
// Serves the packaged TV Pro web app from a privileged, secure custom scheme (app://tvpro/...) instead of file://.
// This gives the renderer a proper origin (fetch(), relative paths, and CSP all behave like a normal https:// site)
// without ever touching Node integration in the renderer, and without needing a local HTTP server bound to any
// port. Call registerAppScheme() before app.whenReady(), and registerAppProtocolHandler(siteRoot) after.
const { protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const HOST = 'tvpro';

function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        allowServiceWorkers: false, // the packaged shell is already local; a PWA service worker would add risk
      },                            // (stale-bundle caching, white-screen-on-update-bugs) with no benefit here.
    },
  ]);
}

function registerAppProtocolHandler(siteRoot) {
  const root = path.resolve(siteRoot);
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/') || rel === '') rel += 'index.html';
    const resolved = path.resolve(root, '.' + rel);
    // Path traversal guard: the resolved file must stay inside the packaged site directory.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(resolved).toString()).catch(() => new Response('not found', { status: 404 }));
  });
}

module.exports = { SCHEME, HOST, registerAppScheme, registerAppProtocolHandler, appUrl: (p = '/') => `${SCHEME}://${HOST}${p}` };
