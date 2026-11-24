import { rotuloSyncBrt } from '@/lib/rotulo-sync'
import { redirect } from 'next/navigation'
import { getUsuarioLogado } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { getGrupoAtivo } from '@/lib/grupo'
import { podeForcarNoGrupo } from '@/lib/conciliacao-forcar-opcao'
import { cachePixValido, ultimaSincronizacaoPix } from '@/lib/pix-sync'
import { db } from '@/lib/db'
import { pixRecebimentosMcp } from '@/lib/db/schema'
import { and, eq, gte, lte, desc } from 'drizzle-orm'
import { rotulosDoVinculoPix } from '@/lib/rotulos-alvo'
import { nomesDeUsuariosVisiveis } from '@/lib/conta'
import { PixTopo } from './components/pix-topo'
import { PixLista, type LinhaPix } from './components/pix-lista'
import { ehTransferenciaInterna } from '@/lib/pix-internos'
import { hojeBrt, primeiroDiaDoMesBrt } from '@/lib/data-venda'
import { INICIO_CONCILIACAO, INICIO_CONCILIACAO_EM } from '@/lib/conciliacao-periodo'

// A sincronização (server action) pode passar de 1 min; a página é o teto dela.
export const maxDuration = 300

function formatValor(v: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v))
}

function formatData(d: Date) {
  // O Sicoob não informa horário real via Open Finance (sempre 00:00) —
  // mostrar só a data evita passar uma precisão que os dados não têm.
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function toInputDate(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function PixMcpPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const tPagina = performance.now()
  // Diagnóstico de lentidão (#126): um log por fase, assim que ela termina (ver logTempo em @/lib/mcpai).
  const tempo = (etapa: string, desde: number, extra = '') =>
    console.log('[pix-tempo]', `etapa=${etapa} ms=${Math.round(performance.now() - desde)}${extra ? ' ' + extra : ''}`)

  const usuario = await getUsuarioLogado()
  if (!usuarioPodeAcessar(usuario, '/pix-mcp')) redirect('/dashboard')

  const grupo = await getGrupoAtivo(usuario)
  const podeDesfazerForcada = await podeForcarNoGrupo(usuario.papel, grupo.id)
  tempo('sessao_e_grupo', tPagina)

  const params = await searchParams
  const hoje = new Date()
  // Default = dia 01 do mês corrente até hoje (mesmo padrão do Dashboard) — evita a
  // confusão de "sumiu recebimento antigo" quando na verdade só não tava no filtro.
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1)

  const fromPedido = params.from ? new Date(params.from + 'T00:00:00.000Z') : new Date(toInputDate(inicioMesAtual) + 'T00:00:00.000Z')
  // Antes do início do período de conciliação não existe recebimento pra
  // mostrar (só histórico importado) — ver INICIO_CONCILIACAO.
  const fromDate = fromPedido < INICIO_CONCILIACAO_EM ? INICIO_CONCILIACAO_EM : fromPedido
  const toDate = params.to ? new Date(params.to + 'T23:59:59.999Z') : hoje

  // Datas exibidas no seletor de período: em Brasília, para o atalho "Mês" casar com o padrão após as 21h.
  const primeiroDoMes = primeiroDiaDoMesBrt()
  const ultimaSync = await ultimaSincronizacaoPix(grupo.id)
  // Sem sincronizar aqui: a página mostra o que está no banco e o cliente dispara
  // a sincronização (ver SincronizacaoPix), para não prender a tela atrás do mcp.ai.
  const sincronizarAoAbrir = !cachePixValido(ultimaSync)
  console.log('[pix-tempo]', `etapa=cache valido=${!sincronizarAoAbrir}`)

  const tLinhas = performance.now()
  const linhas = await db
    .select()
    .from(pixRecebimentosMcp)
    .where(and(
      eq(pixRecebimentosMcp.grupoId, grupo.id),
      gte(pixRecebimentosMcp.data, fromDate),
      lte(pixRecebimentosMcp.data, toDate),
    ))
    .orderBy(desc(pixRecebimentosMcp.data))

  tempo('consultar_linhas', tLinhas, `linhas=${linhas.length}`)

  const ids = <K extends 'vendaId' | 'osId' | 'pedidoId' | 'pecaVendaId' | 'lancadoPorId'>(k: K) =>
    linhas.map(l => l[k]).filter((id): id is string => !!id)
  const [rotulos, usuarioNomeById] = await Promise.all([
    rotulosDoVinculoPix(grupo, { vendaIds: ids('vendaId'), osIds: ids('osId'), pedidoIds: ids('pedidoId'), pecaVendaIds: ids('pecaVendaId') }),
    nomesDeUsuariosVisiveis(grupo, ids('lancadoPorId')),
  ])
  tempo('total_ate_montar_dados', tPagina)

  // Transferência interna é dinheiro andando entre contas do próprio grupo
  // (maquininha, conta a conta). Não é recebimento de cliente e não é assunto de
  // balcão: só sócio vê. Para o resto da equipe a linha some da tabela E dos
  // totais — deixar no total com a linha escondida faria a soma não fechar com o
  // que está na tela.
  const ehInterna = (l: typeof linhas[number]) =>
    !l.tipoCorrespondencia && ehTransferenciaInterna(l.pagadorNome)
  const ehSocio = ['admin_geral', 'admin_socio'].includes(usuario.papel)
  const linhasVisiveis = ehSocio ? linhas : linhas.filter(l => !ehInterna(l))

  const total = linhasVisiveis.reduce((s, l) => s + Number(l.valor), 0)
  const totalVinculado = linhasVisiveis.filter(l => l.tipoCorrespondencia).reduce((s, l) => s + Number(l.valor), 0)
  const linhasInternas = linhasVisiveis.filter(ehInterna)
  const totalInterno = linhasInternas.reduce((s, l) => s + Number(l.valor), 0)
  const totalSemCorrespondencia = total - totalVinculado - totalInterno
  const qtdSemCorrespondencia = linhasVisiveis.filter(l => !l.tipoCorrespondencia && !ehInterna(l)).length

  const itens = [
    { rotulo: 'Total recebido', valor: formatValor(String(total)), nota: `${linhasVisiveis.length} transações` },
    { rotulo: 'Vinculados', valor: formatValor(String(totalVinculado)), nota: `${linhasVisiveis.filter(l => l.tipoCorrespondencia).length} transações`, tom: 'text-primary-text' },
    { rotulo: 'Sem correspondência', valor: formatValor(String(totalSemCorrespondencia)), nota: `${qtdSemCorrespondencia} transações`, tom: 'text-warning' },
    ...(ehSocio ? [{ rotulo: 'Transferências internas', valor: formatValor(String(totalInterno)), nota: `${linhasInternas.length} transações · conta própria`, tom: 'text-muted-foreground' }] : []),
  ]

  // Só o necessário para a lista cruza para o cliente: texto já formatado, sem Date.
  const linhasLista: LinhaPix[] = linhasVisiveis.map(l => ({
    id: l.id,
    data: formatData(l.data),
    tipo: l.tipoOperacao ?? 'PIX',
    pagador: l.pagadorNome || null,
    descricao: l.descricao ?? null,
    valor: formatValor(l.valor),
    interna: ehInterna(l),
    correspondencia: {
      tipo: l.tipoCorrespondencia,
      vendaNf: l.vendaId ? rotulos.nfDaVenda.get(l.vendaId) ?? null : null,
      osNumero: l.osId ? rotulos.numeroDaOs.get(l.osId) ?? null : null,
      pedidoNumero: l.pedidoId ? rotulos.numeroDoPedido.get(l.pedidoId) ?? null : null,
      pecaNumero: l.pecaVendaId ? rotulos.numeroDaPeca.get(l.pecaVendaId) ?? null : null,
      lancadoPorNome: l.lancadoPorId ? usuarioNomeById.get(l.lancadoPorId) ?? null : null,
      lancadoEm: l.lancadoEm ? l.lancadoEm.toISOString() : null,
    },
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">PIX Recebidos</h1>
        <p className="hidden text-sm text-muted-foreground md:block">
          Contas do grupo <strong>{grupo.nome}</strong>, direto via mcp.ai (Open Finance). Inclui PIX (de outros bancos e entre contas do mesmo banco) e TED recebida. Correspondência lançada manualmente.
        </p>
      </div>
      <PixTopo
        itens={itens}
        from={params.from ? toInputDate(fromDate) : primeiroDoMes < INICIO_CONCILIACAO ? INICIO_CONCILIACAO : primeiroDoMes}
        to={params.to ?? hojeBrt()}
        hoje={hojeBrt()}
        min={INICIO_CONCILIACAO}
        rotuloSync={ultimaSync ? rotuloSyncBrt(ultimaSync) : 'Ainda não sincronizado'}
        sincronizarAoAbrir={sincronizarAoAbrir}
      />
      <PixLista linhas={linhasLista} podeDesfazerForcada={podeDesfazerForcada} />
    </div>
  )
}
