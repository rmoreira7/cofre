// One or two sentences on why a decision's suggestion makes sense, written by OpenAI from the facts the rules computed.
// The model never computes: every number in its reply must appear literally in the facts, or the reply is dropped and
// the message goes out without it. Any failure (no key, HTTP error, timeout, budget) returns null and never blocks.

export const MODEL = "gpt-5-mini";
export const MAX_CHARS = 320;

const INSTRUCTIONS = `Você explica, em português do Brasil, uma decisão financeira pessoal que já foi calculada por regras.
Escreva no máximo 2 frases curtas (até 280 caracteres), em tom direto, sem saudação.
Explique por que a sugestão faz sentido (quais faixas da escada estão abaixo ou acima do alvo) e, se houver,
quanto custa cada dia útil sem aplicar o dinheiro.
Regras: use SOMENTE números que aparecem nos fatos, copiados exatamente como estão escritos (mesmo formato).
Não faça contas, não arredonde, não invente taxas, emissores ou produtos. Se regra_brb_nao_renovar for true, diga que
o valor não volta para o BRB.`;

const NUM = /\d+(?:[.,/]\d+)*/g;
const tokens = (s) => new Set(String(s).match(NUM) || []);

// Every numeric token in the text must be one of the facts' numeric tokens, verbatim.
export function guard(text, facts) {
  const allowed = tokens(JSON.stringify(facts));
  const bad = [...tokens(text)].filter((t) => !allowed.has(t));
  return { ok: bad.length === 0, bad };
}

export function outputText(res) {
  if (res?.status && res.status !== "completed") return null;
  return (res?.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text").map((c) => c.text).join("").trim() || null;
}

export async function explain(facts, { apiKey, model = MODEL, reasoning = "low", fetch = globalThis.fetch, timeoutMs = 30000 } = {}) {
  if (!apiKey || !facts) return { text: null, reason: "skipped" };
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: INSTRUCTIONS,
        input: `Fatos:\n${JSON.stringify(facts, null, 2)}`,
        store: false,
        max_output_tokens: 1200,
        ...(reasoning && { reasoning: { effort: reasoning } }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { text: null, reason: `http ${res.status}` };
    const body = await res.json();
    const text = outputText(body);
    if (!text) return { text: null, reason: `empty (${body.status || "?"})` };
    if (text.length > MAX_CHARS) return { text: null, reason: "too long" };
    const g = guard(text, facts);
    if (!g.ok) return { text: null, reason: `unknown numbers: ${g.bad.length}` };
    return { text, reason: "ok", usage: body.usage };
  } catch (e) {
    return { text: null, reason: e.name === "TimeoutError" ? "timeout" : "error" };
  }
}
