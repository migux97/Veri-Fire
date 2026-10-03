import type { APIRoute } from 'astro';
import { findBrandBySlug, logoBytes } from '@/lib/server/brands';

// The logo a company published, at an address that does not change: buyers see it on each warranty. It is public on
// purpose. What it serves is only the PNG the company chose.
export const GET: APIRoute = ({ params }) => {
  const brand = params.slug ? findBrandBySlug(params.slug) : undefined;
  const bytes = brand ? logoBytes(brand) : null;
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      // The address carries the version of the logo (?v=), so a changed logo is fetched again and an unchanged one is not.
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      // Whatever the bytes are, the browser must treat them as the image they were declared to be.
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
