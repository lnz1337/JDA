import { ulid } from 'ulid';

/** IDs do banco são ULID (CLAUDE.md §5): ordenáveis por tempo e sem colisão prática. */
export function novoId(): string {
  return ulid();
}
