import { Hono } from 'hono';
import type { ApiErrorResponse } from '../shared/types';
import type { AppBindings } from './lib/types';
import { auth, me } from './routes/auth';
import { campanha, parar } from './routes/campanha';
import { health } from './routes/health';
import { payt } from './routes/payt';

const app = new Hono<AppBindings>();

app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/campanha', campanha);
app.route('/parar', parar);
app.route('/api/health', health);
app.route('/api/payt', payt);

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
