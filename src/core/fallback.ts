// Default reply when no fixture matches, so the mock never fails for lack of
// configuration. Echoing the input keeps responses deterministic and lets
// tests assert that their exact prompt reached the server.
export function echoFallback(text: string | undefined): string {
  return text ? `Echo: ${text}` : "Hello from llm-mock!";
}
