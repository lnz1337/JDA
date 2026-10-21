/** sha256 em hex, usado no dedupe_key dos postbacks (CLAUDE.md §7). */
export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Comparação de segredo em tempo constante: comparar com === vazaria, pelo tempo
 * de resposta, quantos caracteres iniciais do segredo o chamador acertou.
 */
export function igualdadeSegura(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // O XOR do tamanho entra no acumulador para não sair cedo em tamanhos diferentes.
  let diferenca = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i += 1) {
    diferenca |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diferenca === 0;
}
