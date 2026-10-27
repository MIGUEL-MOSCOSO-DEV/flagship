export class FlagshipClient {
  #token;
  #cache = new Map();
  constructor({ baseUrl, apiKey, ttl = 30000, fallback = false, fetcher = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.#token = apiKey;
    this.ttl = ttl;
    this.fallback = fallback;
    this.fetcher = fetcher;
  }
  async variation(flagKey, subject) {
    const cacheKey = JSON.stringify([flagKey, subject]);
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
      const response = await this.fetcher(
        this.baseUrl + '/api/evaluate/' + encodeURIComponent(flagKey),
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + this.#token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: subject }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) return this.fallback;
      const result = await response.json();
      if (typeof result.value !== 'boolean') return this.fallback;
      if (this.#cache.size >= 1000) this.#cache.clear();
      this.#cache.set(cacheKey, { value: result.value, expires: Date.now() + this.ttl });
      return result.value;
    } catch {
      return this.fallback;
    }
  }
  clearCache() {
    this.#cache.clear();
  }
}
