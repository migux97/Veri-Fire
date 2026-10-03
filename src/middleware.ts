import { defineMiddleware, sequence } from 'astro:middleware';
import { CORS_ORIGIN } from 'astro:env/server';
import { LOCALE_COOKIE, toLocale } from './lib/locale';

// Printed QR labels still point at the old .html pages. The `redirects` option of the
// Astro config would drop the query string, which carries the product token, so they are redirected here.
const LEGACY_PATHS: Record<string, string> = {
  '/index.html': '/login',
  '/app.html': '/app',
  '/lotes.html': '/batches',
  '/lotes': '/batches',
  '/admin.html': '/admin',
  '/batch.html': '/batch',
  '/verify.html': '/verify',
  // Browsers ask for /favicon.ico on their own, even with a <link rel="icon">.
  '/favicon.ico': '/favicon.png'
};

const legacyPaths = defineMiddleware((context, next) => {
  const target = LEGACY_PATHS[context.url.pathname];
  return target ? context.redirect(`${target}${context.url.search}`, 301) : next();
});

// A year is long enough for a choice the visitor can change from the landing at any time.
const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

// Where the language is chosen: the English landing, the Spanish one, or an explicit ?lang=. The pages behind the
// login have a single route each, so they read the cookie this leaves.
const localeCookie = defineMiddleware((context, next) => {
  const { pathname, searchParams } = context.url;
  const asked = toLocale(searchParams.get('lang'));
  const fromRoute = pathname === '/en' || pathname.startsWith('/en/') ? 'en' : pathname === '/' ? 'es' : null;
  const locale = asked ?? fromRoute;
  if (locale && context.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    context.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: 'lax' });
  }
  return next();
});

// Only when CORS_ORIGIN is set: the frontend served by this same server needs no CORS.
const cors = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith('/api/')) return next();
  const allowOrigin: Record<string, string> = CORS_ORIGIN ? { 'Access-Control-Allow-Origin': CORS_ORIGIN } : {};
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...allowOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    });
  }
  const response = await next();
  if (CORS_ORIGIN) response.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
  return response;
});

export const onRequest = sequence(legacyPaths, localeCookie, cors);
