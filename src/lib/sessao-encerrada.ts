// Sessão vencida num clique de botão (#281). Proxy e telas importam daqui: a frase e o jeito de
// reconhecê-la moram num lugar só.

/** Frase única para qualquer botão que chama Server Action. Texto de tela: sem travessão. */
export const SESSAO_ENCERRADA = 'Sua sessão acabou. Entre de novo para continuar.'

/** A tela reconhece a sessão encerrada pela frase que o proxy mandou. */
export function ehSessaoEncerrada(erro: unknown): boolean {
  return erro instanceof Error && erro.message === SESSAO_ENCERRADA
}

/**
 * Clique de botão que chama Server Action pelo JS do Next: POST com o id da action no cabeçalho
 * `next-action`. O Next só executa action em POST, e o cliente sempre manda o id preenchido; GET com
 * o cabeçalho, ou cabeçalho vazio, não é clique de botão e segue para o login.
 */
export function ehCliqueDeAcao(metodo: string, cabecalhos: Pick<Headers, 'get'>): boolean {
  return metodo.toUpperCase() === 'POST' && (cabecalhos.get('next-action') ?? '') !== ''
}
