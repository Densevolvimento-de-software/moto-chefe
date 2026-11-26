// Sessão vencida num clique de botão (#281). Proxy e telas importam daqui: a frase e o jeito de
// reconhecê-la moram num lugar só.

/** Frase única para qualquer botão que chama Server Action. Texto de tela: sem travessão. */
export const SESSAO_ENCERRADA = 'Sua sessão acabou. Entre de novo para continuar.'

/** A tela reconhece a sessão encerrada pela frase que o proxy mandou. */
export function ehSessaoEncerrada(erro: unknown): boolean {
  return erro instanceof Error && erro.message === SESSAO_ENCERRADA
}
