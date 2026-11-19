import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listarArquivos } from '@/test/listar-arquivos'

// #90: o PIX cobre o pagamento pelo valor do PIX (pixCobertoSql), não pelo crédito. Somar `valor` direto
// de pix_recebimentos_mcp voltaria a deixar a venda "Parcial" quando o banco cobra o custo do PIX.
const RAIZ = join(__dirname, '..', '..', '..')
const SOMA_DO_CREDITO = /SUM\(\s*valor::numeric\s*\)\s*FROM\s+pix_recebimentos_mcp/

test('a regra pega a soma do crédito na mesma linha e em linhas separadas', () => {
  assert.equal(SOMA_DO_CREDITO.test('(SELECT SUM(valor::numeric) FROM pix_recebimentos_mcp WHERE venda_id = x)'), true)
  assert.equal(SOMA_DO_CREDITO.test('SELECT SUM(valor::numeric)\n      FROM pix_recebimentos_mcp\n      WHERE os_id = x'), true)
  assert.equal(SOMA_DO_CREDITO.test('SELECT SUM(${pixCobertoSql()})\n      FROM pix_recebimentos_mcp'), false)
  assert.equal(SOMA_DO_CREDITO.test('SELECT SUM(valor_bruto::numeric)\n      FROM conciliacoes_cartao'), false)
})

test('nenhuma consulta do app soma o crédito do PIX recebido fora do pixCobertoSql', () => {
  const somam = listarArquivos(join(RAIZ, 'src'), f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter(f => SOMA_DO_CREDITO.test(readFileSync(f, 'utf8')))
    .map(f => relative(RAIZ, f))
  assert.deepEqual(somam, [])
})
