import { useEffect } from 'react';

function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(data) {
  document.querySelectorAll('script[id^="seo-jsonld"]').forEach((el) => el.remove());
  if (!data) return;
  const items = Array.isArray(data) ? data : [data];
  items.forEach((item, i) => {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = `seo-jsonld-${i}`;
    el.text = JSON.stringify(item);
    document.head.appendChild(el);
  });
}

export function useSeo({ title, description, image, jsonLd } = {}) {
  useEffect(() => {
    const base = window.location.origin + window.location.pathname;
    setLink('canonical', base);
    setMeta('property', 'og:url', base);
    setMeta('property', 'og:image', window.location.origin + (image || '/og-image.svg'));
    setMeta('name', 'twitter:card', 'summary_large_image');
    if (title) {
      document.title = title;
      setMeta('property', 'og:title', title);
      setMeta('name', 'twitter:title', title);
    }
    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
      setMeta('name', 'twitter:description', description);
    }
    setJsonLd(jsonLd);
  }, [title, description, image, jsonLd]);
}
