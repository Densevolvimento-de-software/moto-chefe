import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { cargoDoUsuario } from '@/lib/cargos'
import { usuarioComCargo } from '@/lib/usuario-com-cargo'
import { gruposLiberadosVivos, usuarioDaRede } from '@/lib/grupos-liberados'
import { PAPEL_FABRICA, ROTA_CONTA_DESATIVADA, ehPedidoDeAcao } from '@/lib/login-fabrica'
import { ROTA_PAINEL_FABRICA } from '@/lib/painel-fabrica'

// getUsuarioLogado roda PRIMEIRO em toda página (layout e página). Se a query de
// usuário fica esperando uma conexão do pool (instância do Fluid com conexões
// presas), sem timeout ela pendura a requisição inteira até os 300s da Vercel —
// era a peça do caminho crítico que faltava blindar. Timeout curto que ESTOURA
// (não desloga): cai no error boundary com "Tentar novamente", em vez de travar.
//
// `etapa` existe porque as duas chamadas abaixo (auth do Supabase e banco) davam
// a MESMA mensagem: no incidente de 19/08 os logs só diziam "Timeout 8000ms na
// autenticação", sem dizer qual das duas travou — e as duas respondiam em ~150ms
// quando medidas por fora. Sem o nome da etapa não dá para fechar o diagnóstico.
function withTimeout<T>(p: Promise<T>, ms: number, etapa: string): Promise<T> {
  const inicio = Date.now()
  return Promise.race([
    p.then((v) => {
      const gasto = Date.now() - inicio
      if (gasto > 2000) console.warn(`[auth] ${etapa} lento: ${gasto}ms`)
      return v
    }),
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout ${ms}ms na autenticação (${etapa})`)), ms)
    ),
  ])
}

export const getUsuarioLogado = cache(async () => {
  const supabase = await createClient()
  // getClaims() valida a assinatura ES256 do JWT localmente (WebCrypto + JWKS
  // cacheado), sem ida ao servidor de auth — a garantia é criptográfica, não é
  // confiar no cookie. Era getUser(), uma chamada HTTP por página: em 19/08 ela
  // passou a estourar os 8s aqui e os 10s do middleware, com o auth do Supabase
  // respondendo em 150ms quando medido de fora. Ver memória project-auth-getclaims.
  const { data } = await withTimeout(supabase.auth.getClaims(), 8000, 'getClaims do Supabase')
  const userId = data?.claims.sub
  // O middleware prende em /fabrica quem tem o papel fabrica no token. Se a linha em `usuarios`
  // some ou diz outro papel, a saída é a tela com Sair: /login e /dashboard voltariam a /fabrica.
  const tokenDeFabrica = data?.claims.app_metadata?.papel === PAPEL_FABRICA

  if (!userId) redirect('/login')

  const [linha] = await withTimeout(
    db.select().from(usuarios).where(eq(usuarios.id, userId)).limit(1),
    8000,
    'consulta do usuário no banco',
  )

  if (!linha) redirect(tokenDeFabrica ? ROTA_CONTA_DESATIVADA : '/login')
  if (tokenDeFabrica && linha.papel !== PAPEL_FABRICA) redirect(ROTA_CONTA_DESATIVADA)
  // O servidor não confia na linha: o login da fábrica não tem loja nem Conta, mesmo que alguém
  // grave. Com loja, abriria impressos e registros daquela loja (podeAgirNaLoja).
  const usuario = linha.papel === PAPEL_FABRICA ? { ...linha, lojaId: null, contaId: null } : linha

  // Conta desativada (funcionário desligado, conta de teste) não pode
  // continuar usando o sistema, mesmo com a sessão do Supabase ainda válida.
  // Antes desta checagem, `usuarios.ativo` só filtrava relatório de vendedor —
  // a pessoa continuava entrando e navegando normalmente em qualquer tela.
  //
  // Redireciona para /conta-desativada, não para /login: o middleware só olha
  // a sessão do Supabase (não o `ativo` do banco), então mandar pro /login com
  // sessão válida viraria loop (middleware manda de volta pro /dashboard).
  //
  // Sem válvula de segurança aqui de propósito: diferente da trava de
  // /completar-cadastro, estar desativado é uma decisão explícita de um
  // admin_geral, não um estado em que alguém cai sozinho. Se um admin_geral
  // for desativado por engano, a saída é pelo banco (UPDATE usuarios SET
  // ativo = true), não por uma exceção de papel no código.
  if (!usuario.ativo) redirect(ROTA_CONTA_DESATIVADA)

  // Login da fábrica só lê (@/lib/login-fabrica). Para Server Action, esta é a barreira principal,
  // não uma rede de proteção: o middleware não roda em todo caminho (ver o matcher dele) e uma
  // action pode ser chamada em qualquer página pelo id. O middleware só poupa a ida ao servidor.
  if (usuario.papel === PAPEL_FABRICA && ehPedidoDeAcao(await headers())) redirect(ROTA_PAINEL_FABRICA)

  // Lido a cada requisição: editar o cargo vale na hora para todos os usuários dele.
  const cargo = await withTimeout(cargoDoUsuario(db, usuario), 8000, 'cargo do usuário no banco')
  // Lido a cada requisição: liberar ou revogar um grupo para o admin_rede vale na hora (#517).
  const liberados = usuario.papel === 'admin_rede'
    ? await withTimeout(gruposLiberadosVivos(usuario.id), 8000, 'grupos liberados do usuário no banco')
    : []
  const grupoAtivoId = liberados.length ? (await cookies()).get('grupoAtivo')?.value ?? null : null
  return usuarioComCargo(usuarioDaRede(usuario, liberados, grupoAtivoId), cargo)
})

export function isAdmin(papel: string) {
  return papel === 'admin_geral'
}

// ─── Papéis acumulados ────────────────────────────────────────────────────────
// Uma pessoa pode exercer mais de uma função (ex.: aux_adm de uma loja que
// também vende). `papel` continua sendo o papel principal e governa todo o
// sistema; `papeisExtras` só acrescenta.
//
// A migração dos gates de `papel === 'x'` para cá é incremental e proposital:
// existem centenas de leituras de `.papel`, quase todas gate de admin, que não
// têm nada a ver com papel duplo. Um gate ainda não migrado faz a pessoa deixar
// de ver algo que poderia ver — nunca o contrário.
export function temPapel(
  usuario: { papel: string; papeisExtras?: string[] | null },
  papel: string,
) {
  return usuario.papel === papel || (usuario.papeisExtras ?? []).includes(papel)
}

// ─── Categorizar saída do banco (/despesas) ───────────────────────────────────
// Todo sócio vê a aba inteira; lançar, editar e cancelar a categorização é do admin_geral e de quem
// tem a marca do cadastro (categoriza_despesa_banco), que só o admin_geral liga em /admin/usuarios (#149).
// A marca só vale para quem é sócio: outro papel marcado continua sem categorizar.
export function podeCategorizarDespesaBanco(usuario: { papel: string; categorizaDespesaBanco?: boolean | null }) {
  if (usuario.papel === 'admin_geral') return true
  return usuario.papel === 'admin_socio' && usuario.categorizaDespesaBanco === true
}

export function canEditLoja(usuarioLojaId: string | null, targetLojaId: string, papel: string) {
  if (papel === 'admin_geral') return true
  return usuarioLojaId === targetLojaId
}
