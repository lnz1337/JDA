/**
 * Que passos da lição a pessoa já fez **neste aparelho** (docs/estilo-visual.md,
 * Home "Hoje"): o 1 quando o áudio passou de 90%, o 2 quando ela passou pela
 * prática. O 3 é do servidor (lição concluída), não daqui.
 *
 * É conveniência, como a posição do áudio: `lerLocal`/`gravarLocal` já fazem o
 * `try/catch`, e sem armazenamento a lista do dia só não marca os passos.
 */
import { gravarLocal, lerLocal } from './dispositivo';

function chave(lessonId: string): string {
  return `passos:${lessonId}`;
}

export function passosFeitos(lessonId: string): Set<number> {
  try {
    const lista: unknown = JSON.parse(lerLocal(chave(lessonId)) ?? '[]');
    return new Set(Array.isArray(lista) ? lista.filter((n) => n === 1 || n === 2) : []);
  } catch {
    return new Set();
  }
}

export function marcarPasso(lessonId: string, passo: 1 | 2): void {
  const feitos = passosFeitos(lessonId);
  if (feitos.has(passo)) return;
  feitos.add(passo);
  gravarLocal(chave(lessonId), JSON.stringify([...feitos].sort()));
}
