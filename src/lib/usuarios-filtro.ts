// Filtros da lista de /admin/usuarios (#557). Roda só sobre a lista que o servidor já recortou
// (listarUsuariosGerenciaveis): nunca alcança usuário fora dela. Regra pura.

export type Situacao = 'ativos' | 'inativos' | 'todos'
export type FiltrosUsuarios = { busca: string; papel: string; contaId: string; situacao: Situacao }
type UsuarioFiltravel = { nome: string; email: string; papel: string; lojaNome: string | null; contaId: string | null; ativo: boolean }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Busca (sem acento, nos textos que a lista escolhe) e situação: o filtro comum das listas de logins. */
export function filtrarPorBuscaESituacao<T extends { ativo: boolean }>(lista: T[], f: { busca: string; situacao: Situacao }, textos: (t: T) => string[]): T[] {
  const q = semAcento(f.busca.trim())
  return lista.filter(t =>
    (!q || semAcento(textos(t).join(' ')).includes(q))
    && (f.situacao === 'todos' || (f.situacao === 'ativos') === t.ativo))
}

export function filtrarUsuarios<U extends UsuarioFiltravel>(lista: U[], f: FiltrosUsuarios): U[] {
  return filtrarPorBuscaESituacao(lista, f, u => [u.nome, u.email, u.lojaNome ?? ''])
    .filter(u => (!f.papel || u.papel === f.papel) && (!f.contaId || u.contaId === f.contaId))
}
