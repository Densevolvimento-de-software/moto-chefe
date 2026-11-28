// Consulta da API de pessoas (#324, ADR-0021). Lê várias Contas de propósito, sem sessão: as lojas e as Contas que saem
// e a regra de pessoa ficam dentro da consulta. As colunas saem só pelo mapeamento puro em @/lib/api-leitura-pessoas.
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cargos, lojas, usuarios } from '@/lib/db/schema'
import { contasQueSaem, lojasQueSaem } from '@/lib/queries/api-leitura'
import { cortarPagina, TAMANHO_DA_PAGINA } from '@/lib/api-leitura-pagina'
import {
  codificarCursorDePessoas, linhaDaPessoa, PAPEIS_DE_PESSOA, type LinhaPessoaBanco, type PessoaDaApi,
} from '@/lib/api-leitura-pessoas'

/** Papel efetivo em SQL: cargo vale o papel base do cargo, como papelEfetivo. Exige `cargos` no FROM (LEFT JOIN). */
export const papelEfetivoSql = sql<string>`(case when ${usuarios.papel} = 'cargo' then ${cargos.papelBase} else ${usuarios.papel} end)`

/**
 * "É pessoa que sai" em SQL, espelho de ehPessoaQueSai. Sócio entra pela Conta (tem loja que sai); os outros pela loja.
 * O teste de banco confere os dois com os mesmos usuários.
 */
export const pessoaQueSaiSql = () => and(
  inArray(papelEfetivoSql, [...PAPEIS_DE_PESSOA]),
  or(
    and(sql`${papelEfetivoSql} = 'admin_socio'`, inArray(usuarios.contaId, contasQueSaem())),
    and(sql`${papelEfetivoSql} <> 'admin_socio'`, inArray(usuarios.lojaId, lojasQueSaem())),
  ),
)

/**
 * Uma página de pessoas, depois do cursor (id). Quem saiu (ativo falso) continua. A loja do sócio nem sai da consulta:
 * a coluna dela vem nula, então loja não marcada de sócio não chega à memória da resposta.
 */
export async function listarPessoasDaApi(
  cursor: { i: string } | null,
): Promise<{ pessoas: PessoaDaApi[]; proximaPagina: string | null }> {
  const linhas: LinhaPessoaBanco[] = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      papel: usuarios.papel,
      ativo: usuarios.ativo,
      cargoNome: cargos.nome,
      cargoPapelBase: cargos.papelBase,
      lojaId: sql<string | null>`(case when ${papelEfetivoSql} = 'admin_socio' then null else ${lojas.id} end)`,
      lojaNome: sql<string | null>`(case when ${papelEfetivoSql} = 'admin_socio' then null else ${lojas.nome} end)`,
    })
    .from(usuarios)
    .leftJoin(lojas, eq(usuarios.lojaId, lojas.id))
    .leftJoin(cargos, eq(usuarios.cargoId, cargos.id))
    .where(and(pessoaQueSaiSql(), cursor ? gt(usuarios.id, cursor.i) : undefined))
    .orderBy(asc(usuarios.id))
    .limit(TAMANHO_DA_PAGINA + 1)

  const pagina = cortarPagina(linhas)
  const ultima = pagina.linhas[pagina.linhas.length - 1]
  return {
    pessoas: pagina.linhas.map(linhaDaPessoa),
    proximaPagina: pagina.temMais && ultima ? codificarCursorDePessoas({ i: ultima.id }) : null,
  }
}
