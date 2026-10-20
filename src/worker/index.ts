import { Hono } from 'hono';
import type { ApiErrorResponse } from '../shared/types';
import type { AppBindings } from './lib/types';
import { health } from './routes/health';

const app = new Hono<AppBindings>();

app.route('/api/health', health);

app.notFound((c) => {
  const body: ApiErrorResponse = { error: 'not_found' };
  return c.json(body, 404);
});

app.onError((err, c) => {
  console.error('[worker]', err);
  const body: ApiErrorResponse = { error: 'internal_error' };
  return c.json(body, 500);
});

export default app;
