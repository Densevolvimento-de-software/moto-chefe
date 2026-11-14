// Criar e editar cliente pela Server Action (#404): a recusa volta como { ok: false, erro }, a
// Conta vem do grupo ativo e a tela só revalida quando gravou. Banco, sessão e cache do Next são
// a fronteira de fora; permissão, gravação e acao() rodam de verdade.
import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const insercoes: Record<string, unknown>[] = []
const edicoes: { valores: Record<string, unknown>; params: unknown[] }[] = []
let erroNoInsert: unknown = null
let linhasEditadas = [{ id: 'c-9' }]
const dialeto = new PgDialect()
const db = {
  insert: () => ({ values: (valores: Record<string, unknown>) => {
    insercoes.push(valores)
    return { returning: async () => { if (erroNoInsert) throw erroNoInsert; return [{ id: 'c-1' }] } }
  } }),
  update: () => ({ set: (valores: Record<string, unknown>) => ({ where: (onde: SQL) => {
    edicoes.push({ valores, params: dialeto.sqlToQuery(onde).params })
    return { returning: async () => linhasEditadas }
  } }) }),
}
let usuario = { id: 'u-1', papel: 'vendedor', grupoLiberado: null as string | null }
const revalidados: string[] = []
mock.module('@/lib/db', { namedExports: { db } })
mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
mock.module('@/lib/grupo', { namedExports: { contaDoGrupoAtivo: async () => 'conta-ativa' } })
mock.module('next/cache', { namedExports: { revalidatePath: (p: string) => { revalidados.push(p) } } })

afterEach(() => {
  insercoes.length = 0
  edicoes.length = 0
  revalidados.length = 0
  erroNoInsert = null
  linhasEditadas = [{ id: 'c-9' }]
  usuario = { id: 'u-1', papel: 'vendedor', grupoLiberado: null }
})

const NOVO = { nome: 'Ana', tipoPessoa: 'fisica' as const, sexo: 'nao_identificado' as const, cpfCnpj: '529.982.247-25' }

test('sem o módulo de clientes: recusa com "Sem permissão" e não grava nem revalida', async () => {
  const { criarClienteAction, atualizarClienteAction } = await import('./actions')
  usuario = { ...usuario, papel: 'mecanico' }
  assert.deepEqual(await criarClienteAction(NOVO), { ok: false, erro: 'Sem permissão' })
  assert.deepEqual(await atualizarClienteAction('c-9', { nome: 'Outro' }), { ok: false, erro: 'Sem permissão' })
  assert.deepEqual(insercoes, [])
  assert.deepEqual(edicoes, [])
  assert.deepEqual(revalidados, [])
})

test('criar grava na Conta do grupo ativo, com o CPF só em dígitos, devolve o id e revalida a lista', async () => {
  const { criarClienteAction } = await import('./actions')
  assert.deepEqual(await criarClienteAction(NOVO), { ok: true, dados: 'c-1' })
  assert.deepEqual(insercoes.map(v => [v.contaId, v.cpfCnpj]), [['conta-ativa', '52998224725']])
  assert.deepEqual(revalidados, ['/clientes'])
})

test('campo fora do formulário mandado pela tela (Conta, id, data) não chega à gravação', async () => {
  const { criarClienteAction, atualizarClienteAction } = await import('./actions')
  const forjado = { contaId: 'outra', id: 'x', criadoEm: new Date(0) }
  await criarClienteAction({ ...NOVO, ...forjado } as typeof NOVO)
  await atualizarClienteAction('c-9', { nome: 'Ana Souza', ...forjado } as { nome: string })
  assert.equal(insercoes[0].contaId, 'conta-ativa')
  assert.deepEqual(['id', 'criadoEm'].filter(c => c in insercoes[0]), [])
  assert.deepEqual(['contaId', 'id', 'criadoEm'].filter(c => c in edicoes[0].valores), [])
})

test('criar com CPF repetido na Conta devolve a frase e não revalida', async () => {
  const { criarClienteAction } = await import('./actions')
  erroNoInsert = Object.assign(new Error('duplicate key'), { cause: { constraint: 'clientes_conta_cpf_cnpj_key' } })
  assert.deepEqual(await criarClienteAction(NOVO), { ok: false, erro: 'CPF/CNPJ já cadastrado' })
  assert.deepEqual(revalidados, [])
})

test('editar procura o cliente na Conta do grupo ativo e revalida a lista e a ficha', async () => {
  const { atualizarClienteAction } = await import('./actions')
  assert.deepEqual(await atualizarClienteAction('c-9', { nome: 'Ana Souza' }), { ok: true, dados: undefined })
  assert.equal(edicoes.length, 1)
  assert.equal(edicoes[0].valores.nome, 'Ana Souza')
  assert.ok(edicoes[0].params.includes('c-9'))
  assert.ok(edicoes[0].params.includes('conta-ativa'))
  assert.deepEqual(revalidados, ['/clientes', '/clientes/c-9'])
})

test('editar cliente que não está na Conta devolve "Cliente não encontrado" e não revalida', async () => {
  const { atualizarClienteAction } = await import('./actions')
  linhasEditadas = []
  assert.deepEqual(await atualizarClienteAction('c-9', { nome: 'Ana Souza' }), { ok: false, erro: 'Cliente não encontrado' })
  assert.deepEqual(revalidados, [])
})
