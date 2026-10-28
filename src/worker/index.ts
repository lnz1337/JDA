import { Hono } from 'hono';
import { enviarLembretes } from './cron';
import type { ApiErrorResponse } from '../shared/types';
import type { AppBindings } from './lib/types';
import { admin } from './routes/admin';
import { acesso, auth, me } from './routes/auth';
import { campanha, parar } from './routes/campanha';
import { health } from './routes/health';
import { eventos, jornada, licoes } from './routes/jornada';
import { loja } from './routes/loja';
import { oferta } from './routes/oferta';
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
app.route('/api/loja', loja);
app.route('/api/oferta', oferta);
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

/**
 * O Worker exporta `fetch` e `scheduled`: o cron do lembrete é do mesmo Worker,
 * com os mesmos bindings (§11).
 *
 * O `scheduled` é pendurado na própria instância do Hono (que já tem `fetch`),
 * em vez de um objeto novo: assim `app.request()` continua valendo nos testes.
 */
const worker = app as typeof app & {
  scheduled: (evento: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>;
};

worker.scheduled = async (_evento, env, ctx) => {
  ctx.waitUntil(
    enviarLembretes(env as AppBindings['Bindings'])
      .then((r) => {
        // Sai no log do Worker: é por ele que se vê o lembrete andando.
        console.log('[cron][lembrete]', JSON.stringify(r));
      })
      .catch((erro) => {
        console.error('[cron][lembrete] falhou', erro);
      }),
  );
};

export default worker;
