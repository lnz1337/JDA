import { useEffect, useState } from 'react';
import { APP_NAME, JOURNEY_TOTAL_DAYS } from '../shared/constants';
import type { HealthResponse } from '../shared/types';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

/**
 * Tela provisória da fase 1: confirma que o Worker, os bindings e o build do
 * PWA estão de pé. As telas reais entram a partir da fase 5 (CLAUDE.md §16).
 */
export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch('/api/health', { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        setHealth({ kind: 'ok', data: (await res.json()) as HealthResponse });
      } catch (err) {
        if (controller.signal.aborted) return;
        setHealth({
          kind: 'error',
          message: err instanceof Error ? err.message : 'falha desconhecida',
        });
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ouro-500">
          Jornada de {JOURNEY_TOTAL_DAYS} dias
        </p>
        <h1 className="text-3xl font-semibold text-noite-900">{APP_NAME}</h1>
        <p className="text-sm text-noite-700">
          Scaffold da fase 1: Worker + Hono + Vite + React + Tailwind.
        </p>
      </header>

      <section className="rounded-2xl border border-noite-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-noite-900">API</h2>
        {health.kind === 'loading' && (
          <p className="mt-2 text-sm text-noite-300">consultando /api/health…</p>
        )}
        {health.kind === 'error' && (
          <p className="mt-2 text-sm text-red-700">/api/health falhou: {health.message}</p>
        )}
        {health.kind === 'ok' && (
          <dl className="mt-3 space-y-1 text-sm text-noite-700">
            <Row label="status" value="ok" />
            <Row label="ambiente" value={health.data.env} />
            <Row label="D1 (DB)" value={health.data.bindings.db ? 'conectado' : 'ausente'} />
            <Row label="R2 (MEDIA)" value={health.data.bindings.media ? 'conectado' : 'ausente'} />
          </dl>
        )}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-noite-300">{label}</dt>
      <dd className="font-medium text-noite-900">{value}</dd>
    </div>
  );
}
