// Regras puras do comprovante e da loja de um lançamento de caixa (#153). Sem banco, Storage nem sessão.

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
}
const LIMITE_BYTES = 10 * 1024 * 1024

/** Recusa do arquivo, ou null se ele serve de comprovante. */
export function recusaDoComprovante(arquivo: { type: string; size: number }): string | null {
  if (arquivo.size === 0) return 'Arquivo não enviado'
  if (!EXTENSAO[arquivo.type]) return 'Formato não suportado. Envie JPG, PNG, WebP ou PDF.'
  if (arquivo.size > LIMITE_BYTES) return 'Arquivo muito grande. Máximo: 10MB.'
  return null
}

/**
 * Caminho no bucket, montado no servidor a partir do grupo da loja do lançamento (regra de Storage do
 * AGENTS.md). Os antigos (`caixa/<arquivo>`) seguem abrindo pelo caminho gravado na linha.
 */
export function caminhoDoComprovanteCaixa(grupoId: string, tipoArquivo: string, sufixo: string): string {
  return `caixa/${grupoId}/${sufixo}.${EXTENSAO[tipoArquivo] ?? 'bin'}`
}

/** Loja do lançamento: o sócio escolhe; os demais lançam só na própria loja. */
export function lojaEfetivaDoLancamento(
  usuario: { papel: string; lojaId: string | null },
  lojaPedida: string | null | undefined,
): { lojaId: string } | { erro: string } {
  const ehAdmin = usuario.papel === 'admin_geral' || usuario.papel === 'admin_socio'
  if (ehAdmin) return lojaPedida ? { lojaId: lojaPedida } : { erro: 'Loja inválida' }
  if (!usuario.lojaId) return { erro: 'Loja inválida' }
  if (lojaPedida && lojaPedida !== usuario.lojaId) return { erro: 'Sem permissão para esta loja' }
  return { lojaId: usuario.lojaId }
}
