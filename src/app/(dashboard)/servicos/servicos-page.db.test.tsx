// Página /servicos (Server Component) contra o banco: a lista é da Conta do grupo ativo e `podeGerir`
// segue a mesma regra das actions. Grupo ativo, permissão de rota e consultas rodam de verdade; só sessão
// e cookie são simulados (paginaPorConta).
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { paginaPorConta } from '@/test/pagina-por-conta'
import { sessaoDe } from '@/test/sessao'
import type { Base } from '@/test/semear-conta'

const P = 'SCP273'
const p = paginaPorConta(P)
let Page: typeof import('./page')['default']
let usuarioDaRede: typeof import('@/lib/grupos-liberados')['usuarioDaRede']
let a: Base, b: Base, r: Base

const socioDe = (c: Base) => sessaoDe(c, 'admin_socio', `${P}-socio`, { lojaId: null, gruposAcesso: [c.grupoId] })
const nomesDaTela = async () => (await Page()).props.servicos.map((s: { nome: string }) => s.nome).sort()

before(async () => {
  const { servicosCatalogo } = await import('@/lib/db/schema')
  ;({ usuarioDaRede } = await import('@/lib/grupos-liberados'))
  ;({ default: Page } = await import('./page'))
  a = await p.conta('A', '00000000227301')
  b = await p.conta('B', '00000000227302')
  r = await p.conta('R', '00000000227303')
  await p.db().insert(servicosCatalogo).values([
    { contaId: a.contaId, nome: `${P} da Conta A`, valor: '10' },
    { contaId: a.contaId, nome: `${P} inativo da Conta A`, valor: '15', ativo: false },
    { contaId: b.contaId, nome: `${P} da Conta B`, valor: '20' },
  ])
})

test('a página envia só os serviços da Conta do grupo ativo, inclusive os inativos, e deixa o sócio gerir', async () => {
  p.entrar(socioDe(a), a.grupoId)
  assert.deepEqual(await nomesDaTela(), [`${P} da Conta A`, `${P} inativo da Conta A`])
  assert.equal((await Page()).props.podeGerir, true)
  p.entrar(socioDe(b), b.grupoId)
  assert.deepEqual(await nomesDaTela(), [`${P} da Conta B`])
})

test('aux_adm vê o catálogo da Conta dele sem poder gerir', async () => {
  p.entrar(sessaoDe(a, 'aux_adm', `${P}-aux`), a.grupoId)
  const tela = await Page()
  assert.equal(tela.props.podeGerir, false)
  assert.ok(tela.props.servicos.length > 0)
})

test('vendedor não abre a página: volta ao Dashboard', async () => {
  p.entrar(sessaoDe(a, 'vendedor', `${P}-vendedor`), a.grupoId)
  await assert.rejects(Page(), /redirect \/dashboard/)
})

test('admin_rede no grupo liberado de outra Conta vê o catálogo dela, sem poder gerir; em casa, gere o da própria Conta', async () => {
  const rede = sessaoDe(r, 'admin_rede', `${P}-rede`, { lojaId: r.lojaId, gruposAcesso: [r.grupoId] })
  const liberados = [{ grupoId: b.grupoId, contaId: b.contaId }]
  p.entrar(usuarioDaRede(rede, liberados, b.grupoId), b.grupoId)
  const noLiberado = await Page()
  assert.deepEqual(noLiberado.props.servicos.map((s: { nome: string }) => s.nome), [`${P} da Conta B`])
  assert.equal(noLiberado.props.podeGerir, false)
  p.entrar(usuarioDaRede(rede, liberados, r.grupoId), r.grupoId)
  assert.deepEqual(await nomesDaTela(), [])
  assert.equal((await Page()).props.podeGerir, true)
})
