// Migração 0211 (#317, API de leitura MotoChefe): confere a estrutura que o banco guarda. Só lê o catálogo,
// não grava linha nenhuma, então roda em paralelo com os outros arquivos do test:db sem disputa.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

// Import dinâmico: o módulo de banco lê DATABASE_URL ao carregar, então tem de vir depois do ajuste acima.
let execRows: typeof import('@/lib/db')['execRows']
before(async () => { ({ execRows } = await import('@/lib/db')) })
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

const TABELAS = ['api_chaves', 'api_acessos', 'api_limite'] as const

const colunasDe = async (tabela: string) => (await execRows(sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = ${tabela} order by column_name`)).map(r => r.column_name)

const definicaoDoIndice = async (nome: string) => (await execRows(sql`
  select indexdef from pg_indexes where schemaname = 'public' and indexname = ${nome}`))[0]?.indexdef as string | undefined

test('loja e Conta nascem com a marcação e a autorização desligadas', async () => {
  const colunas = await execRows(sql`
    select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and (table_name, column_name) in (('lojas', 'loja_motochefe'), ('contas', 'autoriza_custo_despesa_meta'))
    order by table_name`)
  assert.equal(colunas.length, 2)
  for (const c of colunas) {
    assert.equal(c.data_type, 'boolean', c.column_name)
    assert.equal(c.is_nullable, 'NO', c.column_name)
    assert.equal(c.column_default, 'false', c.column_name)
  }
})

test('as tabelas da API têm RLS ligado e nenhuma policy', async () => {
  const rls = await execRows(sql`
    select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('api_chaves', 'api_acessos', 'api_limite') order by c.relname`)
  assert.deepEqual(rls.map(r => [r.relname, r.relrowsecurity]), [['api_acessos', true], ['api_chaves', true], ['api_limite', true]])
  const policies = await execRows(sql`select tablename from pg_policies where schemaname = 'public' and tablename in ('api_chaves', 'api_acessos', 'api_limite')`)
  assert.equal(policies.length, 0)
})

test('anon e authenticated não têm nenhum privilégio nas tabelas da API', async () => {
  const abertos: string[] = []
  for (const tabela of TABELAS) {
    for (const papel of ['anon', 'authenticated']) {
      for (const privilegio of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const [r] = await execRows(sql`select has_table_privilege(${papel}, ${tabela}, ${privilegio}) as tem`)
        if (r.tem) abertos.push(`${papel} ${privilegio} ${tabela}`)
      }
    }
  }
  assert.deepEqual(abertos, [])
})

test('api_chaves guarda só o hash: nenhuma coluna com a chave em claro ou cifrada', async () => {
  assert.deepEqual(await colunasDe('api_chaves'), ['gerada_em', 'gerada_por', 'hash', 'id', 'revogada_em', 'valida_ate'])
  assert.match(await definicaoDoIndice('api_chaves_hash_key') ?? '', /UNIQUE INDEX api_chaves_hash_key .*\(hash\)/)
})

test('o índice da chave atual é único e só cobre chave não trocada nem revogada', async () => {
  const def = await definicaoDoIndice('api_chaves_atual_key')
  assert.ok(def, 'índice api_chaves_atual_key não existe')
  assert.match(def, /CREATE UNIQUE INDEX api_chaves_atual_key /)
  assert.match(def, /WHERE .*valida_ate IS NULL.*revogada_em IS NULL/)
})

test('api_acessos registra cada chamada, inclusive a sem chave (chave_id nulo)', async () => {
  assert.deepEqual(await colunasDe('api_acessos'), [
    'chave_id', 'criado_em', 'endpoint', 'id', 'ip', 'linhas', 'pagina', 'periodo_fim', 'periodo_ini', 'status', 'user_agent',
  ])
  const [r] = await execRows(sql`select is_nullable from information_schema.columns where table_name = 'api_acessos' and column_name = 'chave_id'`)
  assert.equal(r.is_nullable, 'YES')
})

test('api_limite tem uma linha por chave e minuto', async () => {
  assert.deepEqual(await colunasDe('api_limite'), ['chave_id', 'janela', 'pedidos'])
  const [r] = await execRows(sql`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'api_limite'::regclass and contype = 'p'`)
  assert.equal(r.def, 'PRIMARY KEY (chave_id, janela)')
})
