// Linha da /conciliacao como a tela mostra (#51, PR6b): a tabela do desktop e a lista do celular leem o mesmo objeto,
// montado no servidor (serializável para o componente cliente).
import type { ResumoDoAlvo, ResumosDoAlvoCartao } from '@/lib/rotulos-alvo'
import { linhaEstornada, rotuloCurtoDaLinha } from '@/lib/conciliacao-cartao'
import { nomeOperadora } from '@/lib/operadoras'

export type AlvoDaLinha = ResumoDoAlvo & { tipo: 'moto' | 'peca' | 'os' }
export type LinhaNaTela = {
  id: string; data: string; operadora: string; rotulo: string; credito: boolean; bandeira: string; portador: string
  valor: number; liquido: number | null; nsu: string | null; estornada: boolean; alvo: AlvoDaLinha | null
}
export type LinhaDoBanco = {
  id: string; operadora: string; dataTransacao: string; tipo: string; parcelas: number; valorBruto: string
  valorLiquido: string | null; nsu: string | null; status: string; vendaId: string | null; pecaVendaId: string | null
  osId: string | null; rawData: unknown
}

// Id sem resumo (alvo apagado ou de outra Conta: o resumo só lê a Conta) fica sem alvo.
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
