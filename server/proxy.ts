export async function installFetchProxy(proxyUrl: string | undefined) {
  if (!proxyUrl) return;

  const { ProxyAgent, fetch, setGlobalDispatcher } = await import("undici");
  const dispatcher = new ProxyAgent(proxyUrl);

  setGlobalDispatcher(dispatcher);
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
}
