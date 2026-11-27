// Regra pura da tela Lojas MotoChefe (#321): lê o pedido só com os campos da tela e organiza a resposta.
// Sem banco: a gravação e a leitura ficam em motochefe-marcacao-banco.ts.
import { ehUuid } from '@/lib/uuid'

export const ROTA_LOJAS_MOTOCHEFE = '/admin/motochefe'
// Mesma frase para id inválido e id inexistente: a resposta não diz o que existe.
export const MENSAGEM_LOJA_NAO_ENCONTRADA = 'Loja não encontrada'
export const MENSAGEM_CONTA_NAO_ENCONTRADA = 'Conta não encontrada'

export type Marcacao = { lojaId: string; marcada: boolean }
export type Autorizacao = { contaId: string; autorizada: boolean }

export function lerMarcacao(entrada: unknown): Marcacao | null {
  const e = entrada as Partial<Record<keyof Marcacao, unknown>> | null
  if (!e || typeof e.lojaId !== 'string' || !ehUuid(e.lojaId) || typeof e.marcada !== 'boolean') return null
  return { lojaId: e.lojaId, marcada: e.marcada }
}

export function lerAutorizacao(entrada: unknown): Autorizacao | null {
  const e = entrada as Partial<Record<keyof Autorizacao, unknown>> | null
  if (!e || typeof e.contaId !== 'string' || !ehUuid(e.contaId) || typeof e.autorizada !== 'boolean') return null
  return { contaId: e.contaId, autorizada: e.autorizada }
}

/** Uma linha por loja (Conta sem loja vem com lojaId nulo). */
export type LinhaDaConta = {
  contaId: string
  contaNome: string
  autorizada: boolean
  lojaId: string | null
  lojaNome: string | null
  cidade: string | null
  ativa: boolean | null
  marcada: boolean | null
}
export type LojaDaTela = { id: string; nome: string; cidade: string; ativa: boolean; marcada: boolean }
export type ContaDaTela = { id: string; nome: string; autorizada: boolean; lojas: LojaDaTela[] }

/** Agrupa as linhas por Conta, na ordem em que cada Conta aparece. */
export function agruparContas(linhas: LinhaDaConta[]): ContaDaTela[] {
  const ids = [...new Set(linhas.map(l => l.contaId))]
  return ids.map(id => {
    const daConta = linhas.filter(l => l.contaId === id)
    const primeira = daConta[0]
    return {
      id,
      nome: primeira.contaNome,
      autorizada: primeira.autorizada,
      lojas: daConta.flatMap((l): LojaDaTela[] => l.lojaId === null
        ? []
        : [{ id: l.lojaId, nome: l.lojaNome ?? '', cidade: l.cidade ?? '', ativa: l.ativa ?? false, marcada: l.marcada ?? false }]),
    }
  })
}

/** Quantas lojas estão marcadas: a lista de Contas, o painel e o resumo usam esta contagem. */
export function contarMarcadas(lojas: LojaDaTela[]): number {
  return lojas.filter(l => l.marcada).length
}

/** Os números do topo da tela: lojas marcadas, Contas com loja marcada e Contas autorizadas. */
export function resumoDaTela(contas: ContaDaTela[]) {
  const lojas = contas.flatMap(c => c.lojas)
  return {
    lojasMarcadas: contarMarcadas(lojas),
    lojasTotal: lojas.length,
    contasComMarcada: contas.filter(c => contarMarcadas(c.lojas) > 0).length,
    contasTotal: contas.length,
    contasAutorizadas: contas.filter(c => c.autorizada).length,
  }
}
