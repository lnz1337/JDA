/**
 * O que este aparelho é e o que ele já respondeu (CLAUDE.md §11).
 *
 * Tudo aqui é **do aparelho**, não da conta: instalar e permitir notificação são
 * decisões de cada celular, e a mesma pessoa pode ter dois. Por isso vive em
 * `localStorage`, sempre com `try/catch` — em aba privada ou com armazenamento
 * bloqueado a leitura falha, e o app tem que seguir funcionando.
 *
 * Horário e fuso são o contrário: ficam na conta, para quem troca de celular não
 * perder o que escolheu.
 */

export function lerLocal(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function gravarLocal(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: a tela só volta a perguntar depois */
  }
}

/** Aberto pelo ícone da tela inicial, não por uma aba do navegador. */
export function ehStandalone(): boolean {
  if (matchMedia('(display-mode: standalone)').matches) return true;
  // iOS antigo não implementa display-mode: standalone.
  return (navigator as { standalone?: boolean }).standalone === true;
}

export function ehIOS(): boolean {
  const ua = navigator.userAgent;
  // iPad moderno se apresenta como Mac; o toque é o que o distingue.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function ehCelular(): boolean {
  return ehIOS() || /Android/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

/**
 * Dá para pedir notificação neste aparelho?
 *
 * No iPhone, `PushManager` só existe no app aberto pela tela inicial, e só a
 * partir do iOS 16.4 — por isso a checagem é por capacidade, não por versão.
 */
export function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function permissaoDeNotificacao(): NotificationPermission | 'indisponivel' {
  if (!('Notification' in window)) return 'indisponivel';
  return Notification.permission;
}

/**
 * O service worker deste aparelho, pronto para receber push.
 *
 * **Lança** em vez de devolver nulo: é um dos passos que podem falhar sozinhos
 * no iPhone, e engolir o erro aqui foi o que deixou a falha sem causa conhecida.
 */
export async function registroPronto(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

/** A assinatura deste aparelho, se já existir. Também lança, pelo mesmo motivo. */
export async function assinaturaDoRegistro(
  registro: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  return registro.pushManager.getSubscription();
}

/**
 * A assinatura de push deste aparelho, se existir — versão que nunca lança.
 *
 * É para quem só quer **saber** se este aparelho está assinado, como o card da
 * Home: ali um erro não tem o que informar, e a resposta útil é "não tem".
 */
export async function assinaturaAtual(): Promise<PushSubscription | null> {
  if (!suportaPush()) return null;
  try {
    return await assinaturaDoRegistro(await registroPronto());
  } catch {
    return null;
  }
}

/** `BASE64URL` → `Uint8Array`, que é o que `subscribe` aceita como chave. */
function chaveParaBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const cru = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(cru, (c) => c.charCodeAt(0));
}

export interface AssinaturaParaEnviar {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function bytesParaB64url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function assinaturaParaEnviar(assinatura: PushSubscription): AssinaturaParaEnviar {
  return {
    endpoint: assinatura.endpoint,
    p256dh: bytesParaB64url(assinatura.getKey('p256dh')),
    auth: bytesParaB64url(assinatura.getKey('auth')),
  };
}

/**
 * Assina o push deste aparelho. `userVisibleOnly` é obrigatório no Chrome: push
 * silencioso não é permitido, e a promessa é a de que todo envio vira
 * notificação na tela.
 *
 * Recebe o registro já pronto em vez de esperar por ele aqui: no Safari do
 * iPhone o `subscribe` precisa sair **dentro** do toque, e cada `await` a mais
 * antes dele é uma chance de perder o gesto.
 */
export async function assinarPush(
  registro: ServiceWorkerRegistration,
  chavePublica: string,
): Promise<PushSubscription> {
  return registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: chaveParaBytes(chavePublica) as BufferSource,
  });
}
