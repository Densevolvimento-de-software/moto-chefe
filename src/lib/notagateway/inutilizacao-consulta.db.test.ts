// Teste de banco: roda contra o Postgres descartável do CI (job `banco` do ci.yml).
// A consulta do resultado da inutilização (#66), a do clique "Consultar resultado".
// Mock só da consulta à NG; configuração e gravação rodam no banco.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url
// Chave descartável só para o cifrar() da credencial do grupo.
process.env.CERT_MASTER_KEY ??= 'a'.repeat(64)

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
type Mod = typeof import('@/lib/notagateway/inutilizar')
type Consultar = import('@/lib/notagateway/inutilizar').DependenciasConsulta['consultar']
let db: Db['db']
let m: Mod
let cifrar: typeof import('@/lib/cripto').cifrar

before(async () => {
  ;({ db } = await import('@/lib/db'))
  m = await import('@/lib/notagateway/inutilizar')
  ;({ cifrar } = await import('@/lib/cripto'))
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (tx: Tx, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as { rows: any[] }).rows

/** Conta com grupo, sócio e credencial da NG cifrada no ambiente pedido (null = sem credencial). */
async function semearConta(tx: Tx, nome: string, cnpj: string, ambienteDaNg: string | null = 'Homologacao') {
  const base = await semearContaBase(tx, { prefixo: 'WH66', nome, cnpj })
  if (ambienteDaNg) {
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id, ambiente)
      values (${base.grupoId}, ${cifrar(`token-${nome}`)}, ${`empresa-${nome}`}, ${ambienteDaNg})`)
  }
  const socio = { id: await semearUsuario(tx, base, { papel: 'admin_socio' }), papel: 'admin_socio', lojaId: base.lojaId, gruposAcesso: null, contaId: base.contaId }
  return { grupoId: base.grupoId, socio }
}

type Pedido = { idExterno: string; ambiente?: string; situacao?: string; status?: string; protocolo?: string | null }

async function semearInutilizacao(tx: Tx, grupoId: string, { idExterno, ambiente = 'Homologacao', situacao = 'pendente', status = 'Enviando', protocolo = null }: Pedido) {
  const [l] = await linhas(tx, sql`insert into notas_fiscais_saida_inutilizacoes
    (grupo_id, id_externo, ambiente, serie, numero_inicial, numero_final, justificativa, situacao, status, protocolo)
    values (${grupoId}, ${idExterno}, ${ambiente}, '1', 20, 22, 'Quebra na sequencia da numeracao', ${situacao}, ${status}, ${protocolo})
    returning id`)
  return l.id as string
}

const linhaDe = async (tx: Tx, id: string) =>
  (await linhas(tx, sql`select situacao, status, motivo_status, protocolo from notas_fiscais_saida_inutilizacoes where id = ${id}`))[0]

/** Consulta à NG trocada: devolve a resposta dada e guarda com que credencial foi chamada. */
function ngQueResponde(resposta: Awaited<ReturnType<Consultar>>) {
  const chamadas: { empresaId: string; idExterno: string }[] = []
  const consultar: Consultar = async (cfg, idExterno) => { chamadas.push({ empresaId: cfg.empresaId, idExterno }); return resposta }
  return { consultar, chamadas }
}

const depsDe = (tx: Tx, consultar: Consultar) => ({ exec: tx, config: m.configDoAmbiente, consultar, agora: () => new Date() })

const AUTORIZADA = { status: 'Autorizada', motivoStatus: null, protocolo: '353190000062124' }

test('clique: a pendente vira autorizada com o protocolo da consulta, consultada com a credencial do grupo dela', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A', '00000000066001')
    const id = await semearInutilizacao(tx, a.grupoId, { idExterno: 'wh66-clique-1' })
    const ng = ngQueResponde(AUTORIZADA)

    const r = await m.consultarInutilizacao(a.socio, id, depsDe(tx, ng.consultar))

    assert.deepEqual(r, { ok: true, situacao: 'autorizada', motivoStatus: null, protocolo: '353190000062124' })
    assert.deepEqual(await linhaDe(tx, id), { situacao: 'autorizada', status: 'Autorizada', motivo_status: null, protocolo: '353190000062124' })
    assert.deepEqual(ng.chamadas, [{ empresaId: 'empresa-A', idExterno: 'wh66-clique-1' }])
  })
})

test('clique: a Conta B recebe a mesma frase do id inexistente e a linha da A não muda', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A', '00000000066001')
    const b = await semearConta(tx, 'B', '00000000066002')
    const id = await semearInutilizacao(tx, a.grupoId, { idExterno: 'wh66-clique-2' })
    const ng = ngQueResponde(AUTORIZADA)

    const daB = await m.consultarInutilizacao(b.socio, id, depsDe(tx, ng.consultar))
    const inexistente = await m.consultarInutilizacao(b.socio, '00000000-0000-0000-0000-000000000000', depsDe(tx, ng.consultar))

    assert.deepEqual(daB, { ok: false, erro: 'Inutilização não encontrada' })
    assert.deepEqual(inexistente, daB)
    assert.equal((await linhaDe(tx, id)).situacao, 'pendente')
    assert.equal(ng.chamadas.length, 0)
  })
})

test('clique depois de resolvida: devolve o gravado sem ir à NG', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A', '00000000066001')
    const id = await semearInutilizacao(tx, a.grupoId, { idExterno: 'wh66-clique-3', situacao: 'autorizada', status: 'Autorizada', protocolo: 'P-GRAVADO' })
    const ng = ngQueResponde({ status: 'Negada', motivoStatus: 'nao devia consultar', protocolo: null })

    const r = await m.consultarInutilizacao(a.socio, id, depsDe(tx, ng.consultar))

    assert.deepEqual(r, { ok: true, situacao: 'autorizada', motivoStatus: null, protocolo: 'P-GRAVADO' })
    assert.equal(ng.chamadas.length, 0)
  })
})
