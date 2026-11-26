// Página da OS contra o banco (#273): quem não pode abrir a OS recebe "não encontrada" (igual a OS que não
// existe), e quem pode recebe os serviços ativos da Conta da LOJA da OS, não os da Conta da sessão.
// Sessão, cookie e navegação são a fronteira simulada (paginaPorConta); permissão, consultas e catálogo
// rodam de verdade.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidElement } from 'react'
import { sql } from 'drizzle-orm'
import { NaoEncontrada, paginaPorConta } from '@/test/pagina-por-conta'
import { sessaoDe } from '@/test/sessao'
import { idDoInsert, semearUsuario, type Base } from '@/test/semear-conta'

const P = 'SOP273'
const p = paginaPorConta(P)
let Page: typeof import('./[id]/page')['default']
let usuarioDaRede: typeof import('@/lib/grupos-liberados')['usuarioDaRede']
let a: Base, b: Base, r: Base
let osDeA = ''

// A página passa os serviços ao painel de itens como prop: procura pelo nome na árvore de elementos.
function propNaArvore(no: unknown, nome: string): unknown {
  if (Array.isArray(no)) return no.map(filho => propNaArvore(filho, nome)).find(achado => achado !== undefined)
  if (!isValidElement(no)) return undefined
  const props = no.props as Record<string, unknown>
  return nome in props ? props[nome] : propNaArvore(props.children, nome)
}
const servicosDaTela = async (osId: string) =>
  (propNaArvore(await Page({ params: Promise.resolve({ id: osId }) }), 'servicos') as { nome: string }[]).map(s => s.nome)

before(async () => {
  ;({ usuarioDaRede } = await import('@/lib/grupos-liberados'))
  ;({ default: Page } = await import('./[id]/page'))
  const db = p.db()
  a = await p.conta('A', '00000000427301')
  b = await p.conta('B', '00000000427302')
  r = await p.conta('R', '00000000427303')
  const usuarioA = await semearUsuario(db, a, { papel: 'aux_adm' })
  osDeA = await idDoInsert(db, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${a.lojaId}, ${usuarioA}, 'OS sintética') returning id`)
  await db.execute(sql`insert into servicos_catalogo (conta_id, nome, valor, ativo) values
    (${a.contaId}, ${`${P} ativo da A`}, 10, true), (${a.contaId}, ${`${P} inativo da A`}, 10, false), (${b.contaId}, ${`${P} ativo da B`}, 10, true)`)
})

test('OS da própria Conta: a página traz só os serviços ativos da Conta da loja', async () => {
  p.entrar(sessaoDe(a, 'aux_adm', `${P}-aux-a`))
  assert.deepEqual(await servicosDaTela(osDeA), [`${P} ativo da A`])
})

test('admin_geral abrindo a OS da Conta A recebe os serviços da Conta A, qualquer que seja o grupo dele', async () => {
  p.entrar(sessaoDe(b, 'admin_geral', `${P}-geral`, { lojaId: null }))
  assert.deepEqual(await servicosDaTela(osDeA), [`${P} ativo da A`])
})

test('OS de outra Conta: a página responde "não encontrada", como para OS que não existe', async () => {
  p.entrar(sessaoDe(b, 'aux_adm', `${P}-aux-b`))
  await assert.rejects(servicosDaTela(osDeA), NaoEncontrada)
  await assert.rejects(servicosDaTela('00000000-0000-0000-0000-000000000000'), NaoEncontrada)
})

const adminRede = (liberados: { grupoId: string; contaId: string }[]) =>
  usuarioDaRede(sessaoDe(r, 'admin_rede', `${P}-rede`, { gruposAcesso: [r.grupoId] }), liberados, a.grupoId)

test('admin_rede com o grupo liberado abre a OS da loja desse grupo e recebe os serviços da Conta dona', async () => {
  const persona = adminRede([{ grupoId: a.grupoId, contaId: a.contaId }])
  assert.equal(persona.grupoLiberado, a.grupoId)
  p.entrar(persona, a.grupoId)
  assert.deepEqual(await servicosDaTela(osDeA), [`${P} ativo da A`])
})

test('admin_rede sem liberação do grupo recebe "não encontrada" ao abrir a OS dele', async () => {
  const persona = adminRede([])
  assert.equal(persona.grupoLiberado, null)
  p.entrar(persona, a.grupoId)
  await assert.rejects(servicosDaTela(osDeA), NaoEncontrada)
})
