/**
 * Nota de entrada com peças (#429). Decisão do Luis (27/10): se a nota tem peças, ela
 * entra inteira ou não entra; qualquer erro de moto ou de peça desfaz tudo. Nota só de
 * motos continua parcial, pelo registrarEntradaLote. Roda dentro da transação de quem
 * chama.
 */
import type { db } from '@/lib/db'
import { podeAbrirRegistroDaLoja } from '@/lib/acesso-registro'
import { conferirMotosDaEntrada, gravarMotosConferidas, type MotoEntradaLote, type QuemDaEntrada } from '@/lib/entrada-motos'
import { conferirLinhasPecas, gravarEntradaPecas, type EntradaPecas, type LinhaEntradaPeca } from '@/lib/entrada-pecas'
import type { FichaDaMoto } from '@/lib/nfe-fiscal'
import type { StatusNaEntrada } from '@/lib/entrada-motos-regras'

type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>

/** Nota recusada: nada foi gravado. `erros` lista tudo o que a tela precisa corrigir. */
export class NotaRecusada extends Error {
  constructor(readonly erros: string[]) {
    super(erros.join('\n'))
  }
}

export type NotaComPecas = {
  usuario: EntradaPecas['usuario'] & QuemDaEntrada
  lojaId: string
  /** Status de todas as motos da nota, já conferido pelo servidor (#10). */
  status: StatusNaEntrada
  nota: EntradaPecas['nota']
  motos: MotoEntradaLote[]
  fiscais?: FichaDaMoto[]
  pecas: LinhaEntradaPeca[]
}

export async function registrarNotaComPecas(exec: Executor, e: NotaComPecas): Promise<{ motos: number; pecas: number }> {
  // Mesma frase da gravação de peças: loja de outra Conta e loja inexistente não se distinguem.
  if (!(await podeAbrirRegistroDaLoja(e.usuario, e.lojaId, exec))) {
    throw new NotaRecusada(['Loja de destino não encontrada'])
  }

  const { prontas, erros: errosDasMotos } = await conferirMotosDaEntrada(exec, e.lojaId, e.motos, e.usuario)
  const erros = [...errosDasMotos, ...await conferirLinhasPecas(exec, e.lojaId, e.pecas)]
  if (erros.length) throw new NotaRecusada(erros)

  await gravarMotosConferidas(exec, { lojaId: e.lojaId, usuarioId: e.usuario.id, status: e.status, prontas, fiscais: e.fiscais ?? [] })
  await gravarEntradaPecas(exec, { lojaId: e.lojaId, usuario: e.usuario, nota: e.nota, linhas: e.pecas })
  return { motos: prontas.length, pecas: e.pecas.length }
}
