// Matriz rota × papel (#579): toda rota da tabela de navegação, com cada papel do seed.
// Rota nova entra sozinha, porque a lista sai de ITENS.
import { ITENS, podeAcessar } from '../../src/lib/navegacao'
import { DOMINIO_TESTE } from './seed-dados'
import { ROTA_PAINEL_FABRICA } from '../../src/lib/painel-fabrica'
import { PAPEL_FABRICA } from '../../src/lib/login-fabrica'

/** `rotulo`: o que a saída mostra no lugar do e-mail (a cópia da produção mascara). */
export type UsuarioMatriz = { email: string; papel: string; rotulo?: string }

export const USUARIOS_MATRIZ: UsuarioMatriz[] = [
  { email: `geral@${DOMINIO_TESTE}`, papel: 'admin_geral' },
  ...['socio', 'aux', 'vendedor', 'mecanico', 'motorista'].map((prefixo, i) => ({
    email: `${prefixo}.sul@${DOMINIO_TESTE}`,
    papel: ['admin_socio', 'aux_adm', 'vendedor', 'mecanico', 'motorista'][i],
  })),
]

/**
 * Papéis da matriz na cópia local: os do seed e o login da fábrica (#901), que o seed do staging
 * não cria. Na cópia ele só existe se alguém o criou ali.
 */
export const PAPEIS_MATRIZ_LOCAL: string[] = [...USUARIOS_MATRIZ.map(u => u.papel), PAPEL_FABRICA]

/** Usuários da matriz: os do seed, ou a lista em JSON de MATRIZ_USUARIOS (cópia local, #594). */
export function usuariosDaMatriz(json: string | undefined): UsuarioMatriz[] {
  if (!json) return USUARIOS_MATRIZ
  const lista: unknown = JSON.parse(json)
  if (!Array.isArray(lista) || lista.length === 0 ||
    !lista.every(u => typeof u?.email === 'string' && typeof u?.papel === 'string')) {
    throw new Error('MATRIZ_USUARIOS precisa ser uma lista não vazia de { email, papel }')
  }
  return lista as UsuarioMatriz[]
}

export const ROTAS_MATRIZ: string[] =[...new Set(ITENS.filter(i => !i.semTela).map(i => i.href))]

export type Esperado = 'abre' | 'volta'

/** O usuário do seed não tem módulo extra nem bloqueado: vale a regra do papel. */
export function esperado(papel: string, href: string): Esperado {
  return podeAcessar({ papel }, href, {}) ? 'abre' : 'volta'
}

export type VisitaMatriz = {
  href: string
  caminhoFinal: string
  status: number | null
  /** A tela de erro do (dashboard)/error.tsx apareceu. */
  telaDeErro: boolean
}

/** Para onde volta quem abre uma rota sem acesso: o login da fábrica, ao painel dele. */
export function destinoSemAcesso(papel: string): string {
  return papel === PAPEL_FABRICA ? ROTA_PAINEL_FABRICA : '/dashboard'
}

/** Sem acesso: volta ao destino do papel, sem tela de erro. Com acesso: abre a própria rota. */
export function falhaDaVisita(esperado: Esperado, v: VisitaMatriz, destino = '/dashboard'): string | null {
  if (v.status === null) return 'sem resposta'
  if (v.status >= 500) return `status ${v.status}`
  if (v.caminhoFinal.startsWith('/login')) return 'caiu no /login'
  if (v.telaDeErro) return 'mostrou "Erro ao carregar a página"'
  if (esperado === 'volta' && v.caminhoFinal !== destino) return `sem permissão e ficou em ${v.caminhoFinal}`
  if (esperado === 'abre' && v.caminhoFinal !== v.href) return `com permissão e foi para ${v.caminhoFinal}`
  return null
}
