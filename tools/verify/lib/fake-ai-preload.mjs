// SAMO ZA PROBE: učitava se u `next start` preko NODE_OPTIONS=--import=... i preusmerava pozive ka Claude i Voyage
// API-ju na lažni server (FAKE_AI_URL), da proba vidi TAČNO telo zahteva (npr. da slika nema EXIF) i da uspešan tok
// može da se prođe bez pravih ključeva. Bez FAKE_AI_URL ne radi ništa. Učitava se pre Next-a, pa Next obmotava
// ovu funkciju svojom.
const target = process.env.FAKE_AI_URL;
const HOSTS = ['api.anthropic.com', 'api.voyageai.com'];

if (target) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.protocol === 'https:' && HOSTS.includes(url.host)) {
      return original(`${target}/${url.host}${url.pathname}`, init);
    }
    return original(input, init);
  };
}
