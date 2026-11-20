// Linha da /conciliacao como a tela mostra (#51, PR6b): a tabela do desktop e a lista do celular leem o mesmo objeto,
// montado no servidor (serializável para o componente cliente).
import type { ResumoDoAlvo, ResumosDoAlvoCartao } from '@/lib/rotulos-alvo'
import type { AlvoTipo } from '@/lib/conciliacao-alvo'
import type { conciliacoesCartao } from '@/lib/db/schema'
import { linhaEstornada, rotuloCurtoDaLinha } from '@/lib/conciliacao-cartao'
import { nomeOperadora } from '@/lib/operadoras'

export type AlvoDaLinha = ResumoDoAlvo & { tipo: AlvoTipo }
export type LinhaNaTela = {
  id: string; data: string; operadora: string; tipo: string; rotulo: string; credito: boolean; bandeira: string; portador: string
  valor: number; liquido: number | null; nsu: string | null; estornada: boolean; alvo: AlvoDaLinha | null
}
export type LinhaDoBanco = Pick<typeof conciliacoesCartao.$inferSelect,
  'id' | 'operadora' | 'dataTransacao' | 'tipo' | 'parcelas' | 'valorBruto' | 'valorLiquido' | 'nsu' | 'status' | 'vendaId'
  | 'pecaVendaId' | 'osId' | 'rawData'>

// Id sem resumo (alvo de outro grupo: o resumo só lê o grupo da linha) fica sem alvo.
function alvoDaLinha(t: LinhaDoBanco, alvos: ResumosDoAlvoCartao): AlvoDaLinha | null {
  const achado =
    t.vendaId ? { resumo: alvos.vendas.get(t.vendaId), tipo: 'moto' as const }
    : t.pecaVendaId ? { resumo: alvos.pecas.get(t.pecaVendaId), tipo: 'peca' as const }
    : t.osId ? { resumo: alvos.os.get(t.osId), tipo: 'os' as const }
    : null
  return achado?.resumo ? { ...achado.resumo, tipo: achado.tipo } : null
}

export function linhaNaTela(t: LinhaDoBanco, alvos: ResumosDoAlvoCartao): LinhaNaTela {
  const raw = (t.rawData ?? {}) as Record<string, string | undefined>
  return {
    id: t.id,
    data: t.dataTransacao,
    operadora: nomeOperadora(t.operadora),
    tipo: t.tipo,
    rotulo: rotuloCurtoDaLinha(t.tipo, t.parcelas),
    credito: t.tipo === 'credito',
    bandeira: raw.bandeira ?? '',
    portador: raw.portador ?? '',
    valor: Number(t.valorBruto),
    liquido: t.valorLiquido ? Number(t.valorLiquido) : null,
    nsu: t.nsu,
    estornada: linhaEstornada(t.status),
    alvo: alvoDaLinha(t, alvos),
  }
}
