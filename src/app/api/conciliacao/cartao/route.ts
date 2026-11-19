import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/cron-auth'
import { db } from '@/lib/db'
import { conciliacoesCartao, grupos } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { casarPorValor, linhaDaTransacao } from '@/lib/conciliacao-casamento'
import { lojasDoGrupo } from '@/lib/conta'
import { chaveDedup, type PayloadConciliacao } from '@/lib/conciliacao-cartao'
import { somenteDigitos } from '@/lib/grupo-cnpj'

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: PayloadConciliacao
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const { operadora, grupoCnpj, transacoes } = body

  if (!operadora || typeof grupoCnpj !== 'string' || !grupoCnpj ||
      !Array.isArray(transacoes) || transacoes.length === 0) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  // O grupo vem do payload, nunca do dado: cada grupo tem sua própria conta na
  // operadora, e adivinhar pelo conteúdo já colocou transação de BH em Sul de
  // Minas uma vez. A comparação é por dígitos — ver src/lib/grupo-cnpj.ts.
  const [grupo] = await db
    .select({ id: grupos.id })
    .from(grupos)
    .where(sql`regexp_replace(${grupos.cnpj}, '[^0-9]', '', 'g') = ${somenteDigitos(grupoCnpj)}`)
    .limit(1)

  if (!grupo) {
    return NextResponse.json({ error: `Grupo não encontrado para o CNPJ ${grupoCnpj}` }, { status: 400 })
  }

  // Sem isto o casamento varre a base inteira: uma transação do Sul de Minas
  // casa com uma venda de BH de mesmo valor, mesmas parcelas e ±1 dia — comum
  // em peça e OS. O caminho do CSV (conciliacao/actions.ts) já restringe assim.
  const lojaIdsGrupo = (await lojasDoGrupo(grupo.id)).map(l => l.id)

  let importadas = 0
  let duplicadas = 0
  let conciliadas = 0

  for (const t of transacoes) {
    // Ignora transações não aprovadas. `status` ausente não pode derrubar o
    // lote inteiro: sem status a transação simplesmente não entra.
    const status = typeof t.status === 'string' ? t.status.toLowerCase() : ''
    if (!['aprovado', 'approved', 'captured', 'capturada'].includes(status)) continue

    // Duplicata: NSU é a chave natural; a Stone não manda NSU, então o id da
    // operadora (guardado em rawData) evita reinserir a mesma venda a cada rodada.
    // O filtro de grupo é obrigatório: NSU sequencial de grupos diferentes pode
    // coincidir e descartar em silêncio uma transação de verdade como duplicada.
    const chave = chaveDedup(t)
    if (chave) {
      const condicao = chave.campo === 'nsu'
        ? eq(conciliacoesCartao.nsu, chave.valor)
        : sql`${conciliacoesCartao.rawData}->>'id' = ${chave.valor}`

      const [existente] = await db
        .select({ id: conciliacoesCartao.id })
        .from(conciliacoesCartao)
        .where(and(
          eq(conciliacoesCartao.grupoId, grupo.id),
          eq(conciliacoesCartao.operadora, operadora),
          condicao,
        ))
        .limit(1)
      if (existente) { duplicadas++; continue }
    }

    // Tenta casar com uma venda: mesmo dia ± 1 dia, valor bruto próximo, mesma qtd de parcelas.
    // Grupo sem loja cadastrada não tem como ter venda: nada a casar.
    const alvos = await casarPorValor(db, lojaIdsGrupo, t)
    const linha = linhaDaTransacao(grupo.id, operadora, t, alvos, new Date())
    await db.insert(conciliacoesCartao).values(linha)

    importadas++
    if (linha.conciliado) conciliadas++
  }

  return NextResponse.json({ importadas, duplicadas, conciliadas, pendentes: importadas - conciliadas })
}
