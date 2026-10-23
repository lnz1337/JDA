import { Hono } from 'hono';
import type { ApiErrorResponse } from '../shared/types';
import type { AppBindings } from './lib/types';
import { admin } from './routes/admin';
import { acesso, auth, me } from './routes/auth';
import { campanha, parar } from './routes/campanha';
import { health } from './routes/health';
import { eventos, jornada, licoes } from './routes/jornada';
import { media } from './routes/media';
import { payt } from './routes/payt';
import { push } from './routes/push';

const app = new Hono<AppBindings>();

/*
 * As páginas que o Worker serve chegam por link de e-mail e não têm o que
 * indexar — `/acesso` nem existe sem um token. Buscador que as encontre só
 * produz resultado inútil, em qualquer ambiente. O `_headers` do build não
 * alcança resposta gerada por Worker, então o cabeçalho entra aqui.
 */
app.use('/acesso', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
});
app.use('/parar', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
});

app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/programas', jornada);
app.route('/api/licoes', licoes);
app.route('/api/eventos', eventos);
app.route('/media', media);
app.route('/api/push', push);
app.route('/api/admin', admin);
app.route('/api/campanha', campanha);
app.route('/parar', parar);
app.route('/acesso', acesso);
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
