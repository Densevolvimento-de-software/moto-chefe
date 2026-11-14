// O middleware ligado à regra do login da fábrica (#901): o papel vem do app_metadata do token.
// Mock só na fronteira: o cliente do Supabase (getClaims).
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

let claims: Record<string, unknown> | null = null
mock.module('@supabase/ssr', { namedExports: {
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null }) } }),
} })

const fabrica = (extra: Record<string, unknown> = {}) => ({ sub: 'u1', app_metadata: { papel: 'fabrica' }, ...extra })
const pedir = async (metodo: string, caminho: string, headers: Record<string, string> = {}) => {
  const { middleware } = await import('./middleware')
  return middleware(new NextRequest(`http://localhost:3000${caminho}`, { method: metodo, headers }))
}
/** Cabeçalhos que o middleware manda ao app (a resposta do Supabase já repassa os do pedido). */
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
