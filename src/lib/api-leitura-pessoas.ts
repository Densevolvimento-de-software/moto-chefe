// Regra da API de pessoas (#324, ADR-0021). Puro: sem banco e sem relógio. "É pessoa que sai" é a única regra de quem
// entra em Pessoas. A consulta repete a mesma regra em SQL (src/lib/queries/api-leitura-pessoas.ts) e o teste de banco
// confere as duas com os mesmos usuários. Pensada para as vendas de peça e a OS usarem também (ainda não usam).
import { usuarioComCargo, type CargoDoUsuario } from '@/lib/usuario-com-cargo'
import { codificarCursorObjeto, decodificarCursorObjeto } from '@/lib/api-leitura-pagina'
import { ehUuid } from '@/lib/uuid'

/** Papéis que contam como pessoa, no principal ou em papeis_extras (decisão do Luis na #324). admin_geral fica de fora. */
export const PAPEIS_DE_PESSOA = ['vendedor', 'aux_adm', 'mecanico', 'admin_socio'] as const

/**
 * `lojaQueSai`: a loja do usuário está entre as que saem (marcada, grupo ativo, Conta não desativada).
 * `contaQueSai`: a Conta do usuário tem ao menos uma loja que sai. Só o sócio usa esta flag: ele entra pela Conta.
 */
export type UsuarioParaRegra = {
  papel: string; cargo: CargoDoUsuario | null; papeisExtras: readonly string[]
  lojaQueSai: boolean; contaQueSai: boolean
}

export type LinhaPessoaBanco = {
  id: string; nome: string; papel: string; ativo: boolean; papeisExtras: readonly string[]
  cargoNome: string | null; cargoPapelBase: CargoDoUsuario['papelBase'] | null
  lojaId: string | null; lojaNome: string | null
}

/** Só estes campos saem (spec #315: sem e-mail, documento, telefone nem folha). `loja` é nulo para o sócio. */
export type PessoaDaApi = { id: string; nome: string; funcao: string; loja: { id: string; nome: string } | null; ativo: boolean }

const ehPapelDePessoa = (papel: string): boolean => (PAPEIS_DE_PESSOA as readonly string[]).includes(papel)

/** Papel efetivo: cargo vale o papel base do cargo (mesma regra de usuarioComCargo). */
export function papelEfetivo(u: Pick<UsuarioParaRegra, 'papel' | 'cargo'>): string {
  return usuarioComCargo({ papel: u.papel }, u.cargo).papel
}

/**
 * O papel pelo qual a pessoa entra e que aparece em `funcao`: o principal efetivo, se for um dos de pessoa; senão o
 * primeiro extra que for. Nulo se nenhum deles é de pessoa.
 */
export function papelDePessoa(u: Pick<UsuarioParaRegra, 'papel' | 'cargo' | 'papeisExtras'>): string | null {
  const principal = papelEfetivo(u)
  if (ehPapelDePessoa(principal)) return principal
  return u.papeisExtras.find(ehPapelDePessoa) ?? null
}

export function ehPessoaQueSai(u: UsuarioParaRegra): boolean {
  const papel = papelDePessoa(u)
  if (papel === null) return false
  return papel === 'admin_socio' ? u.contaQueSai : u.lojaQueSai
}

export function linhaDaPessoa(l: LinhaPessoaBanco): PessoaDaApi {
  const cargo = l.cargoNome !== null && l.cargoPapelBase !== null ? { nome: l.cargoNome, papelBase: l.cargoPapelBase } : null
  // Linha só vem da consulta, que já filtrou pela regra: quando não há papel de pessoa, o efetivo é só o fallback.
  const funcao = papelDePessoa({ papel: l.papel, cargo, papeisExtras: l.papeisExtras }) ?? papelEfetivo({ papel: l.papel, cargo })
  const loja = funcao !== 'admin_socio' && l.lojaId !== null && l.lojaNome !== null ? { id: l.lojaId, nome: l.lojaNome } : null
  return { id: l.id, nome: l.nome, funcao, loja, ativo: l.ativo }
}

// Ordem por id (uuid): o cursor leva só o id. Igual ao padrão de metas e despesas, valida o campo pelo tipo.
export function codificarCursorDePessoas(c: { i: string }): string {
  return codificarCursorObjeto({ i: c.i })
}

export function lerCursorDePessoas(texto: string | null): { ok: true; cursor: { i: string } | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'i') return { ok: false }
  const { i } = valor
  if (typeof i !== 'string' || !ehUuid(i)) return { ok: false }
  return { ok: true, cursor: { i } }
}
