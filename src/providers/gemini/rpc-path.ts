// Google's APIs address custom methods as `{resource}:{method}`, e.g.
// `models/gemini-3.6-flash:generateContent`. Express treats ":" as the start of
// a route parameter, so the whole segment is captured by a single `:target`
// parameter and split here instead of by the router.
export interface RpcTarget {
  // The resource id with the method suffix removed, e.g. "gemini-3.6-flash".
  resource: string;
  // Undefined for a plain resource read (`GET models/gemini-3.6-flash`).
  method?: string;
}

export function parseRpcTarget(segment: string): RpcTarget {
  // Resource ids never contain ":", so the last one always opens the method.
  const separator = segment.lastIndexOf(":");
  if (separator === -1) return { resource: segment };
  return { resource: segment.slice(0, separator), method: segment.slice(separator + 1) };
}
