// O middleware ligado à regra do login da fábrica (#901): o papel vem do app_metadata do token.
// Mock só na fronteira: o cliente do Supabase (getClaims).
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { SESSAO_ENCERRADA } from '@/lib/sessao-encerrada'

let claims: Record<string, unknown> | null = null
mock.module('@supabase/ssr', { namedExports: {
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null }) } }),
} })

const fabrica = (extra: Record<string, unknown> = {}) => ({ sub: 'u1', app_metadata: { papel: 'fabrica' }, ...extra })
const pedir = async (metodo: string, caminho: string, headers: Record<string, string> = {}) => {
  const { middleware } = await import('./middleware')
  return middleware(new NextRequest(`http://localhost:3000${caminho}`, { method: metodo, headers }))
}
/** Cabeçalhos que o middleware manda ao app (a resposta do Supabase já repassa os do pedido). Lê o
 * `x-middleware-override-headers`, cabeçalho interno do Next que NextResponse.next({ request }) grava. */
const cabecalhosAoApp = (r: Response) => (r.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)
const destino = (r: Response) => (r.headers.get('location') ? new URL(r.headers.get('location')!).pathname : null)
/** Seguiu para a página: 200 e sem redirecionar (um 403 também não tem location). */
const seguiu = (r: Response) => r.status === 200 && destino(r) === null

test('login da fábrica: lê o painel; outro endereço volta ao painel; POST fora do sair é recusado', async () => {
  claims = fabrica()
  assert.ok(seguiu(await pedir('GET', '/fabrica')))
  assert.equal(destino(await pedir('GET', '/dashboard')), '/fabrica')
  assert.equal((await pedir('POST', '/fabrica')).status, 403)
  assert.ok(seguiu(await pedir('POST', '/sair')))
})

test('login da fábrica com senha provisória: /trocar-senha volta ao painel, e o painel abre', async () => {
  claims = fabrica({ user_metadata: { must_change_password: true } })
  assert.equal(destino(await pedir('GET', '/trocar-senha')), '/fabrica')
  assert.ok(seguiu(await pedir('GET', '/fabrica')))
})

test('outro papel com senha provisória ainda consegue sair por POST', async () => {
  claims = { sub: 'u2', app_metadata: {}, user_metadata: { must_change_password: true } }
  assert.equal(destino(await pedir('GET', '/dashboard')), '/trocar-senha')
  assert.ok(seguiu(await pedir('POST', '/sair')))
})

test('sem o papel de fábrica no token, o middleware não prende em /fabrica', async () => {
  claims = { sub: 'u3', app_metadata: {} }
  assert.ok(seguiu(await pedir('GET', '/dashboard')))
  assert.ok(seguiu(await pedir('POST', '/dashboard')))
})

// No redirect de uma Server Action (o login), o Next busca a página num GET interno com os cabeçalhos
// do POST, inclusive o content-type do formulário. Sem tirar, o servidor tomava a leitura por action
// e mandava de volta ao painel, sem fim (Etapa 6 do #901).
test('leitura do login da fábrica chega ao app sem content-type de formulário; o POST de sair mantém', async () => {
  claims = fabrica()
  const leitura = await pedir('GET', '/fabrica', { 'content-type': 'multipart/form-data; boundary=x', rsc: '1' })
  assert.ok(seguiu(leitura))
  const repassados = cabecalhosAoApp(leitura)
  assert.ok(repassados.includes('rsc'), 'os outros cabeçalhos seguem')
  assert.ok(!repassados.includes('content-type'))
  const sair = await pedir('POST', '/sair', { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000' })
  assert.ok(seguiu(sair))
  assert.ok(cabecalhosAoApp(sair).includes('content-type'))
})

test('POST de action do login da fábrica continua barrado, com ou sem o cabeçalho de action', async () => {
  claims = fabrica()
  const pedidosDeAction: Record<string, string>[] = [
    { 'next-action': 'qualquer', 'content-type': 'text/plain;charset=UTF-8' },
    { 'content-type': 'multipart/form-data; boundary=x' },
    { 'content-type': 'application/x-www-form-urlencoded' },
  ]
  for (const headers of pedidosDeAction) {
    assert.equal((await pedir('POST', '/fabrica', headers)).status, 403, JSON.stringify(headers))
    assert.equal((await pedir('POST', '/dashboard', headers)).status, 403, JSON.stringify(headers))
  }
})

test('HEAD também chega sem content-type; GET com cabeçalho de action chega sem content-type mas com o next-action, e o servidor recusa', async () => {
  claims = fabrica()
  const head = await pedir('HEAD', '/fabrica', { 'content-type': 'multipart/form-data; boundary=x' })
  assert.ok(seguiu(head))
  assert.ok(!cabecalhosAoApp(head).includes('content-type'))
  const get = await pedir('GET', '/fabrica', { 'next-action': 'qualquer', 'content-type': 'multipart/form-data; boundary=x' })
  assert.ok(seguiu(get))
  const repassados = cabecalhosAoApp(get)
  assert.ok(!repassados.includes('content-type'))
  assert.ok(repassados.includes('next-action'))
  // O GET não executa action no Next; mesmo assim o servidor recusa pelo cabeçalho (getUsuarioLogado).
  const { ehPedidoDeAcao } = await import('@/lib/login-fabrica')
  assert.equal(ehPedidoDeAcao(new Headers({ 'next-action': get.headers.get('x-middleware-request-next-action') ?? '' })), true)
})

// Sem sessão (#281). Guardas do que NÃO pode mudar quando o pedido de action sem sessão deixar de
// ser redirecionado: leitura de página, formulário, login e rotas que o middleware nem enxerga.
test('sem sessão: abrir página e POST sem next-action (formulário, sair) vão ao login', async () => {
  claims = null
  assert.equal(destino(await pedir('GET', '/estoque')), '/login')
  assert.equal(destino(await pedir('POST', '/sair', { origin: 'http://localhost:3000' })), '/login')
  assert.equal(destino(await pedir('POST', '/estoque', { 'content-type': 'application/x-www-form-urlencoded' })), '/login')
})

test('sem sessão: /login abre, e o POST do loginAction (com next-action) segue para a action', async () => {
  claims = null
  assert.ok(seguiu(await pedir('GET', '/login')))
  const login = await pedir('POST', '/login', { 'next-action': 'qualquer', 'content-type': 'text/plain;charset=UTF-8' })
  assert.ok(seguiu(login))
})

test('com sessão: POST de action em página logada segue para a action', async () => {
  claims = { sub: 'u4', app_metadata: {} }
  assert.ok(seguiu(await pedir('POST', '/estoque', { 'next-action': 'qualquer', 'content-type': 'text/plain;charset=UTF-8' })))
})

test('sem sessão: clique de action (next-action) recebe 401 em texto com a frase, e a action não roda', async () => {
  claims = null
  const r = await pedir('POST', '/estoque', { 'next-action': 'qualquer', 'content-type': 'text/plain;charset=UTF-8' })
  assert.equal(r.status, 401)
  // Exato: o cliente do Next só lê o corpo do erro quando o content-type é "text/plain", sem charset.
  assert.equal(r.headers.get('content-type'), 'text/plain')
  assert.equal(await r.text(), SESSAO_ENCERRADA)
  // Não é "seguir para a página": nenhum cabeçalho de repasse ao app.
  assert.equal(r.headers.get('x-middleware-next'), null)
  assert.equal(destino(r), null)
})

test('o 401 de sessão encerrada não é guardado em cache e segue com o content-type exato', async () => {
  claims = null
  const r = await pedir('POST', '/estoque', { 'next-action': 'qualquer' })
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(r.headers.get('content-type'), 'text/plain')
})

test('sem sessão: só o POST com next-action preenchido recebe o 401; GET, HEAD e cabeçalho vazio vão ao login', async () => {
  claims = null
  // O Next só executa action em POST, e o cliente sempre manda o id dela.
  assert.equal(destino(await pedir('GET', '/estoque', { 'next-action': 'qualquer' })), '/login')
  assert.equal(destino(await pedir('HEAD', '/estoque', { 'next-action': 'qualquer' })), '/login')
  assert.equal(destino(await pedir('POST', '/estoque', { 'next-action': '' })), '/login')
})

/** Aproxima o matcher do Next por uma RegExp ancorada (`^...$`): o teste confere o padrão escrito em `config`, não o compilador do Next. */
async function foraDoMatcher(caminho: string) {
  const { config } = await import('./middleware')
  return config.matcher.every(m => !new RegExp(`^${m}$`).test(caminho))
}

test('rotas públicas com Server Action ou rota própria estão fora do matcher: o middleware nem as vê', async () => {
  for (const caminho of ['/assinar/abc', '/assinar/adesao/abc', '/adesao', '/avaliar/abc', '/api/cron/qualquer']) {
    assert.equal(await foraDoMatcher(caminho), true, caminho)
  }
  // Contra-prova: páginas logadas e o login entram no matcher.
  for (const caminho of ['/estoque', '/login', '/dashboard']) assert.equal(await foraDoMatcher(caminho), false, caminho)
})

// Registro do comportamento de hoje, sem afirmar como deveria ser: /agendar não está fora do matcher,
// então sem sessão o pedido cai no login. A decisão sobre o portal está na #285.
test('registro de hoje: /agendar sem sessão é redirecionado ao login', async () => {
  claims = null
  assert.equal(await foraDoMatcher('/agendar/loja-1'), false)
  assert.equal(destino(await pedir('GET', '/agendar/loja-1')), '/login')
})
