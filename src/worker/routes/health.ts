import { Hono } from 'hono';
import { APP_NAME } from '../../shared/constants';
import type { HealthResponse } from '../../shared/types';
import type { AppBindings } from '../lib/types';

export const health = new Hono<AppBindings>().get('/', (c) => {
  const body: HealthResponse = {
    ok: true,
    app: APP_NAME,
    env: c.env.ENV,
    time: new Date().toISOString(),
    bindings: {
      db: Boolean(c.env.DB),
      media: Boolean(c.env.MEDIA),
    },
  };

  return c.json(body);
});
