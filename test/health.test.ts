import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/shared/constants';
import type { HealthResponse } from '../src/shared/types';
import app from '../src/worker/index';

describe('GET /api/health', () => {
  it('responde 200 com ambiente e bindings', async () => {
    const res = await app.request('/api/health', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.app).toBe(APP_NAME);
    expect(body.env).toBe('development');
    expect(body.bindings).toEqual({ db: true, media: true });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});

describe('rota inexistente', () => {
  it('devolve 404 em JSON', async () => {
    const res = await app.request('/api/rota-que-nao-existe', {}, env);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
