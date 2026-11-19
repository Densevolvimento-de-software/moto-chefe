// Usuário que os testes de Server Action devolvem no mock de getUsuarioLogado.
export type Sessao = {
  id: string
  nome?: string
  papel: string
  lojaId: string | null
  contaId: string | null
  gruposAcesso: string[]
  gruposAprovacao: string[]
}

/** Quem trabalha na loja da base, sem grupos marcados; `extra` muda o que o teste precisa. */
export const sessaoDe = (b: { lojaId: string; contaId: string }, papel: string, id: string, extra: Partial<Sessao> = {}): Sessao =>
  ({ id, nome: `${papel} de teste`, papel, lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], gruposAprovacao: [], ...extra })
