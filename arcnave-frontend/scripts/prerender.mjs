import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const temporary = resolve('.prerender');
await mkdir(temporary, { recursive: true });
await build({ entryPoints: ['src/Landing.tsx'], outfile: resolve(temporary, 'site.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { default: Site } = await import(pathToFileURL(resolve(temporary, 'site.mjs')).href);
const template = await readFile('dist/index.html', 'utf8');
const pages = [
  ['/', 'ArcNave — Academic Campus AI', 'Academic Campus AI for colleges. Organise evidence, review documents, and prepare working drafts for NAAC, NBA, and AICTE preparation.'],
  ['/about', 'About ArcNave — Built in Coimbatore', 'ArcNave is a bootstrapped Academic Campus AI product in development in Coimbatore, Tamil Nadu, India. Product questions and early access: admin@arcnave.tech.'],
  ['/privacy', 'Privacy & data — ArcNave', 'Learn how ArcNave handles account information, workspace data, AI processing, and public sharing.'],
  ['/terms', 'Using ArcNave — Product guidance', 'Practical guidance for using the development-stage ArcNave workspace and reviewing AI outputs.'],
];
const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const [route, title, description] of pages) {
  const body = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(Site)));
  const url = `https://www.arcnave.tech${route}`;
  let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/, `<meta name="description" content="${escape(description)}" />`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    .replace('<html lang="en">', `<html lang="en" data-public-route="${route}">`)
    .replace('</head>', `<link rel="canonical" href="${url}" /><meta property="og:title" content="${escape(title)}" /><meta property="og:description" content="${escape(description)}" /><meta property="og:type" content="website" /><meta property="og:url" content="${url}" /></head>`);
  // SPA fallbacks may receive the homepage HTML for a private route. Avoid showing the wrong
  // public page while the workspace chunk loads; public HTML still works without JavaScript.
  html = html.replace('</body>', `<script>if((location.pathname.replace(/\\/+$/,'')||'/')!==document.documentElement.dataset.publicRoute)document.getElementById('root').replaceChildren()</script></body>`);
  const file = route === '/' ? 'dist/index.html' : `dist${route}/index.html`;
  if (route !== '/') await mkdir(`dist${route}`, { recursive: true });
  await writeFile(file, html);
}
await writeFile('dist/robots.txt', 'User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /login\nDisallow: /signup\nDisallow: /chat/\nDisallow: /project/\nDisallow: /projects\nDisallow: /chats\nDisallow: /artifacts\nDisallow: /s/\nSitemap: https://www.arcnave.tech/sitemap.xml\n');
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(([route]) => `<url><loc>https://www.arcnave.tech${route}</loc></url>`).join('')}</urlset>`);
await rm(temporary, { recursive: true, force: true });
console.log('Prerendered four public pages, sitemap and robots. No API requests were made.');
