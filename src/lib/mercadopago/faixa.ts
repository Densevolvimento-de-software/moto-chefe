// Faixa do Mercado Pago na /conciliacao (#51, V2 escolhida pelo Luis): o que ela mostra a partir do resumo da
// última importação. Puro, sem banco: roda no componente de cliente.
import { CONTAGENS, type Contagem, type NaoTratadoMp, type ResultadoImportacaoMp } from './contagens'
import { dataPuraBr, diaEHoraBrt } from '@/lib/data-venda'
import { brl } from '@/lib/dashboard-painel'

export type NumeroDaFaixa = { rotulo: string; valor: number; nota: string | null; alerta: boolean }
export type LinhaDosDetalhes = { rotulo: string; explica: string; valor: number; alerta: boolean }

const palavra = (n: number, um: string, varios: string) => (n === 1 ? um : varios)

/** Os 4 números: vendas novas, já estavam aqui, não tratadas e estornadas (a falha vai como frase, decisão do Luis). */
export function numerosDaFaixa(c: ResultadoImportacaoMp): NumeroDaFaixa[] {
  const novas = c.conciliadas + c.pendentes
  return [
    { rotulo: palavra(novas, 'venda nova', 'vendas novas'), valor: novas, nota: novas > 0 ? `${c.conciliadas} já ligadas, ${c.pendentes} para vincular` : null, alerta: false },
    { rotulo: 'já estavam aqui', valor: c.duplicadas, nota: null, alerta: false },
    { rotulo: palavra(c.naoTratados, 'não tratada', 'não tratadas'), valor: c.naoTratados, nota: null, alerta: c.naoTratados > 0 },
    { rotulo: 'estornadas', valor: c.estornos, nota: null, alerta: false },
  ]
}

// Um texto por contagem: contagem nova em CONTAGENS sem texto aqui não compila.
const TEXTO_DA_CONTAGEM: Record<Contagem, { rotulo: string; explica: string }> = {
  conciliadas: { rotulo: 'Vendas novas, já ligadas a uma venda', explica: 'casadas sozinhas pela autorização ou pelo valor' },
  pendentes: { rotulo: 'Vendas novas, para vincular', explica: 'sem venda igual no dia; vincule na lista abaixo' },
  duplicadas: { rotulo: 'Já estavam aqui', explica: 'importadas antes; o vínculo não muda' },
  estornos: { rotulo: 'Marcadas como estornadas', explica: 'o dinheiro voltou ao cliente; saem da conciliação' },
  estornosSemLinha: { rotulo: 'Estornadas antes de chegar aqui', explica: 'aprovadas e estornadas antes da importação; nada a desfazer' },
  naoTratados: { rotulo: 'Não tratadas nos últimos 7 dias', explica: 'veja a lista acima' },
  ignorados: { rotulo: 'Fora da maquininha', explica: 'link de pagamento, pendentes e cancelados: não entram' },
}

/** As 7 contagens da importação, para o "Ver detalhes", na ordem de CONTAGENS. */
export const detalhesDaFaixa = (c: ResultadoImportacaoMp): LinhaDosDetalhes[] =>
  CONTAGENS.map(k => ({ ...TEXTO_DA_CONTAGEM[k], valor: c[k], alerta: k === 'naoTratados' && c[k] > 0 }))

const comMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Uma linha por não tratado: meio fora pede o Forçar; sem líquido entra sozinho numa rodada seguinte (D10). */
export function fraseDoNaoTratado(n: NaoTratadoMp): string {
  const quanto = `${brl(n.valor)} em ${dataPuraBr(n.data)}`
  return n.entraDepois
    ? `${comMaiuscula(n.motivo)}, ${quanto}: entra sozinha quando o Mercado Pago mandar o valor líquido.`
    : `${comMaiuscula(n.motivo)} de ${quanto}: o MOVA não importa esse meio; concilie a venda com "Forçar".`
}

export const rotuloDaUltima = (iso: string | null): string =>
  `${iso ? `Importado em ${diaEHoraBrt(iso)}` : 'Ainda não importado'}. Roda sozinho uma vez por dia.`

export const fraseDaFalha = (iso: string, erro: string): string => `A importação de ${diaEHoraBrt(iso)} falhou: ${erro}`
