// Leitura e gravação da tela Lojas MotoChefe (#321). Quem chama confere o papel (exigirAdminGeral).
// Cada gravação e o seu log saem na mesma transação: registrarAcaoSensivel(a, tx), nunca o SemFalhar.
// Só o campo pedido muda; o resto da loja ou da Conta não é tocado.
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contas, grupos, lojas } from '@/lib/db/schema'
import { registrarAcaoSensivel } from '@/lib/log-acoes'
import {
  agruparContas, MENSAGEM_CONTA_NAO_ENCONTRADA, MENSAGEM_LOJA_NAO_ENCONTRADA,
  type Autorizacao, type ContaDaTela, type LinhaDaConta, type Marcacao,
} from '@/lib/motochefe-marcacao'

type Escritor = Pick<typeof db, 'select' | 'update' | 'insert' | 'delete' | 'transaction'>
type Resultado = { ok: true } | { ok: false; erro: string }

export async function marcarLojaMotochefe(adminId: string, m: Marcacao, exec: Escritor = db): Promise<Resultado> {
  return exec.transaction(async tx => {
    const [alvo] = await tx.select({ nome: lojas.nome }).from(lojas).where(eq(lojas.id, m.lojaId)).limit(1)
    if (!alvo) return { ok: false, erro: MENSAGEM_LOJA_NAO_ENCONTRADA }
    // A condição de mudança faz parte do update: se dois cliques chegam juntos, só um troca e só um registra o log.
    const [trocada] = await tx.update(lojas).set({ lojaMotochefe: m.marcada })
      .where(and(eq(lojas.id, m.lojaId), ne(lojas.lojaMotochefe, m.marcada)))
      .returning({ nome: lojas.nome })
    if (!trocada) return { ok: true }
    await registrarAcaoSensivel({
      tipo: 'loja_motochefe_alterada', usuarioId: adminId, lojaId: m.lojaId,
      detalhe: { lojaId: m.lojaId, lojaNome: trocada.nome, de: !m.marcada, para: m.marcada },
    }, tx)
    return { ok: true }
  })
}

// Conta desativada não aceita a autorização: a tela não a lista, e a API de leitura não a devolve (ticket 319).
export async function autorizarCustoDespesaMeta(adminId: string, a: Autorizacao, exec: Escritor = db): Promise<Resultado> {
  return exec.transaction(async tx => {
    const [alvo] = await tx.select({ nome: contas.nome }).from(contas)
      .where(and(eq(contas.id, a.contaId), isNull(contas.desativadaEm))).limit(1)
    if (!alvo) return { ok: false, erro: MENSAGEM_CONTA_NAO_ENCONTRADA }
    const [trocada] = await tx.update(contas).set({ autorizaCustoDespesaMeta: a.autorizada })
      .where(and(eq(contas.id, a.contaId), ne(contas.autorizaCustoDespesaMeta, a.autorizada)))
      .returning({ nome: contas.nome })
    if (!trocada) return { ok: true }
    // Sem loja no registro: o grupo fica nulo e só a Conta é gravada (mesmo modelo de alterarTransferenciaEntreGrupos).
    await registrarAcaoSensivel({
      tipo: 'autorizacao_conta_alterada', usuarioId: adminId, contaId: a.contaId,
      detalhe: { contaId: a.contaId, contaNome: trocada.nome, de: !a.autorizada, para: a.autorizada },
    }, tx)
    return { ok: true }
  })
}

/** Todas as Contas ativas, de todos os grupos, com as lojas de cada uma. Só para o admin_geral. */
export async function listarContasMotochefe(exec: Pick<typeof db, 'select'> = db): Promise<ContaDaTela[]> {
  const linhas: LinhaDaConta[] = await exec.select({
    contaId: contas.id,
    contaNome: contas.nome,
    autorizada: contas.autorizaCustoDespesaMeta,
    lojaId: lojas.id,
    lojaNome: lojas.nome,
    cidade: lojas.cidade,
    ativa: lojas.ativa,
    marcada: lojas.lojaMotochefe,
  }).from(contas)
    .leftJoin(grupos, eq(grupos.contaId, contas.id))
    .leftJoin(lojas, eq(lojas.grupoId, grupos.id))
    .where(isNull(contas.desativadaEm))
    .orderBy(asc(contas.nome), asc(lojas.nome))
  return agruparContas(linhas)
}
