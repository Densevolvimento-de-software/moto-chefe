// Teste de banco: roda contra o Postgres descartável do CI (job `banco` do ci.yml).
// Como montar local: `npm run test:db:local`. Cada caso grava numa transação desfeita no fim.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url
// Chave descartável só para o cifrar() do teste.
process.env.CERT_MASTER_KEY ??= 'a'.repeat(64)

type Db = typeof import('@/lib/db')
let db: Db['db']
let salvarCredencial: typeof import('@/lib/notagateway/credencial')['salvarCredencial']

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ salvarCredencial } = await import('@/lib/notagateway/credencial'))
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]

async function cenario(tx: Tx) {
  const linha = async (q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as { rows: { id: string }[] }).rows[0]
  const conta = await linha(sql`insert into contas (nome) values ('Conta A') returning id`)
  const contaB = await linha(sql`insert into contas (nome) values ('Conta B') returning id`)
  const grupo = await linha(sql`insert into grupos (nome, cnpj, conta_id) values ('Cuiabá', '49.366.097/0001-40', ${conta.id}) returning id`)
  const grupoB = await linha(sql`insert into grupos (nome, cnpj, conta_id) values ('Teresina', '00000000000272', ${contaB.id}) returning id`)
  return {
    grupo: grupo.id, grupoB: grupoB.id,
    socio: { id: 'socio', papel: 'admin_socio', contaId: conta.id },
    geral: { id: 'geral', papel: 'admin_geral', contaId: null },
  }
}

async function configDoGrupo(tx: Tx, grupoId: string) {
  const r = (await tx.execute(sql`select ambiente from notagateway_config where grupo_id = ${grupoId}`)) as unknown as { rows: { ambiente: string }[] }
  return r.rows[0] ?? null
}

async function empresaDoGrupo(tx: Tx, grupoId: string) {
  const r = (await tx.execute(sql`select empresa_id from notagateway_config where grupo_id = ${grupoId}`)) as unknown as { rows: { empresa_id: string | null }[] }
  return r.rows[0]?.empresa_id ?? null
}

/** Dublê da Consultar Empresa da NG: anota as chamadas e devolve o CNPJ cadastrado de cada empresa. */
function ngFalsa(cnpjs: Record<string, string>, opcoes: { foraDoAr?: boolean; cnpjPorToken?: Record<string, string> } = {}) {
  const chamadas: string[] = []
  return {
    chamadas,
    deps: {
      cnpjDaEmpresaNaNg: async (cfg: { token: string; empresaId: string }) => {
        chamadas.push(cfg.empresaId)
        if (opcoes.foraDoAr) throw new Error('fetch failed')
        // Token de outra conta da NG enxerga outra empresa com o mesmo id.
        const cnpj = opcoes.cnpjPorToken?.[cfg.token] ?? cnpjs[cfg.empresaId]
        if (!cnpj) throw new Error('HTTP 400')
        return cnpj
      },
    },
  }
}

const payload = (grupoId: string) => ({ grupoId, token: 'token-novo', empresaId: '', ambiente: 'Producao' as const })
const semNg = ngFalsa({}).deps

test('admin_socio não grava a credencial da NG, nem do grupo da própria Conta', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const r = await salvarCredencial(c.socio, payload(c.grupo), semNg, tx)
    assert.deepEqual(r, { ok: false, erro: 'Acesso restrito ao Admin Geral' })
    assert.equal(await configDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('admin_socio não troca o ambiente de uma credencial que já existe', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, ambiente) values (${c.grupo}, 'cifrado', 'Homologacao')`)
    const r = await salvarCredencial(c.socio, { ...payload(c.grupo), token: '' }, semNg, tx)
    assert.equal(r.ok, false)
    assert.equal((await configDoGrupo(tx, c.grupo))!.ambiente, 'Homologacao')
    throw new Desfazer()
  }), Desfazer)
})

test('admin_geral grava a credencial do grupo', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    assert.deepEqual(await salvarCredencial(c.geral, payload(c.grupo), semNg, tx), { ok: true })
    assert.deepEqual(await configDoGrupo(tx, c.grupo), { ambiente: 'Producao' })
    throw new Desfazer()
  }), Desfazer)
})

test('admin_geral com grupo inexistente recebe "Grupo não encontrado"', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    assert.deepEqual(await salvarCredencial(c.geral, payload('00000000-0000-0000-0000-000000000000'), semNg, tx), { ok: false, erro: 'Grupo não encontrado' })
    throw new Desfazer()
  }), Desfazer)
})

test('admin_geral grava o empresaId quando o CNPJ da empresa na NG é o do grupo', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({ '11111111-2222-4333-8444-555555555555': '49366097000140' })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: ' 11111111-2222-4333-8444-555555555555 ' }, ng.deps, tx)
    assert.deepEqual(r, { ok: true })
    assert.deepEqual(ng.chamadas, ['11111111-2222-4333-8444-555555555555'])
    assert.equal(await empresaDoGrupo(tx, c.grupo), '11111111-2222-4333-8444-555555555555')
    throw new Desfazer()
  }), Desfazer)
})

test('admin_socio não grava o empresaId e a NG nem é consultada', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({ '11111111-2222-4333-8444-555555555555': '49366097000140' })
    const r = await salvarCredencial(c.socio, { ...payload(c.grupo), empresaId: '11111111-2222-4333-8444-555555555555' }, ng.deps, tx)
    assert.deepEqual(r, { ok: false, erro: 'Acesso restrito ao Admin Geral' })
    assert.deepEqual(ng.chamadas, [])
    assert.equal(await empresaDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('CNPJ da empresa na NG diferente do grupo bloqueia, sem mostrar o CNPJ de lá', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({ '66666666-7777-4888-9999-000000000000': '11222333000181' })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: '66666666-7777-4888-9999-000000000000' }, ng.deps, tx)
    assert.deepEqual(r, { ok: false, erro: 'Essa empresa da Nota Gateway tem outro CNPJ, diferente do CNPJ deste grupo.' })
    assert.equal(await configDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('empresaId já ligado a grupo de outra Conta bloqueia, com frase que não diz qual', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id) values (${c.grupoB}, 'cifrado', '11111111-2222-4333-8444-555555555555')`)
    const ng = ngFalsa({ '11111111-2222-4333-8444-555555555555': '49366097000140' })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: '11111111-2222-4333-8444-555555555555' }, ng.deps, tx)
    assert.deepEqual(r, { ok: false, erro: 'Essa empresa da Nota Gateway já está ligada a outro grupo.' })
    assert.ok(!/Teresina|Conta B/.test(r.ok ? '' : r.erro))
    assert.deepEqual(ng.chamadas, [], 'duplicado não chega a consultar a NG')
    assert.equal(await empresaDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('NG fora do ar: frase fixa e nada gravado', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({}, { foraDoAr: true })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: '11111111-2222-4333-8444-555555555555' }, ng.deps, tx)
    assert.deepEqual(r, { ok: false, erro: 'Não deu para confirmar a empresa na Nota Gateway agora. Confira o token e o id e tente de novo.' })
    assert.equal(await configDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('id da empresa fora do formato (../, ?) é recusado antes de chamar a NG', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({})
    for (const id of ['../../empresas', '11111111-2222-4333-8444-555555555555?x=1', 'abc/def']) {
      const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: id }, ng.deps, tx)
      assert.deepEqual(r, { ok: false, erro: 'O id da empresa na Nota Gateway não está no formato certo. Copie de novo do painel da Nota Gateway.' }, id)
    }
    assert.deepEqual(ng.chamadas, [])
    assert.equal(await configDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('id da empresa alfanumérico que não é uuid é aceito e consultado na NG', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({ 'EmpresaTeste_01-a': '49366097000140' })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), empresaId: 'EmpresaTeste_01-a' }, ng.deps, tx)
    assert.deepEqual(r, { ok: true })
    assert.deepEqual(ng.chamadas, ['EmpresaTeste_01-a'])
    assert.equal(await empresaDoGrupo(tx, c.grupo), 'EmpresaTeste_01-a')
    throw new Desfazer()
  }), Desfazer)
})

async function tokenDoGrupo(tx: Tx, grupoId: string) {
  const r = (await tx.execute(sql`select token from notagateway_config where grupo_id = ${grupoId}`)) as unknown as { rows: { token: string }[] }
  return r.rows[0]?.token ?? null
}

const EMPRESA = '11111111-2222-4333-8444-555555555555'

test('trocar só o token reconfere na NG: token de outra conta NG (CNPJ diferente) é recusado e nada muda', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id, ambiente) values (${c.grupo}, 'cifrado-antigo', ${EMPRESA}, 'Homologacao')`)
    const ng = ngFalsa({ [EMPRESA]: '49366097000140' }, { cnpjPorToken: { 'token-de-outra-conta': '11222333000181' } })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), token: 'token-de-outra-conta', empresaId: '' }, ng.deps, tx)
    assert.deepEqual(r, { ok: false, erro: 'Essa empresa da Nota Gateway tem outro CNPJ, diferente do CNPJ deste grupo.' })
    assert.deepEqual(ng.chamadas, [EMPRESA])
    assert.equal(await tokenDoGrupo(tx, c.grupo), 'cifrado-antigo')
    assert.equal((await configDoGrupo(tx, c.grupo))!.ambiente, 'Homologacao')
    throw new Desfazer()
  }), Desfazer)
})

test('trocar só o token com a NG fora do ar não grava', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id) values (${c.grupo}, 'cifrado-antigo', ${EMPRESA})`)
    const ng = ngFalsa({}, { foraDoAr: true })
    const r = await salvarCredencial(c.geral, { ...payload(c.grupo), token: 'token-novo', empresaId: '' }, ng.deps, tx)
    assert.equal(r.ok, false)
    assert.equal(await tokenDoGrupo(tx, c.grupo), 'cifrado-antigo')
    throw new Desfazer()
  }), Desfazer)
})

test('trocar só o token da mesma conta NG (CNPJ confere) grava', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id) values (${c.grupo}, 'cifrado-antigo', ${EMPRESA})`)
    const ng = ngFalsa({ [EMPRESA]: '49366097000140' })
    assert.deepEqual(await salvarCredencial(c.geral, { ...payload(c.grupo), token: 'token-novo', empresaId: '' }, ng.deps, tx), { ok: true })
    assert.notEqual(await tokenDoGrupo(tx, c.grupo), 'cifrado-antigo')
    throw new Desfazer()
  }), Desfazer)
})

test('sem empresa gravada, o token novo é aceito sem consultar a NG', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token) values (${c.grupo}, 'cifrado-antigo')`)
    const ng = ngFalsa({})
    assert.deepEqual(await salvarCredencial(c.geral, { ...payload(c.grupo), token: 'token-novo', empresaId: '' }, ng.deps, tx), { ok: true })
    assert.deepEqual(ng.chamadas, [])
    throw new Desfazer()
  }), Desfazer)
})

// #126: token colado pela tela é normalizado antes de qualquer uso; nas falhas da Consultar Empresa, o log não leva o
// token nem pedaço dele.
const TOKEN_NG = 'ngTokenFicticio0123456789abcdefABCDEF'
const EMPRESA_126 = '11111111-2222-4333-8444-555555555555'

test('token colado com quebra de linha e espaços: grava e consulta a NG com o token normalizado', async () => {
  const { decifrar } = await import('@/lib/cripto')
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({}, { cnpjPorToken: { [TOKEN_NG]: '49366097000140' } })
    const colado = ` ${TOKEN_NG.slice(0, 10)}\n${TOKEN_NG.slice(10, 20)}\r\n\t${TOKEN_NG.slice(20)} `
    const r = await salvarCredencial(c.geral, { grupoId: c.grupo, token: colado, empresaId: EMPRESA_126, ambiente: 'Producao' }, ng.deps, tx)
    assert.deepEqual(r, { ok: true })
    const [linha] = ((await tx.execute(sql`select token from notagateway_config where grupo_id = ${c.grupo}`)) as unknown as { rows: { token: string }[] }).rows
    assert.equal(decifrar(linha.token).toString('utf8'), TOKEN_NG)
    throw new Desfazer()
  }), Desfazer)
})

test('token fora do formato depois de normalizado: frase, sem consultar a NG e sem gravar', async () => {
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    const ng = ngFalsa({ [EMPRESA_126]: '49366097000140' })
    for (const token of [`${TOKEN_NG}\u0000`, `${TOKEN_NG}ç`]) {
      const r = await salvarCredencial(c.geral, { grupoId: c.grupo, token, empresaId: EMPRESA_126, ambiente: 'Producao' }, ng.deps, tx)
      assert.deepEqual(r, { ok: false, erro: 'Esse token não está no formato da Nota Gateway. Copie de novo o Token Basic inteiro no painel da Nota Gateway.' })
    }
    assert.deepEqual(ng.chamadas, [])
    assert.equal(await configDoGrupo(tx, c.grupo), null)
    throw new Desfazer()
  }), Desfazer)
})

test('falha na Consultar Empresa: nem o log nem a resposta levam o token, pedaço dele ou o empresaId', async t => {
  const saidas = (['log', 'info', 'warn', 'error'] as const).map(m => t.mock.method(console, m, () => {}))
  const respostas: unknown[] = []
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    for (const erro of [new TypeError(`falhou com ${TOKEN_NG}`), new Error(`Consultar Empresa respondeu HTTP 401 em /v2/empresas/${EMPRESA_126}`)]) {
      const deps = { cnpjDaEmpresaNaNg: async () => { throw erro } }
      respostas.push(await salvarCredencial(c.geral, { grupoId: c.grupo, token: TOKEN_NG, empresaId: EMPRESA_126, ambiente: 'Producao' }, deps, tx))
    }
    throw new Desfazer()
  }), Desfazer)
  const linhas = saidas.flatMap(s => s.mock.calls.map(c => c.arguments.map(String).join(' ')))
  assert.deepEqual(linhas, ['[credencial-ng] Consultar Empresa falhou: TypeError', '[credencial-ng] Consultar Empresa falhou: Error'])
  const tudo = `${linhas.join('\n')}\n${JSON.stringify(respostas)}`
  assert.equal(tudo.includes(EMPRESA_126), false)
  for (let i = 0; i + 8 <= TOKEN_NG.length; i++) assert.equal(tudo.includes(TOKEN_NG.slice(i, i + 8)), false, `pedaço ${i} do token`)
})

test('token já gravado com quebra de linha chega à NG normalizado', async () => {
  const { cifrar } = await import('@/lib/cripto')
  const { configNotaGateway } = await import('@/lib/notagateway/client')
  await assert.rejects(db.transaction(async tx => {
    const c = await cenario(tx)
    await tx.execute(sql`insert into notagateway_config (grupo_id, token, empresa_id, ambiente)
      values (${c.grupo}, ${cifrar(`${TOKEN_NG.slice(0, 12)}\r\n${TOKEN_NG.slice(12)}`)}, ${EMPRESA_126}, 'Homologacao')`)
    assert.equal((await configNotaGateway(c.grupo, tx))?.token, TOKEN_NG)

    // Token novo vazio reconfere a empresa com o token gravado: normalizado também.
    const ng = ngFalsa({}, { cnpjPorToken: { [TOKEN_NG]: '49366097000140' } })
    assert.deepEqual(await salvarCredencial(c.geral, { grupoId: c.grupo, token: '', empresaId: EMPRESA_126, ambiente: 'Homologacao' }, ng.deps, tx), { ok: true })
    throw new Desfazer()
  }), Desfazer)
})
